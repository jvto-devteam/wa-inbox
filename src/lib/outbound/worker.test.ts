/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { sendCoexistText, sendCoexistMedia } from '@/lib/coexist/client'
import { sendMetaMedia } from '@/lib/meta/messages'
import { uploadMetaMediaFromUrl } from '@/lib/meta/media-upload'
import { broadcast } from '@/lib/realtime'
import { processOutboundJob, processDueOutboundJobs, recoverStuckOutboundJobs, STUCK_SENDING_MS } from './worker'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/coexist/client', () => ({ sendCoexistText: vi.fn(), sendCoexistMedia: vi.fn() }))
vi.mock('@/lib/meta/messages', () => ({ sendMetaText: vi.fn(), sendMetaMedia: vi.fn() }))
vi.mock('@/lib/meta/media-upload', () => ({ uploadMetaMediaFromUrl: vi.fn() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job_1',
    conversationId: 'conv_1',
    messageId: 'msg_1',
    channel: 'UNOFFICIAL',
    provider: 'COEXIST',
    payload: { to: '6281234567890', text: 'Halo!' },
    status: 'QUEUED',
    attempts: 0,
    maxAttempts: 4,
    nextAttemptAt: new Date(),
    lastError: null,
    ...overrides,
  } as never
}

/**
 * processDueOutboundJobs makes TWO findMany calls: stale-SENDING recovery first, then the due
 * list. Routing on the status filter keeps a test's `due` fixture from also being handed to
 * recovery and counted as a pile of abandoned jobs.
 */
function stubJobQueries({ stale = [], due = [] }: { stale?: unknown[]; due?: unknown[] } = {}) {
  mockPrisma.outboundJob.findMany.mockImplementation(
    (args: { where?: { status?: unknown } } = {}) => (args.where?.status === 'SENDING' ? stale : due) as never
  )
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  stubJobQueries()
  // Nothing paused by default; the pause tests opt in.
  mockPrisma.channelPolicySetting.findUnique.mockResolvedValue({ pausedProviders: [] } as never)
  mockPrisma.outboundJob.updateMany.mockResolvedValue({ count: 1 } as never)
  mockPrisma.outboundJob.findUnique.mockResolvedValue(job())
  mockPrisma.outboundJob.update.mockResolvedValue({ id: 'job_1' } as never)
  mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ phoneNumberId: 'pnid', accessToken: 'tok' } as never)
  mockPrisma.message.update.mockResolvedValue({ id: 'msg_1', deliveryStatus: 'SENT' } as never)
  vi.mocked(sendCoexistText).mockResolvedValue({})
})

describe('claiming', () => {
  it('claims a job atomically before doing any work', async () => {
    // Reading-then-writing would let two workers both see QUEUED and both dispatch, sending
    // the customer the same message twice -- the exact failure a queue must remove.
    await processOutboundJob('job_1')

    expect(mockPrisma.outboundJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'job_1', status: { in: ['QUEUED', 'RETRYING'] } },
      data: { status: 'SENDING' },
    })
  })

  it('skips a job another worker already claimed, without sending anything', async () => {
    mockPrisma.outboundJob.updateMany.mockResolvedValue({ count: 0 } as never)

    expect(await processOutboundJob('job_1')).toBe('skipped')
    expect(sendCoexistText).not.toHaveBeenCalled()
  })
})

