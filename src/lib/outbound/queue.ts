/**
 * The outbound queue: a durable record of every send that still has to happen.
 *
 * Before this existed, `sendMessage` fired at the provider once and stored whatever came back.
 * A five-second wa-coexist outage therefore destroyed the message permanently, leaving one
 * FAILED row that nobody could retry. Unofficial is the primary send path, so that was the
 * single largest gap between this app and real operational use (guidebook §16).
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { checkOutboundSafety, type OutboundPurpose } from '@/lib/outbound/safety-guard'
import { nextAttemptAt } from '@/lib/outbound/retry-policy'

export type OutboundProvider = 'COEXIST' | 'META'

export type OutboundJobPayload = {
  /** Destination phone, resolved once at enqueue time so a retry never re-reads contact state. */
  to: string
  text: string
  media?: { url: string; type: 'image' | 'video' | 'audio' | 'document'; mimeType: string; fileName?: string }
}

export type EnqueueParams = {
  conversationId: string
  messageId: string
  contactId: string
  channel: 'OFFICIAL' | 'UNOFFICIAL'
  provider: OutboundProvider
  payload: OutboundJobPayload
  sentBy: 'BOT' | 'AGENT'
  purpose?: OutboundPurpose
}

export type EnqueueResult = {
  jobId: string | null
  blocked: boolean
  blockingReason?: string
  warnings: string[]
}

/**
 * Creates a job for one message, after the safety guard has had its say.
 *
 * A blocked send still produces a job row, with status CANCELLED and the reason in
 * `lastError`. Dropping it silently would leave an operator staring at a message that never
 * arrived with nothing anywhere explaining why — the failure mode this whole phase exists to
 * end. A cancelled job is visible, auditable, and can be retried by a human who disagrees.
 */
export async function enqueueOutboundJob(params: EnqueueParams): Promise<EnqueueResult> {
  const purpose: OutboundPurpose = params.purpose ?? (params.sentBy === 'BOT' ? 'BOT_REPLY' : 'ONE_TO_ONE')

  const safety = await checkOutboundSafety({
    conversationId: params.conversationId,
    contactId: params.contactId,
    messageText: params.payload.text || undefined,
    sentBy: params.sentBy,
    purpose,
  })

  const base = {
    conversationId: params.conversationId,
    messageId: params.messageId,
    channel: params.channel,
    provider: params.provider,
    payload: params.payload as unknown as Prisma.InputJsonValue,
  }

  try {
    if (!safety.allowed) {
      const cancelled = await prisma.outboundJob.create({
        data: { ...base, status: 'CANCELLED', lastError: safety.blockingReason ?? 'Diblokir safety guard' },
        select: { id: true },
      })
      return { jobId: cancelled.id, blocked: true, blockingReason: safety.blockingReason, warnings: safety.warnings }
    }

    const job = await prisma.outboundJob.create({
      // `nextAttemptAt` is now, not null: attempt 1 is immediate (retry-policy.ts), so a job
      // picked up by the worker a millisecond later is already due. A null here would make the
      // "due jobs" query skip it forever.
      data: { ...base, status: 'QUEUED', nextAttemptAt: nextAttemptAt(0) ?? new Date() },
      select: { id: true },
    })
    return { jobId: job.id, blocked: false, warnings: safety.warnings }
  } catch (error) {
    console.error('enqueueOutboundJob gagal', { conversationId: params.conversationId, error })
    return { jobId: null, blocked: false, warnings: [...safety.warnings, 'Gagal membuat antrean pengiriman.'] }
  }
}

/** Jobs that are due to be attempted right now, oldest first. */
export async function findDueJobs(limit: number, now: Date = new Date()) {
  return prisma.outboundJob.findMany({
    where: {
      status: { in: ['QUEUED', 'RETRYING'] },
      // A job whose nextAttemptAt was never set would otherwise be invisible to the worker.
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })
}

/**
 * Puts a FAILED or CANCELLED job back in the queue for one more immediate attempt.
 *
 * `attempts` is reset to 0 so the operator gets the full ladder again — a human pressing
 * "retry" is asserting that whatever broke has been fixed, which is different information from
 * the automatic retries that already ran.
 */
export async function requeueJob(jobId: string): Promise<boolean> {
  try {
    const job = await prisma.outboundJob.findUnique({ where: { id: jobId }, select: { status: true } })
    if (!job) return false
    // Re-queuing something already in flight would let two workers dispatch the same message.
    if (job.status === 'SENDING' || job.status === 'SENT') return false

    await prisma.outboundJob.update({
      where: { id: jobId },
      data: { status: 'QUEUED', attempts: 0, nextAttemptAt: new Date(), lastError: null },
    })
    return true
  } catch (error) {
    console.error('requeueJob gagal', { jobId, error })
    return false
  }
}
