/**
 * Runs the REAL decision engine against a message without sending anything to WhatsApp.
 *
 * --- The problem this file exists to solve ---
 *
 * `decideAndRespond` is not a pure function. It writes, in three places:
 *
 *   1. `tripBrief` on the conversation, via a raw `UPDATE ... jsonb || jsonb` merge
 *      (orchestrator.ts's `persistTripBrief`) — destination, origin, day count,
 *      askedTripPreferences, lastTopic.
 *   2. `bookingData` / `bookingCheckedAt` / `pipelineStage` / `orderChannel`, via
 *      `ensureFreshBookingData` (booking/client.ts).
 *   3. `KnowledgeGapLog` rows, when nothing can be resolved.
 *
 * So "just call the decision engine against the chosen conversation" — the obvious reading of
 * guidebook §13 — would let a dry run silently rewrite a real customer's trip brief, advance
 * their pipeline stage, and file fake knowledge gaps. A test lab that corrupts production data
 * is worse than no test lab.
 *
 * --- What this does instead ---
 *
 * Every simulation runs against the ONE sandbox conversation (`isTest`, src/lib/
 * test-conversation.ts) whose entire purpose is to absorb exactly these writes. To keep the
 * "use an existing conversation's context" option meaningful, the chosen conversation's
 * tripBrief is COPIED into the sandbox first, and the sandbox's own brief is snapshotted and
 * restored afterwards so repeated runs neither accumulate state nor disturb the human-driven
 * test room. Knowledge-gap rows the run files against the sandbox are removed for the same
 * reason: a simulated question must not show up in the operator's real gap-to-task list.
 *
 * --- The one fidelity gap, reported rather than hidden ---
 *
 * `ensureFreshBookingData` returns null for any `isTest` conversation by design (a sandbox
 * phone with no digits would otherwise match a real customer's booking). So `booking_context`
 * mode cannot be reproduced here. That is a genuine limit of "sama dengan decision engine
 * existing SEJAUH MUNGKIN", and it is surfaced in `warnings` whenever the chosen conversation
 * actually has booking data — never papered over.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { decideAndRespond } from '@/lib/bot/orchestrator'
import { resolveChannel } from '@/lib/channel-router'
import { ensureTestConversation, TEST_CONTACT_PHONE } from '@/lib/test-conversation'
import { recordBotDecisionRun } from '@/lib/bot-control/decision-recorder'
import type { BotDecision, TraceStep } from '@/lib/bot/types'

export type SimulationContextMode = 'none' | 'conversation' | 'test-room'

export type SimulationRequest = {
  message: string
  conversationId?: string
  contactPhone?: string
  contactName?: string
  useExistingHistory?: boolean
  dryRun?: boolean
}

export type SimulationStatus = 'WOULD_REPLY' | 'WOULD_CLARIFY' | 'WOULD_HANDOFF' | 'FAILED'

export type SimulationResult = {
  mode: string
  reply: string | null
  status: SimulationStatus
  flowSteps: TraceStep[]
  knowledgeRefs: { sourceTopic?: string } | null
  verification: Record<string, unknown> | null
  warnings: string[]
  wouldSendViaChannel: 'OFFICIAL' | 'UNOFFICIAL'
  /** The audit row this simulation wrote, so the operator can open it in Decision Logs. */
  decisionRunId: string | null
  latencyMs: number
}

const SANDBOX_NOTICE =
  'Simulasi dijalankan pada percakapan sandbox, bukan percakapan aslinya. Tidak ada data percakapan asli yang berubah.'

export function statusForSimulation(decision: BotDecision | null): SimulationStatus {
  switch (decision?.mode) {
    case 'faq':
    case 'booking_context':
      return 'WOULD_REPLY'
    case 'clarify':
      return 'WOULD_CLARIFY'
    case 'handoff':
      return 'WOULD_HANDOFF'
    default:
      return 'FAILED'
  }
}

export function replyFromDecision(decision: BotDecision | null): string | null {
  if (!decision) return null
  if (decision.mode === 'faq') return decision.draft
  if (decision.mode === 'booking_context' || decision.mode === 'clarify') return decision.reply
  // A handoff never produces a customer-facing draft; its reason is not the reply text (see
  // inbound.ts's handoff branch, which sends a fixed generic acknowledgment instead).
  return null
}

/** Which context the operator asked for, derived from the guidebook's request shape. */
export function resolveContextMode(request: SimulationRequest): SimulationContextMode {
  if (request.conversationId && request.useExistingHistory !== false) return 'conversation'
  if (request.conversationId) return 'test-room'
  return 'none'
}

