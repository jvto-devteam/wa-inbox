/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { requeueJob } from '@/lib/outbound/queue'
import { processOutboundJob } from '@/lib/outbound/worker'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/outbound/queue', () => ({ requeueJob: vi.fn() }))
vi.mock('@/lib/outbound/worker', () => ({ processOutboundJob: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function req(body: unknown, withSession = true) {
  return new Request('http://localhost/api/outbound-jobs/retry', {
    method: 'POST',
    headers: withSession ? { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
  vi.mocked(requeueJob).mockResolvedValue(true)
  vi.mocked(processOutboundJob).mockResolvedValue('sent')
  mockPrisma.outboundJob.findFirst.mockResolvedValue({ id: 'job_1', status: 'FAILED' } as never)
  mockPrisma.message.update.mockResolvedValue({ id: 'msg_1' } as never)
})

describe('POST /api/outbound-jobs/retry', () => {
  it('re-queues the message job and fires an attempt', async () => {
    const res = await POST(req({ messageId: 'msg_1' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, jobId: 'job_1' })
    expect(requeueJob).toHaveBeenCalledWith('job_1')
    expect(processOutboundJob).toHaveBeenCalledWith('job_1')
  })

  it('never creates a second Message row', async () => {
    // Guidebook §16.2: a retry must not duplicate the bubble.
    await POST(req({ messageId: 'msg_1' }))
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
  })

  it('puts the bubble back to PENDING so the agent sees the retry take effect', async () => {
    await POST(req({ messageId: 'msg_1' }))
    expect(mockPrisma.message.update).toHaveBeenCalledWith({
      where: { id: 'msg_1' },
      data: { deliveryStatus: 'PENDING' },
    })
  })

  it('picks the newest job when a message has been retried before', async () => {
    await POST(req({ messageId: 'msg_1' }))
    expect(mockPrisma.outboundJob.findFirst.mock.calls[0][0]).toMatchObject({
      where: { messageId: 'msg_1' },
      orderBy: { createdAt: 'desc' },
    })
  })

  it('is available to an AGENT — a failed message is theirs to recover', async () => {
    expect((await POST(req({ messageId: 'msg_1' }))).status).toBe(200)
  })

  it('rejects a request with no session', async () => {
    const res = await POST(req({ messageId: 'msg_1' }, false))
    expect(res.status).toBe(401)
    expect(requeueJob).not.toHaveBeenCalled()
  })

  it('explains a message that has no queue entry at all', async () => {
    // An Official-channel message never went through the queue, so there is nothing to retry.
    mockPrisma.outboundJob.findFirst.mockResolvedValue(null as never)

    const res = await POST(req({ messageId: 'msg_direct' }))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toContain('tidak punya antrean')
  })

  it('returns 409 when the job is already in flight or already sent', async () => {
    vi.mocked(requeueJob).mockResolvedValue(false)

    const res = await POST(req({ messageId: 'msg_1' }))
    expect(res.status).toBe(409)
    expect(processOutboundJob).not.toHaveBeenCalled()
    expect(mockPrisma.message.update).not.toHaveBeenCalled()
  })

  it('rejects a body with no messageId', async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Data retry tidak valid' })
  })

  it('returns 500 with the mandated { error } shape on an unexpected failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.outboundJob.findFirst.mockRejectedValue(new Error('db down'))

    const res = await POST(req({ messageId: 'msg_1' }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal mengirim ulang' })
  })
})
