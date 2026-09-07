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
import { findDueJobs, type OutboundJobPayload } from '@/lib/outbound/queue'
import { getPausedProviders, isProviderPaused } from '@/lib/outbound/provider-pause'

export type ProcessResult = {
  processed: number
  sent: number
  failed: number
  retrying: number
  recovered: number
  /** Jobs left untouched because their provider is paused. Counted, not hidden. */
  pausedSkipped: number
}

const DEFAULT_BATCH = 25

/**
 * How long a job may sit in SENDING before the worker holding it is presumed dead.
 *
 * The claim below is what makes concurrent workers safe, but it is also a one-way door: a
 * process that is killed between the claim and the outcome write (a deploy, an OOM, a
 * function timeout, a crashed dispatch) leaves the row in SENDING forever, and the due-jobs
 * query only ever looks at QUEUED/RETRYING. Nothing would come back for it — the customer
 * never gets the message, the bubble stays PENDING, and no error is recorded anywhere.
 *
 * Five minutes, per SDD Manage Second §8.7. The number trades two failures against each
 * other: too short re-dispatches an attempt that was merely slow, sending the customer the
 * message twice (the exact failure the atomic claim exists to prevent); too long just makes
 * them wait for a message the system already knows nothing is coming for. A wa-coexist or
 * Graph call plus a media upload is seconds, so five minutes is far outside normal and still
 * inside a single scheduler tick's patience.
 */
export const STUCK_SENDING_MS = 5 * 60_000

const STUCK_SENDING_ERROR = 'Worker berhenti saat job masih SENDING — dipulihkan otomatis.'

export type RecoveryResult = { requeued: number; failed: number }

/** Attempts every job that is currently due. Safe to call concurrently; jobs are claimed atomically. */
export async function processDueOutboundJobs(limit: number = DEFAULT_BATCH): Promise<ProcessResult> {
  const result: ProcessResult = { processed: 0, sent: 0, failed: 0, retrying: 0, recovered: 0, pausedSkipped: 0 }

  // Runs on every drain, ahead of the due query, because nothing else in the system ever looks
  // at a SENDING row. A recovered job re-enters the normal ladder (so it comes back on a later
  // tick at its backoff delay, not in this same batch) — the point is that it comes back at
  // all instead of sitting in SENDING until someone notices by hand.
  const recovery = await recoverStuckOutboundJobs()
  result.recovered = recovery.requeued + recovery.failed

  // findDueJobs, not a second copy of the same where-clause: "due" has to mean one thing.
  // Two definitions drift the moment either grows a priority, a per-provider partition, or a
  // campaign throttle — and the copy the worker does NOT use is the one that silently rots.
  const due = await findDueJobs(limit)

  // Read once per drain, not per job. A paused job is SKIPPED, never failed: a pause exists to
  // protect messages from a misbehaving provider, and failing them would destroy exactly what
  // the operator was trying to save. They stay QUEUED and go out on resume.
  const paused = await getPausedProviders()

  for (const { id, provider } of due) {
    if (paused.includes(provider as (typeof paused)[number])) {
      result.pausedSkipped += 1
      continue
    }
    const outcome = await processOutboundJob(id)
    if (outcome === 'skipped') continue
    result.processed += 1
    if (outcome === 'sent') result.sent += 1
    else if (outcome === 'failed') result.failed += 1
    else result.retrying += 1
  }

  return result
}

/**
 * Returns jobs abandoned mid-flight to the retry ladder (see STUCK_SENDING_MS).
 *
 * The crashed attempt is COUNTED, not forgiven. Recovering a job without incrementing
 * `attempts` would give a payload whose dispatch reliably kills its worker — a malformed media
 * URL that OOMs the upload, say — an unbounded supply of new claims, and it would be picked up,
 * crash, and be recovered forever. Counting it means such a job walks the same ladder every
 * other failure walks and ends up FAILED, where an operator can see it.
 */