describe('successful dispatch', () => {
  it('sends Unofficial text through wa-coexist and marks the job SENT', async () => {
    expect(await processOutboundJob('job_1')).toBe('sent')

    expect(sendCoexistText).toHaveBeenCalledWith(expect.objectContaining({ phoneNumberId: 'pnid' }), '6281234567890', 'Halo!')
    expect(mockPrisma.outboundJob.update.mock.calls[0][0].data).toMatchObject({ status: 'SENT', attempts: 1, lastError: null })
  })

  it('flips the message to SENT and tells the open inboxes', async () => {
    await processOutboundJob('job_1')

    expect(mockPrisma.message.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'msg_1' }, data: expect.objectContaining({ deliveryStatus: 'SENT' }) })
    )
    // Reuses the existing message.updated event, which subscribers already treat as "replace
    // this bubble" -- the same path Meta delivery receipts use.
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'message.updated', conversationId: 'conv_1' }))
  })

  it('maps audio to document for wa-coexist, which has no audio endpoint', async () => {
    mockPrisma.outboundJob.findUnique.mockResolvedValue(
      job({ payload: { to: '628123', text: '', media: { url: 'https://x/a.ogg', type: 'audio', mimeType: 'audio/ogg' } } })
    )
    vi.mocked(sendCoexistMedia).mockResolvedValue({})

    await processOutboundJob('job_1')

    expect(sendCoexistMedia).toHaveBeenCalledWith(expect.anything(), '628123', 'https://x/a.ogg', 'document', undefined)
  })

  it('never fabricates an externalId for Unofficial, which returns none', async () => {
    await processOutboundJob('job_1')
    expect(mockPrisma.message.update.mock.calls[0][0].data).not.toHaveProperty('externalId')
  })

  it('uploads then sends media on the Official path, storing the returned wamid', async () => {
    mockPrisma.outboundJob.findUnique.mockResolvedValue(
      job({ channel: 'OFFICIAL', provider: 'META', payload: { to: '628123', text: 'Lihat', media: { url: 'https://x/a.jpg', type: 'image', mimeType: 'image/jpeg' } } })
    )
    vi.mocked(uploadMetaMediaFromUrl).mockResolvedValue({ id: 'meta_1', mimeType: 'image/jpeg' })
    vi.mocked(sendMetaMedia).mockResolvedValue({ externalId: 'wamid.OUT' })

    await processOutboundJob('job_1')

    // Five arguments, not six: the queued path passes no reply context. wa-coexist has none,
    // and nothing enqueues Official today (sendMessage keeps Official on the direct path,
    // which is where the reply-context lookup lives).
    expect(sendMetaMedia).toHaveBeenCalledWith(expect.anything(), '628123', 'image', 'meta_1', 'Lihat')
    expect(mockPrisma.message.update.mock.calls[0][0].data).toMatchObject({ externalId: 'wamid.OUT' })
  })

  it('refuses a job whose provider contradicts its channel', async () => {
    // Dispatching on the channel alone made `provider` decorative: an UNOFFICIAL/META row went
    // out over wa-coexist anyway, so the audit trail described a path the send never took.
    mockPrisma.outboundJob.findUnique.mockResolvedValue(job({ channel: 'UNOFFICIAL', provider: 'META' }))

    expect(await processOutboundJob('job_1')).toBe('retrying')
    expect(sendCoexistText).not.toHaveBeenCalled()
    expect(mockPrisma.outboundJob.update.mock.calls[0][0].data.lastError).toContain('tidak cocok')
  })

  it('releases the claim instead of sending when the provider is paused mid-flight', async () => {
    // The retry endpoint calls processOutboundJob directly, bypassing the drain's check — a
    // pause a manual retry could walk past would not be a pause.
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue({ pausedProviders: ['COEXIST'] } as never)

    expect(await processOutboundJob('job_1')).toBe('skipped')
    expect(sendCoexistText).not.toHaveBeenCalled()
    expect(mockPrisma.outboundJob.update.mock.calls[0][0].data).toMatchObject({ status: 'QUEUED' })
  })

  it('reads credentials at dispatch time, never from the stored payload', async () => {
    // A payload row that outlived a token rotation would otherwise carry a dead secret.
    await processOutboundJob('job_1')
    expect(mockPrisma.waNumber.findFirstOrThrow).toHaveBeenCalled()
    expect(JSON.stringify(mockPrisma.outboundJob.update.mock.calls[0][0])).not.toContain('accessToken')
  })
})

