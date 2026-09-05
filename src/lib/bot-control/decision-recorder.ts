/**
 * Records one bot decision run as an auditable row.
 *
 * --- The one rule this file lives by ---
 *
 * It must never change what the bot does. Recording is a side effect bolted onto an existing
 * decision, so every function here swallows its own failures: a database hiccup while writing
 * an audit row must not stop a customer from getting their reply. This mirrors
 * `recordKnowledgeGap` in orchestrator.ts, which made the same call for the same reason.
 *
 * --- Why this exists alongside Message.botTrace ---
 *
 * `Message.botTrace` is still written exactly as before and is NOT superseded — the inbox
 * bubble reads it, and thousands of historical rows have nothing else. What a JSON column on a
 * message cannot capture is a run that never produced a message at all: an agent taking over
 * mid-flight (runBotForConversation aborts before sending), a rate-limited turn, or an
 * orchestrator exception. Those used to leave no trace whatsoever, which made "why didn't the
 * bot answer?" unanswerable — one of the ten questions in guidebook §27.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { sanitizeTrace } from '@/lib/bot-control/trace-sanitizer'
import { EXISTING_BOT_FLOW_KEY, WHATSAPP_EXISTING_BOT_FLOW } from '@/lib/bot-control/existing-flow-registry'

export type DecisionRunStatus = 'REPLIED' | 'CLARIFIED' | 'HANDOFF' | 'FAILED' | 'SKIPPED' | 'SIMULATED'

export type RecordDecisionRunParams = {
  conversationId: string
  messageId?: string
  inboundText: string
  decision: unknown
  startedAt: Date
  finishedAt: Date
  error?: string
  /**
   * Forces SKIPPED for a turn that never reached the orchestrator (rate limit, agent takeover).
   * Kept explicit rather than inferred from a null decision, because "no decision" and
   * "deliberately skipped" are different facts and only the caller knows which happened.
   */
  skipped?: boolean
  /** Marks a Test Lab run (simulator.ts) so it can never be mistaken for production traffic. */
  simulated?: boolean
}

/** Shape the orchestrator's BotDecision union takes once narrowed for reading. */
type DecisionLike = {
  mode?: unknown
  reason?: unknown
  draft?: unknown
  reply?: unknown
  sourceTopic?: unknown
  steps?: unknown
}

function asDecision(value: unknown): DecisionLike {
  return typeof value === 'object' && value !== null ? (value as DecisionLike) : {}
}

/**
 * Guidebook §11.1's mapping, plus the two cases that outrank the mode.
 *
 * Order matters: an exception is FAILED even if a partial decision object exists, and a
 * deliberately skipped turn is SKIPPED even though its (absent) mode would otherwise fall
 * through to the default.
 */
export function statusForDecision(
  decision: unknown,
  options: { error?: string; skipped?: boolean; simulated?: boolean } = {}
): DecisionRunStatus {
  // SIMULATED outranks FAILED deliberately. An operator filtering Decision Logs for FAILED is
  // looking for real production breakage; a Test Lab run that crashed appearing there is a
  // false alarm that would send them hunting a customer incident that never happened. The
  // error text is still stored in the `error` column and rendered in the detail panel, so
  // nothing is lost — only the classification changes.
  if (options.simulated) return 'SIMULATED'
  if (options.error) return 'FAILED'
  if (options.skipped) return 'SKIPPED'

  switch (asDecision(decision).mode) {
    case 'faq':
    case 'booking_context':
      return 'REPLIED'
    case 'clarify':
      return 'CLARIFIED'
    case 'handoff':
      return 'HANDOFF'
    default:
      // An unrecognised mode is a bug in the caller or a new mode nobody taught this mapping
      // about. FAILED is the honest answer: we cannot say the customer was replied to.
      return 'FAILED'
  }
}

/** The text the customer actually received, whichever field of the decision union carries it. */
export function replyTextForDecision(decision: unknown): string | null {
  const narrowed = asDecision(decision)
  if (typeof narrowed.draft === 'string') return narrowed.draft
  if (typeof narrowed.reply === 'string') return narrowed.reply
  return null
}