export async function recoverStuckOutboundJobs(now: Date = new Date()): Promise<RecoveryResult> {
  const result: RecoveryResult = { requeued: 0, failed: 0 }
  const stuckBefore = new Date(now.getTime() - STUCK_SENDING_MS)

  let stuck: { id: string; attempts: number; maxAttempts: number; messageId: string | null; conversationId: string }[]
  try {
    stuck = await prisma.outboundJob.findMany({
      // `updatedAt` is the claim's own timestamp: flipping the row to SENDING is the last
      // write it received, so "not touched since stuckBefore" is exactly "claimed that long
      // ago and never finished".
      where: { status: 'SENDING', updatedAt: { lt: stuckBefore } },
      orderBy: { updatedAt: 'asc' },
      take: DEFAULT_BATCH,
      select: { id: true, attempts: true, maxAttempts: true, messageId: true, conversationId: true },
    })
  } catch (error) {
    // Recovery runs at the top of every queue drain, so it must never be able to stop one:
    // a job stuck in SENDING is bad, but no jobs moving at all is worse.
    console.error('worker: gagal mencari job SENDING yang menggantung', { error })
    return result
  }

  for (const job of stuck) {
    const attempts = job.attempts + 1
    const retryAt = canRetry(attempts, job.maxAttempts) ? nextAttemptAt(attempts, job.maxAttempts, now) : null

    try {
      // Conditional, not a plain update, and re-checking BOTH the status and the staleness
      // window: a worker that was merely slow rather than dead may have written SENT in the
      // moment between the query above and this line. Dragging that row back onto the ladder
      // would send the customer a second copy of a message that did arrive — the precise
      // failure the atomic claim exists to prevent.
      const moved = await prisma.outboundJob.updateMany({
        where: { id: job.id, status: 'SENDING', updatedAt: { lt: stuckBefore } },
        data: retryAt
          ? { status: 'RETRYING', attempts, nextAttemptAt: retryAt, lastError: STUCK_SENDING_ERROR }
          : { status: 'FAILED', attempts, nextAttemptAt: null, lastError: STUCK_SENDING_ERROR },
      })
      if (moved.count === 0) continue

      if (retryAt) {
        result.requeued += 1
        continue
      }

      result.failed += 1
      // Only now does the bubble go red. While the job is still on the ladder the message
      // stays PENDING, matching what processOutboundJob does with an ordinary failure.
      if (job.messageId) await updateMessage(job.messageId, job.conversationId, { deliveryStatus: 'FAILED' })
    } catch (error) {
      console.error('worker: gagal memulihkan job SENDING', { jobId: job.id, error })
    }
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

  // Re-checked here as well as in the drain, because the retry endpoint calls this directly. A
  // pause that a manual retry could walk straight past would not be a pause. The claim is
  // released back to QUEUED so the job is picked up normally once the provider resumes.
  if (await isProviderPaused(job.provider)) {
    await prisma.outboundJob.update({
      where: { id: jobId },
      data: { status: 'QUEUED', lastError: `Provider ${job.provider} sedang dijeda operator.` },
    })
    return 'skipped'
  }

  const payload = job.payload as unknown as OutboundJobPayload
  const attempts = job.attempts + 1

  try {
    const externalId = await dispatch(job.channel, job.provider, payload)

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

async function dispatch(channel: string, provider: string, payload: OutboundJobPayload): Promise<string | undefined> {
  // The job carries both a channel and a provider, and they have to agree. Dispatching on the
  // channel alone made `provider` decorative: a row saying UNOFFICIAL/META would still go out
  // over wa-coexist, so the audit trail would describe a send that never happened down the
  // path it names. Disagreement is a bug in whatever enqueued the job, so it is raised rather
  // than resolved by guessing which of the two fields was meant.
  const expectedProvider = channel === 'OFFICIAL' ? 'META' : 'COEXIST'
  if (provider !== expectedProvider) {
    throw new Error(`Provider ${provider} tidak cocok dengan channel ${channel} (seharusnya ${expectedProvider}).`)
  }

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