describe('failure and retry', () => {
  it('schedules the next attempt on the ladder and keeps the message PENDING', async () => {
    // Showing FAILED on something still being retried would have an agent resend it by hand
    // and double-message the customer.
    vi.mocked(sendCoexistText).mockRejectedValue(new Error('provider down'))

    expect(await processOutboundJob('job_1')).toBe('retrying')

    const data = mockPrisma.outboundJob.update.mock.calls[0][0].data
    expect(data).toMatchObject({ status: 'RETRYING', attempts: 1, lastError: 'provider down' })
    expect(data.nextAttemptAt).toBeInstanceOf(Date)
    expect(mockPrisma.message.update).not.toHaveBeenCalled()
  })

  it('marks the job and the message FAILED once the ladder is exhausted', async () => {
    mockPrisma.outboundJob.findUnique.mockResolvedValue(job({ attempts: 3, maxAttempts: 4 }))
    vi.mocked(sendCoexistText).mockRejectedValue(new Error('still down'))

    expect(await processOutboundJob('job_1')).toBe('failed')

    expect(mockPrisma.outboundJob.update.mock.calls[0][0].data).toMatchObject({
      status: 'FAILED',
      attempts: 4,
      nextAttemptAt: null,
    })
    expect(mockPrisma.message.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deliveryStatus: 'FAILED' }) })
    )
  })

  it('respects a per-job maxAttempts lower than the ladder', async () => {
    mockPrisma.outboundJob.findUnique.mockResolvedValue(job({ attempts: 1, maxAttempts: 2 }))
    vi.mocked(sendCoexistText).mockRejectedValue(new Error('down'))
    expect(await processOutboundJob('job_1')).toBe('failed')
  })

  it('does not resend when updating the message afterwards fails', async () => {
    // The message HAS gone out at that point; throwing would put a successful job back on the
    // ladder and send it a second time.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.message.update.mockRejectedValue(new Error('db down'))

    expect(await processOutboundJob('job_1')).toBe('sent')
    expect(sendCoexistText).toHaveBeenCalledTimes(1)
  })
})

describe('processDueOutboundJobs', () => {
  it('tallies the outcome of every due job', async () => {
    stubJobQueries({ due: [{ id: 'job_1' }, { id: 'job_2' }] })
    mockPrisma.outboundJob.findUnique
      .mockResolvedValueOnce(job({ id: 'job_1' }))
      .mockResolvedValueOnce(job({ id: 'job_2' }))
    vi.mocked(sendCoexistText).mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('down'))

    expect(await processDueOutboundJobs()).toEqual({
      processed: 2,
      sent: 1,
      failed: 0,
      retrying: 1,
      recovered: 0,
      pausedSkipped: 0,
    })
  })

  it('does not count a job another worker had already claimed', async () => {
    stubJobQueries({ due: [{ id: 'job_1' }] })
    mockPrisma.outboundJob.updateMany.mockResolvedValue({ count: 0 } as never)

    expect(await processDueOutboundJobs()).toEqual({
      processed: 0,
      sent: 0,
      failed: 0,
      retrying: 0,
      recovered: 0,
      pausedSkipped: 0,
    })
  })

  it('only picks up jobs that are actually due', async () => {
    await processDueOutboundJobs(5)

    const call = mockPrisma.outboundJob.findMany.mock.calls.find(
      ([args]) => typeof args?.where?.status === 'object'
    )?.[0]
    expect(call?.where).toMatchObject({ status: { in: ['QUEUED', 'RETRYING'] } })
    expect(call?.take).toBe(5)
  })

  it('skips a job whose provider is paused, and never fails it', async () => {
    // A pause exists to protect messages from a misbehaving provider; failing them would destroy
    // exactly what the operator was trying to save.
    stubJobQueries({ due: [{ id: 'job_1', provider: 'COEXIST' }] })
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue({ pausedProviders: ['COEXIST'] } as never)

    const result = await processDueOutboundJobs()
    expect(result).toMatchObject({ pausedSkipped: 1, processed: 0, failed: 0 })
    expect(sendCoexistText).not.toHaveBeenCalled()
  })

  it('still sends for a provider that is not paused', async () => {
    stubJobQueries({ due: [{ id: 'job_1', provider: 'COEXIST' }] })
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue({ pausedProviders: ['META'] } as never)

    expect((await processDueOutboundJobs()).sent).toBe(1)
  })

  it('recovers abandoned claims on every drain, before looking for due jobs', async () => {
    // Nothing else in the system reads a SENDING row, so if a drain can skip recovery the job
    // is invisible forever. It re-enters the ladder at its backoff delay and is dispatched on
    // a later tick, not in this same batch.
    stubJobQueries({ stale: [{ id: 'job_stale', attempts: 0, maxAttempts: 4, messageId: null, conversationId: 'conv_1' }] })

    const result = await processDueOutboundJobs()

    expect(result.recovered).toBe(1)
    const statuses = mockPrisma.outboundJob.findMany.mock.calls.map(([args]) => args?.where?.status)
    expect(statuses[0]).toBe('SENDING')
  })
})