/**
 * Pulls the knowledge topic the answer was grounded in, when the decision names one.
 *
 * Deliberately thin: the orchestrator does not currently hand back a list of the exact chunks
 * it used, and inventing a richer structure here would mean the Decision Logs page showing
 * knowledge references the bot never actually reported. `sourceTopic` is what genuinely exists
 * today; the field is Json so it can grow without a migration once the orchestrator exposes
 * more.
 */
export function knowledgeRefsForDecision(decision: unknown): Prisma.InputJsonValue | undefined {
  const topic = asDecision(decision).sourceTopic
  return typeof topic === 'string' ? { sourceTopic: topic } : undefined
}

/**
 * Writes one run. Returns the new row's id so the caller can attach a messageId once the reply
 * has actually been stored, or null when recording failed.
 *
 * Never throws. A rejected write is logged and swallowed — see this file's header.
 */
export async function recordBotDecisionRun(params: RecordDecisionRunParams): Promise<string | null> {
  try {
    const status = statusForDecision(params.decision, {
      error: params.error,
      skipped: params.skipped,
      simulated: params.simulated,
    })
    const mode = asDecision(params.decision).mode
    const knowledgeRefs = knowledgeRefsForDecision(params.decision)
    // `trace` is a non-nullable Json column. sanitizeTrace returns JSON null for a run that had
    // no decision at all (an exception before the orchestrator returned), and Prisma rejects a
    // bare `null` there — it has to be the explicit Prisma.JsonNull sentinel. Writing `{}`
    // instead would claim an empty decision was made, which is a different and false fact.
    const sanitized = sanitizeTrace(params.decision)

    const created = await prisma.botDecisionRun.create({
      data: {
        conversationId: params.conversationId,
        messageId: params.messageId,
        // A failed or skipped run has no mode of its own; recording the status word keeps the
        // column non-null without inventing a decision that was never made.
        mode: typeof mode === 'string' ? mode : status.toLowerCase(),
        inboundText: params.inboundText,
        replyText: replyTextForDecision(params.decision),
        status,
        // Pinned to the registry rather than hardcoded, so the Decision Logs page and the Flow
        // Map cannot disagree about which flow produced a run.
        flowKey: EXISTING_BOT_FLOW_KEY,
        flowVersion: WHATSAPP_EXISTING_BOT_FLOW.version,
        startedAt: params.startedAt,
        finishedAt: params.finishedAt,
        latencyMs: Math.max(0, params.finishedAt.getTime() - params.startedAt.getTime()),
        // Sanitised BEFORE the write: a secret that reaches the database is permanent, whereas
        // one filtered at render time is still sitting there for anyone with database access.
        trace: sanitized === null ? Prisma.JsonNull : sanitized,
        knowledgeRefs,
        error: params.error,
      },
      select: { id: true },
    })
    return created.id
  } catch (error) {
    console.error('recordBotDecisionRun gagal', { conversationId: params.conversationId, error })
    return null
  }
}

/**
 * Links a recorded run to the Message that carried its reply.
 *
 * Separate from the create because the ordering is forced: the run is recorded immediately
 * after the orchestrator returns (so a turn that never sends anything is still audited), but
 * the Message row does not exist until `sendMessage` has run. Also never throws.
 */
export async function attachMessageToDecisionRun(runId: string | null, messageId?: string): Promise<void> {
  // Both arguments are treated as optional at runtime. Audit code sits directly in the bot's
  // send path, so it must be incapable of throwing there: if the run was never recorded, or
  // the caller could not produce a message id, the link is simply skipped and the customer
  // still gets their reply.
  if (!runId || !messageId) return
  try {
    await prisma.botDecisionRun.update({ where: { id: runId }, data: { messageId } })
  } catch (error) {
    console.error('attachMessageToDecisionRun gagal', { runId, messageId, error })
  }
}
