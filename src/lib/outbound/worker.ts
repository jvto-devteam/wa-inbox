/**
 * Processes queued outbound jobs: the half of the queue that actually talks to a provider.
 *
 * --- Concurrency ---
 *
 * A job is claimed with a conditional `updateMany` that flips QUEUED/RETRYING to SENDING and
 * checks how many rows it changed. Two workers racing for the same job therefore produce
 * exactly one winner (count 1) and one loser (count 0), because Postgres serialises the two
 * updates on the row lock. Reading-then-writing instead would let both see QUEUED and both
 * dispatch — sending the customer the same message twice, which is precisely the failure an
 * outbound queue is supposed to remove.
 *
 * --- Message status ---
 *
 * `Message.deliveryStatus` follows the job: PENDING while queued, SENT on success, FAILED once
 * the ladder is exhausted. The bubble in the inbox is therefore always telling the truth about
 * where a message actually is.
 */
import { prisma } from '@/lib/db'
import { sendMetaText, sendMetaMedia } from '@/lib/meta/messages'
import { uploadMetaMediaFromUrl } from '@/lib/meta/media-upload'
import { sendCoexistText, sendCoexistMedia } from '@/lib/coexist/client'
import { broadcast } from '@/lib/realtime'
import { withMediaUrl } from '@/lib/serialize-message'
import { canRetry, nextAttemptAt } from '@/lib/outbound/retry-policy'
import type { OutboundJobPayload } from '@/lib/outbound/queue'

export type ProcessResult = { processed: number; sent: number; failed: number; retrying: number }

const DEFAULT_BATCH = 25

/** Attempts every job that is currently due. Safe to call concurrently; jobs are claimed atomically. */
export async function processDueOutboundJobs(limit: number = DEFAULT_BATCH): Promise<ProcessResult> {
  const result: ProcessResult = { processed: 0, sent: 0, failed: 0, retrying: 0 }

  const due = await prisma.outboundJob.findMany({
    where: {
      status: { in: ['QUEUED', 'RETRYING'] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  })

  for (const { id } of due) {
    const outcome = await processOutboundJob(id)
    if (outcome === 'skipped') continue
    result.processed += 1
    if (outcome === 'sent') result.sent += 1
    else if (outcome === 'failed') result.failed += 1
    else result.retrying += 1
  }

  return result
}

export type JobOutcome = 'sent' | 'failed' | 'retrying' | 'skipped'

export async function processOutboundJob(jobId: string): Promise<JobOutcome> {
  // Atomic claim. `count === 0` means another worker got there first, or the job left the
  // queue between the due-list query and now.
  const claim = await prisma.outboundJob.updateMany({
    where: { id: jobId, status: { in: ['QUEUED', 'RETRYING'] } },
    data: { status: 'SENDING' },
  })
  if (claim.count === 0) return 'skipped'

  const job = await prisma.outboundJob.findUnique({ where: { id: jobId } })
  if (!job) return 'skipped'

  const payload = job.payload as unknown as OutboundJobPayload
  const attempts = job.attempts + 1

  try {
    const externalId = await dispatch(job.channel, payload)

    await prisma.outboundJob.update({
      where: { id: jobId },
      data: { status: 'SENT', attempts, nextAttemptAt: null, lastError: null },
    })
    if (job.messageId) {
      // `externalId` is only ever produced by the Official path; wa-coexist returns nothing to
      // correlate against (see channel-capabilities.ts), so it stays null there rather than
      // being filled with a fabricated id.
      await updateMessage(job.messageId, job.conversationId, {
        deliveryStatus: 'SENT',
        ...(externalId ? { externalId } : {}),
      })
    }
    return 'sent'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const retryAt = canRetry(attempts, job.maxAttempts) ? nextAttemptAt(attempts, job.maxAttempts) : null

    if (retryAt) {
      await prisma.outboundJob.update({
        where: { id: jobId },
        data: { status: 'RETRYING', attempts, nextAttemptAt: retryAt, lastError: message },
      })
      // The message stays PENDING, not FAILED: it has not failed yet, and showing a red
      // FAILED badge on something the system is still actively retrying would have an agent
      // resend it by hand and double-message the customer.
      return 'retrying'
    }

    await prisma.outboundJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', attempts, nextAttemptAt: null, lastError: message },
    })
    if (job.messageId) await updateMessage(job.messageId, job.conversationId, { deliveryStatus: 'FAILED' })
    return 'failed'
  }
}

async function dispatch(channel: string, payload: OutboundJobPayload): Promise<string | undefined> {
  // Credentials are read here, at dispatch time, and never stored on the job — a payload row
  // that outlived a token rotation would otherwise carry a dead secret in the database.
  const waNumber = await prisma.waNumber.findFirstOrThrow()

  if (channel === 'OFFICIAL') {
    if (payload.media) {
      const uploaded = await uploadMetaMediaFromUrl(waNumber, payload.media.url)
      const sent = await sendMetaMedia(waNumber, payload.to, payload.media.type, uploaded.id, payload.text || undefined)
      return sent.externalId
    }
    const sent = await sendMetaText(waNumber, payload.to, payload.text)
    return sent.externalId
  }

  if (payload.media) {
    // wa-coexist has no audio endpoint; audio rides send_file_url as a document, exactly as
    // the pre-queue send path did. Message.type still says 'audio' so the bubble renders a player.
    const sent = await sendCoexistMedia(
      waNumber,
      payload.to,
      payload.media.url,
      payload.media.type === 'audio' ? 'document' : payload.media.type,
      payload.text || undefined
    )
    return sent.externalId
  }

  const sent = await sendCoexistText(waNumber, payload.to, payload.text)
  return sent.externalId
}

/**
 * Writes the new delivery status onto the message and tells the open inboxes about it.
 *
 * Failure here is logged and swallowed: the message HAS been sent at this point, and throwing
 * would flip a successful job back onto the retry ladder and send it a second time.
 */
async function updateMessage(
  messageId: string,
  conversationId: string,
  data: { deliveryStatus: 'SENT' | 'FAILED'; externalId?: string }
): Promise<void> {
  try {
    const updated = await prisma.message.update({ where: { id: messageId }, data, include: { replyTo: true } })
    // Reuses the existing `message.updated` event rather than inventing a new one: subscribers
    // already know to REPLACE a bubble on it (it is what Meta delivery receipts use), so a
    // queued send's status change lands in the inbox through a path that is already tested.
    broadcast({ type: 'message.updated', conversationId, message: withMediaUrl(updated) })
  } catch (error) {
    console.error('worker: gagal memperbarui status pesan', { messageId, error })
  }
}
