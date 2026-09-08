/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { writeBotAuditLog } from '@/lib/bot-control/audit'
import { broadcast } from '@/lib/realtime'
import { POST as cancel } from './[id]/cancel/route'
import { POST as pause } from './pause-provider/route'
import { POST as resume } from './resume-provider/route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/audit', () => ({ writeBotAuditLog: vi.fn() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const params = Promise.resolve({ id: 'job_1' })
const REASON = 'Provider unofficial menolak semua pengiriman pagi ini'

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job_1',
    conversationId: 'conv_1',
    messageId: 'msg_1',
    provider: 'COEXIST',
    status: 'QUEUED',
    ...overrides,
  } as never
}

function req(body: unknown, withSession = true) {
  return new Request('http://localhost/api/outbound-jobs/x', {
    method: 'POST',
    headers: withSession ? { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  vi.mocked(writeBotAuditLog).mockResolvedValue('audit_1')
  mockPrisma.outboundJob.findUnique.mockResolvedValue(job())
  mockPrisma.outboundJob.updateMany.mockResolvedValue({ count: 1 } as never)
  mockPrisma.message.update.mockResolvedValue({ id: 'msg_1', conversationId: 'conv_1' } as never)
  mockPrisma.settings.findUnique.mockResolvedValue({ pausedProviders: [] } as never)
  mockPrisma.settings.update.mockResolvedValue({ id: 1 } as never)
})

describe('POST /api/outbound-jobs/[id]/cancel', () => {
  it('cancels a queued job and audits the reason', async () => {
    const res = await cancel(req({ reason: REASON }), { params })
    expect(res.status).toBe(200)
    expect(mockPrisma.outboundJob.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'CANCELLED' })
    expect(writeBotAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'OUTBOUND_JOB', reason: REASON })
    )
  })

  it('marks the bubble FAILED, because nothing arrived from the customer side', async () => {
    // Leaving it PENDING would leave an agent waiting for a delivery that is never coming.
    await cancel(req({ reason: REASON }), { params })
    expect(mockPrisma.message.update.mock.calls[0][0].data).toEqual({ deliveryStatus: 'FAILED' })
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'message.updated' }))
  })

  it('refuses to cancel a job that has already been sent', async () => {
    // The provider has it and the customer may have read it; flipping the row would describe a
    // send that did happen as one that did not.
    mockPrisma.outboundJob.findUnique.mockResolvedValue(job({ status: 'SENT' }))
    expect((await cancel(req({ reason: REASON }), { params })).status).toBe(409)
  })

  it('answers 409 when a worker finished the job in the meantime', async () => {
    mockPrisma.outboundJob.updateMany.mockResolvedValue({ count: 0 } as never)
    expect((await cancel(req({ reason: REASON }), { params })).status).toBe(409)
  })

  it('requires a substantive reason', async () => {
    expect((await cancel(req({ reason: 'x' }), { params })).status).toBe(400)
  })

  it('refuses an AGENT, unlike retry', async () => {
    // Retry is recovery of your own message; cancelling decides someone else's message never
    // arrives, and the customer is never told.
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
    expect((await cancel(req({ reason: REASON }), { params })).status).toBe(403)
  })

  it('answers 401 without a session and 404 for a missing job', async () => {
    expect((await cancel(req({ reason: REASON }, false), { params })).status).toBe(401)

    mockPrisma.outboundJob.findUnique.mockResolvedValue(null as never)
    expect((await cancel(req({ reason: REASON }), { params })).status).toBe(404)
  })
})

describe('pause and resume provider', () => {
  it('pauses a provider and audits it as a DISABLE', async () => {
    const res = await pause(req({ provider: 'COEXIST', reason: REASON }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ provider: 'COEXIST', pausedProviders: ['COEXIST'] })
    expect(writeBotAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DISABLE', entityType: 'OUTBOUND_PROVIDER', entityKey: 'COEXIST' })
    )
  })

  it('resumes a provider and audits it as an ENABLE', async () => {
    mockPrisma.settings.findUnique.mockResolvedValue({ pausedProviders: ['COEXIST'] } as never)

    const res = await resume(req({ provider: 'COEXIST', reason: REASON }))
    expect(await res.json()).toEqual({ provider: 'COEXIST', pausedProviders: [] })
    expect(writeBotAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'ENABLE' }))
  })

  it('is idempotent both ways', async () => {
    // An operator hammering the button during an incident should not be told they did something
    // wrong.
    mockPrisma.settings.findUnique.mockResolvedValue({ pausedProviders: ['COEXIST'] } as never)
    expect((await pause(req({ provider: 'COEXIST', reason: REASON }))).status).toBe(200)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()

    mockPrisma.settings.findUnique.mockResolvedValue({ pausedProviders: [] } as never)
    expect((await resume(req({ provider: 'COEXIST', reason: REASON }))).status).toBe(200)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })

  it('rejects a provider outside the known set', async () => {
    expect((await pause(req({ provider: 'TELEGRAM', reason: REASON }))).status).toBe(400)
  })

  it('requires a reason', async () => {
    expect((await pause(req({ provider: 'COEXIST', reason: 'x' }))).status).toBe(400)
  })

  it('refuses an AGENT and a session-less request', async () => {
    expect((await pause(req({ provider: 'COEXIST', reason: REASON }, false))).status).toBe(401)

    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
    expect((await pause(req({ provider: 'COEXIST', reason: REASON }))).status).toBe(403)
    expect((await resume(req({ provider: 'COEXIST', reason: REASON }))).status).toBe(403)
  })
})
