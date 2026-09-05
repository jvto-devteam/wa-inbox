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
import { processOutboundJob, processDueOutboundJobs } from './worker'

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

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
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
    mockPrisma.outboundJob.findMany.mockResolvedValue([{ id: 'job_1' }, { id: 'job_2' }] as never)
    mockPrisma.outboundJob.findUnique
      .mockResolvedValueOnce(job({ id: 'job_1' }))
      .mockResolvedValueOnce(job({ id: 'job_2' }))
    vi.mocked(sendCoexistText).mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('down'))

    expect(await processDueOutboundJobs()).toEqual({ processed: 2, sent: 1, failed: 0, retrying: 1 })
  })

  it('does not count a job another worker had already claimed', async () => {
    mockPrisma.outboundJob.findMany.mockResolvedValue([{ id: 'job_1' }] as never)
    mockPrisma.outboundJob.updateMany.mockResolvedValue({ count: 0 } as never)

    expect(await processDueOutboundJobs()).toEqual({ processed: 0, sent: 0, failed: 0, retrying: 0 })
  })

  it('only picks up jobs that are actually due', async () => {
    mockPrisma.outboundJob.findMany.mockResolvedValue([] as never)
    await processDueOutboundJobs(5)

    const call = mockPrisma.outboundJob.findMany.mock.calls[0][0]
    expect(call?.where).toMatchObject({ status: { in: ['QUEUED', 'RETRYING'] } })
    expect(call?.take).toBe(5)
  })
})
