/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { checkOutboundSafety } from '@/lib/outbound/safety-guard'
import { enqueueOutboundJob, findDueJobs, requeueJob } from './queue'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/outbound/safety-guard', () => ({ checkOutboundSafety: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const params = {
  conversationId: 'conv_1',
  messageId: 'msg_1',
  contactId: 'contact_1',
  channel: 'UNOFFICIAL' as const,
  provider: 'COEXIST' as const,
  payload: { to: '6281234567890', text: 'Halo!' },
  sentBy: 'AGENT' as const,
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(checkOutboundSafety).mockResolvedValue({ allowed: true, warnings: [] })
  mockPrisma.outboundJob.create.mockResolvedValue({ id: 'job_1' } as never)
})

describe('enqueueOutboundJob', () => {
  it('creates a QUEUED job that is immediately due', async () => {
    // nextAttemptAt is now, not null: attempt 1 has zero delay, so the worker must see it as
    // due the instant it looks. A null would make the due-jobs query skip it forever.
    const result = await enqueueOutboundJob(params)

    expect(result).toMatchObject({ jobId: 'job_1', blocked: false })
    const data = mockPrisma.outboundJob.create.mock.calls[0][0].data
    expect(data).toMatchObject({ status: 'QUEUED', conversationId: 'conv_1', messageId: 'msg_1', provider: 'COEXIST' })
    expect(data.nextAttemptAt).toBeInstanceOf(Date)
  })

  it('stores the resolved destination in the payload', async () => {
    // A retry ten minutes later must send to the number this message was addressed to, not to
    // whatever the contact row says by then.
    await enqueueOutboundJob(params)
    expect(mockPrisma.outboundJob.create.mock.calls[0][0].data.payload).toEqual({
      to: '6281234567890',
      text: 'Halo!',
    })
  })

  it('runs the safety guard with a purpose derived from the sender', async () => {
    await enqueueOutboundJob({ ...params, sentBy: 'BOT' })
    expect(checkOutboundSafety).toHaveBeenCalledWith(expect.objectContaining({ sentBy: 'BOT', purpose: 'BOT_REPLY' }))

    await enqueueOutboundJob(params)
    expect(checkOutboundSafety).toHaveBeenLastCalledWith(expect.objectContaining({ purpose: 'ONE_TO_ONE' }))
  })

  it('honours an explicit purpose over the derived one', async () => {
    await enqueueOutboundJob({ ...params, purpose: 'CAMPAIGN' })
    expect(checkOutboundSafety).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'CAMPAIGN' }))
  })

  it('records a blocked send as a CANCELLED job carrying the reason', async () => {
    // Dropping it silently would leave an operator staring at a message that never arrived
    // with nothing anywhere explaining why.
    vi.mocked(checkOutboundSafety).mockResolvedValue({
      allowed: false,
      warnings: [],
      blockingReason: 'Kontak ini menolak menerima campaign (opt-out).',
    })

    const result = await enqueueOutboundJob({ ...params, purpose: 'CAMPAIGN' })

    expect(result.blocked).toBe(true)
    expect(result.blockingReason).toContain('opt-out')
    expect(mockPrisma.outboundJob.create.mock.calls[0][0].data).toMatchObject({
      status: 'CANCELLED',
      lastError: 'Kontak ini menolak menerima campaign (opt-out).',
    })
  })

  it('passes the guard warnings back to the caller', async () => {
    vi.mocked(checkOutboundSafety).mockResolvedValue({ allowed: true, warnings: ['Kontak ini menandai opt-out.'] })
    expect((await enqueueOutboundJob(params)).warnings).toEqual(['Kontak ini menandai opt-out.'])
  })

  it('returns a null job id instead of throwing when the insert fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.outboundJob.create.mockRejectedValue(new Error('db down'))

    const result = await enqueueOutboundJob(params)
    expect(result.jobId).toBeNull()
    expect(result.warnings.some((w) => w.includes('Gagal membuat antrean'))).toBe(true)
  })
})

describe('findDueJobs', () => {
  it('selects QUEUED and RETRYING jobs that are due, oldest first', async () => {
    mockPrisma.outboundJob.findMany.mockResolvedValue([] as never)
    const now = new Date('2026-09-05T05:00:00.000Z')

    await findDueJobs(10, now)

    const call = mockPrisma.outboundJob.findMany.mock.calls[0][0]
    expect(call?.where).toMatchObject({ status: { in: ['QUEUED', 'RETRYING'] } })
    expect(call?.where?.OR).toEqual([{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }])
    expect(call?.orderBy).toEqual({ createdAt: 'asc' })
    expect(call?.take).toBe(10)
  })

  it('includes jobs with no nextAttemptAt, which would otherwise be invisible forever', async () => {
    mockPrisma.outboundJob.findMany.mockResolvedValue([] as never)
    await findDueJobs(5)
    expect(mockPrisma.outboundJob.findMany.mock.calls[0][0]?.where?.OR).toContainEqual({ nextAttemptAt: null })
  })
})

describe('requeueJob', () => {
  it('resets a failed job for a fresh full ladder', async () => {
    // A human pressing retry is asserting that whatever broke has been fixed -- different
    // information from the automatic retries that already ran.
    mockPrisma.outboundJob.findUnique.mockResolvedValue({ status: 'FAILED' } as never)
    mockPrisma.outboundJob.update.mockResolvedValue({ id: 'job_1' } as never)

    expect(await requeueJob('job_1')).toBe(true)
    expect(mockPrisma.outboundJob.update.mock.calls[0][0].data).toMatchObject({
      status: 'QUEUED',
      attempts: 0,
      lastError: null,
    })
  })

  it('re-queues a job the safety guard cancelled, so a human can override it', async () => {
    mockPrisma.outboundJob.findUnique.mockResolvedValue({ status: 'CANCELLED' } as never)
    mockPrisma.outboundJob.update.mockResolvedValue({ id: 'job_1' } as never)
    expect(await requeueJob('job_1')).toBe(true)
  })

  it('refuses to re-queue a job that is already in flight or done', async () => {
    // Re-queuing something mid-dispatch would let two workers send the same message.
    mockPrisma.outboundJob.findUnique.mockResolvedValue({ status: 'SENDING' } as never)
    expect(await requeueJob('job_1')).toBe(false)

    mockPrisma.outboundJob.findUnique.mockResolvedValue({ status: 'SENT' } as never)
    expect(await requeueJob('job_1')).toBe(false)
    expect(mockPrisma.outboundJob.update).not.toHaveBeenCalled()
  })

  it('returns false for a job that does not exist', async () => {
    mockPrisma.outboundJob.findUnique.mockResolvedValue(null as never)
    expect(await requeueJob('nope')).toBe(false)
  })

  it('returns false instead of throwing when the update fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.outboundJob.findUnique.mockResolvedValue({ status: 'FAILED' } as never)
    mockPrisma.outboundJob.update.mockRejectedValue(new Error('db down'))
    expect(await requeueJob('job_1')).toBe(false)
  })
})