describe('recoverStuckOutboundJobs', () => {
  const stale = (overrides: Record<string, unknown> = {}) => ({
    id: 'job_stale',
    attempts: 0,
    maxAttempts: 4,
    messageId: 'msg_1',
    conversationId: 'conv_1',
    ...overrides,
  })

  it('puts a job abandoned in SENDING back on the retry ladder', async () => {
    // Without this the row sits in SENDING forever: the due query only reads QUEUED/RETRYING,
    // so nothing ever comes back for it and the customer never gets the message.
    stubJobQueries({ stale: [stale()] })

    expect(await recoverStuckOutboundJobs()).toEqual({ requeued: 1, failed: 0 })
    expect(mockPrisma.outboundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'RETRYING', attempts: 1 }),
      })
    )
  })

  it('uses the five-minute window the SDD pins it to', async () => {
    // SDD Manage Second §8.7. Shortening it re-dispatches attempts that were merely slow and
    // double-messages the customer; lengthening it makes them wait for a message the system
    // already knows is not coming. Pinned here so a casual edit has to argue with the spec.
    expect(STUCK_SENDING_MS).toBe(5 * 60_000)
  })

  it('only looks at jobs whose claim is older than the stuck window', async () => {
    const now = new Date('2026-09-07T10:00:00Z')
    await recoverStuckOutboundJobs(now)

    const call = mockPrisma.outboundJob.findMany.mock.calls[0][0]
    expect(call?.where).toMatchObject({ status: 'SENDING' })
    expect(call?.where?.updatedAt).toEqual({ lt: new Date(now.getTime() - STUCK_SENDING_MS) })
  })

  it('counts the crashed attempt, so a job that kills its worker eventually fails', async () => {
    // The alternative is an infinite loop: recover, crash, recover, forever, with nothing
    // anywhere telling an operator the message is never going out.
    stubJobQueries({ stale: [stale({ attempts: 3, maxAttempts: 4 })] })

    expect(await recoverStuckOutboundJobs()).toEqual({ requeued: 0, failed: 1 })
    expect(mockPrisma.outboundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', attempts: 4 }) })
    )
    expect(mockPrisma.message.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deliveryStatus: 'FAILED' }) })
    )
  })

  it('leaves the bubble PENDING while the job is still on the ladder', async () => {
    stubJobQueries({ stale: [stale()] })

    await recoverStuckOutboundJobs()

    expect(mockPrisma.message.update).not.toHaveBeenCalled()
  })

  it('re-checks the claim, so a slow-but-alive worker is never dragged back', async () => {
    // A worker that finished between the query and the write has already recorded SENT. Moving
    // that row onto the ladder would send the customer a second copy of a message that arrived.
    stubJobQueries({ stale: [stale()] })
    mockPrisma.outboundJob.updateMany.mockResolvedValue({ count: 0 } as never)

    expect(await recoverStuckOutboundJobs()).toEqual({ requeued: 0, failed: 0 })
    expect(mockPrisma.outboundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'SENDING' }) })
    )
  })

  it('never stops the queue when the recovery query itself fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.outboundJob.findMany.mockRejectedValue(new Error('db down'))

    expect(await recoverStuckOutboundJobs()).toEqual({ requeued: 0, failed: 0 })
  })
})