export async function runSimulation(request: SimulationRequest): Promise<SimulationResult> {
  const warnings: string[] = [SANDBOX_NOTICE]
  const startedAt = new Date()

  // Fields the guidebook's request shape carries but the sandbox cannot honour. Reported
  // rather than silently ignored: an operator who typed a phone number needs to know it did
  // not steer the run, or they will read the result as being about that customer.
  if (request.contactPhone || request.contactName) {
    warnings.push(
      'contactPhone/contactName diabaikan: simulasi selalu memakai kontak sandbox, sehingga pencarian booking per-nomor tidak dijalankan.'
    )
  }

  await ensureTestConversation()
  const sandbox = await prisma.conversation.findFirstOrThrow({
    where: { isTest: true, contact: { phone: TEST_CONTACT_PHONE } },
    select: { id: true, tripBrief: true },
  })

  // Snapshotted so the sandbox is put back exactly as it was. Without this, a simulation would
  // leave its destination/day-count behind and quietly steer both the next simulation and the
  // admin's own manual test-room chat.
  const sandboxBriefBefore = sandbox.tripBrief

  const contextMode = resolveContextMode(request)
  let seededBrief: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull

  if (contextMode === 'conversation' && request.conversationId) {
    const source = await prisma.conversation.findUnique({
      where: { id: request.conversationId },
      select: { tripBrief: true, bookingData: true },
    })
    if (!source) {
      warnings.push('Percakapan yang dipilih tidak ditemukan — simulasi dijalankan tanpa konteks.')
    } else {
      seededBrief = (source.tripBrief ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull
      if (source.bookingData != null) {
        warnings.push(
          'Percakapan ini punya data booking, tetapi pencarian booking dimatikan di sandbox — mode booking_context tidak akan muncul di hasil simulasi ini.'
        )
      }
    }
  } else if (contextMode === 'test-room') {
    // Keep whatever the test room already holds.
    seededBrief = (sandboxBriefBefore ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull
  }

  await prisma.conversation.update({ where: { id: sandbox.id }, data: { tripBrief: seededBrief } })

  let decision: BotDecision | null = null
  let error: string | undefined
  try {
    // The real engine, unmodified. sendMessage is never imported by this module, so a
    // simulation structurally cannot dispatch a WhatsApp message or enqueue an outbound job.
    decision = await decideAndRespond(sandbox.id, request.message)
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
    warnings.push(`Decision engine gagal: ${error}`)
  }

  const finishedAt = new Date()

  // Restore and clean up in a finally-shaped sequence of their own try/catch: a failure to tidy
  // up must not throw away a simulation result the operator is waiting for.
  await restoreSandbox(sandbox.id, sandboxBriefBefore, startedAt)

  const decisionRunId = await recordBotDecisionRun({
    conversationId: sandbox.id,
    inboundText: request.message,
    decision,
    startedAt,
    finishedAt,
    error,
    simulated: true,
  })

  // A pure read of Settings.defaultChannel — resolveChannel writes nothing.
  const wouldSendViaChannel = await resolveChannel()

  return {
    mode: decision?.mode ?? 'failed',
    reply: replyFromDecision(decision),
    status: statusForSimulation(decision),
    flowSteps: decision?.steps ?? [],
    knowledgeRefs: decision?.mode === 'faq' ? { sourceTopic: decision.sourceTopic } : null,
    // The orchestrator does not hand back a separate verification object today; reply
    // verification happens inside composeVerifiedReply and only its OUTCOME reaches the trace.
    // Returning null is honest — inventing a shape here would show the operator a verification
    // result the engine never produced.
    verification: null,
    warnings,
    wouldSendViaChannel,
    decisionRunId,
    latencyMs: finishedAt.getTime() - startedAt.getTime(),
  }
}

async function restoreSandbox(sandboxId: string, briefBefore: Prisma.JsonValue, startedAt: Date): Promise<void> {
  try {
    await prisma.conversation.update({
      where: { id: sandboxId },
      data: { tripBrief: briefBefore === null ? Prisma.DbNull : (briefBefore as Prisma.InputJsonValue) },
    })
    // Gap rows this run filed against the sandbox. Scoped by both conversation and time so a
    // gap logged by the admin's own manual test-room chat a minute earlier is left alone.
    await prisma.knowledgeGapLog.deleteMany({
      where: { conversationId: sandboxId, createdAt: { gte: startedAt } },
    })
  } catch (caught) {
    console.error('runSimulation: gagal mengembalikan state sandbox', caught)
  }
}
