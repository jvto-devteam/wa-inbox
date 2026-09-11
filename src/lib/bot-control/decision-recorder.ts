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
  /**
   * Id yang sudah dibuat pemanggil di AWAL penanganan pesan (src/lib/pipeline/tracer.ts),
   * bukan yang dibuat Prisma di akhir. Kanvas pipeline menyiarkan batas step secara live
   * dengan id itu; kalau baris ini lahir dengan id lain, tampilan live dan Decision Logs
   * merujuk dua run yang berbeda dan tidak ada cara menjahitnya.
   *
   * Opsional dan default-nya tetap `cuid()` milik Prisma: simulator Test Lab dan pemanggil
   * lama tidak punya tracer dan tidak boleh dipaksa membuatnya.
   */
  id?: string
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
  /**
   * Jejak langkah pipeline sejauh run ini berjalan (`PipelineTracer.snapshot()`). Sudah lewat
   * sanitizer di tracer, dan ditulis pada `create` yang memang sudah terjadi — bukan query
   * tambahan. Dua step terakhir (serahkan-agen / kirim-balasan) terjadi SETELAH baris ini
   * dibuat dan menyusul lewat `attachMessageToDecisionRun`.
   */
  steps?: unknown
}

/** Shape the orchestrator's BotDecision union takes once narrowed for reading. */
type DecisionLike = {
  mode?: unknown
  reason?: unknown
  draft?: unknown
  reply?: unknown
  sourceTopic?: unknown
  topic?: unknown
  job?: unknown
  steps?: unknown
  verification?: unknown
  knowledge?: unknown
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
 * Pulls the knowledge topic the answer was grounded in, when the decision names one, alongside
 * `decision.knowledge` (Task 17, Ruling R54) -- what was actually sent as grounding on this
 * turn, and what the topic gate turned away. Both are facts about "what was this decision
 * grounded in", so they share this one Json column rather than getting a second.
 *
 * Was deliberately thin before Task 17: the orchestrator did not hand back a list of the exact
 * chunks it used, and inventing a richer structure here would have meant the Decision Logs page
 * showing knowledge references the bot never actually reported. `decision.knowledge` is now
 * that real structure, straight off the decision the same way every other `*ForDecision` helper
 * in this file reads it -- undefined stays undefined for an older-shaped decision, never
 * invented. Reads structurally (`narrowed.knowledge !== undefined`), not by `mode`, so Task 11's
 * `knowledge` on `booking_context` decisions (Ruling R95 -- Task 17 itself left Mode 3 without
 * one, Ruling R77) is picked up here automatically, with no change needed in this file.
 */
export function knowledgeRefsForDecision(decision: unknown): Prisma.InputJsonValue | undefined {
  const narrowed = asDecision(decision)
  const refs: { sourceTopic?: string; knowledge?: unknown } = {}
  if (typeof narrowed.sourceTopic === 'string') refs.sourceTopic = narrowed.sourceTopic
  if (narrowed.knowledge !== undefined) refs.knowledge = narrowed.knowledge
  return Object.keys(refs).length > 0 ? (refs as Prisma.InputJsonValue) : undefined
}

/**
 * The price/URL verdict the orchestrator reached, when this turn ran one.
 *
 * `BotDecisionRun.verification` shipped with three readers and no writer: the Decision Logs
 * list's `hasVerification` flag, the trace panel's verification block, and the Test Lab's
 * result panel were all permanently empty because nothing ever set the column. This is the
 * writer. Returns undefined — not an empty object — for the branches that never verify
 * anything, so "no verification ran" stays distinguishable from "verification found nothing".
 */
export function verificationForDecision(decision: unknown): Prisma.InputJsonValue | undefined {
  const value = asDecision(decision).verification
  if (!value || typeof value !== 'object') return undefined
  return value as Prisma.InputJsonValue
}

/**
 * The cluster-analysis topic for this turn (Task 15), as a real column instead of buried in
 * `trace` Json. Falls back to `sourceTopic` (the only place a `faq` decision ever carried a
 * topic before Task 15 added `topic` to every variant) so neither an older row's shape nor a
 * decision that only ever set `sourceTopic` ends up NULL here.
 */
export function topicForDecision(decision: unknown): string | undefined {
  const narrowed = asDecision(decision)
  if (typeof narrowed.topic === 'string') return narrowed.topic
  if (typeof narrowed.sourceTopic === 'string') return narrowed.sourceTopic
  return undefined
}

/**
 * The sales-funnel job (J1-J5) classified for this turn (Task 15), when the decision carries
 * one. A decision returned before `classifySalesNeed` ran (keyword escalation, Mode 3) has no
 * `job` at all -- undefined here is the honest answer, not a value to invent.
 */
export function jobForDecision(decision: unknown): string | undefined {
  const value = asDecision(decision).job
  return typeof value === 'string' ? value : undefined
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
    const verification = verificationForDecision(params.decision)
    // `trace` is a non-nullable Json column. sanitizeTrace returns JSON null for a run that had
    // no decision at all (an exception before the orchestrator returned), and Prisma rejects a
    // bare `null` there — it has to be the explicit Prisma.JsonNull sentinel. Writing `{}`
    // instead would claim an empty decision was made, which is a different and false fact.
    const sanitized = sanitizeTrace(params.decision)
    // Dibersihkan lagi di sini walaupun tracer sudah membersihkan setiap `detail`: ini
    // pertahanan berlapis untuk kolom yang, sekali tercemar, permanen — dan pemanggil
    // `steps` tidak harus tracer (tipenya `unknown`).
    const sanitizedSteps = ((): Prisma.InputJsonValue | undefined => {
      if (params.steps === undefined) return undefined
      const value = sanitizeTrace(params.steps)
      return value === null ? undefined : (value as Prisma.InputJsonValue)
    })()
    // Task 17: knowledgeRefs now carries `decision.knowledge` (managed FAQ lines an operator
    // wrote), which is exactly the kind of free-form text `trace`/`steps` above already have to
    // go through this same sanitizer for -- a secret hiding in an operator-written line is no
    // safer than one in a caught error message.
    const knowledgeRefs = ((): Prisma.InputJsonValue | undefined => {
      const refs = knowledgeRefsForDecision(params.decision)
      if (refs === undefined) return undefined
      const value = sanitizeTrace(refs)
      return value === null ? undefined : (value as Prisma.InputJsonValue)
    })()

    const created = await prisma.botDecisionRun.create({
      data: {
        // Hanya disertakan bila pemanggil benar-benar punya id, supaya `@default(cuid())`
        // tetap yang berlaku untuk setiap pemanggil lama.
        ...(params.id ? { id: params.id } : {}),
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
        verification,
        // Task 15: real columns for the two classification axes, derived straight from the
        // decision object (same pattern every other `*ForDecision` helper in this file uses).
        // `undefined` here means Prisma simply omits the field on `create`, leaving the nullable
        // column NULL -- not an error, see this file's header (must never throw on a run whose
        // decision never carries either).
        topic: topicForDecision(params.decision),
        job: jobForDecision(params.decision),
        // `undefined` (bukan JsonNull) untuk run tanpa tracer: kolomnya tetap NULL, yang di
        // sini berarti "run ini tidak diinstrumentasi", bukan "run ini tidak punya langkah".
        steps: sanitizedSteps,
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
export async function attachMessageToDecisionRun(runId: string | null, messageId?: string, steps?: unknown): Promise<void> {
  // Both arguments are treated as optional at runtime. Audit code sits directly in the bot's
  // send path, so it must be incapable of throwing there: if the run was never recorded, or
  // the caller could not produce a message id, the link is simply skipped and the customer
  // still gets their reply.
  //
  // `steps` menumpang UPDATE yang memang sudah terjadi di sini, bukan query kedua. Ini
  // satu-satunya penulisan `BotDecisionRun` yang berjalan SETELAH pesan benar-benar terkirim,
  // jadi ini satu-satunya tempat dua langkah terakhir (serahkan-agen, kirim-balasan) bisa ikut
  // tersimpan. Kalau `messageId` tidak ada, tidak ada UPDATE sama sekali dan yang tersimpan
  // tetap snapshot dari `create` — lengkap sampai keputusan, hanya tanpa dua langkah kirim.
  if (!runId || !messageId) return
  try {
    await prisma.botDecisionRun.update({
      where: { id: runId },
      data: { messageId, ...(Array.isArray(steps) ? { steps: sanitizeTrace(steps) as Prisma.InputJsonValue } : {}) },
    })
  } catch (error) {
    console.error('attachMessageToDecisionRun gagal', { runId, messageId, error })
  }
}
