/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))
vi.mock('@/lib/booking-actions/history', () => ({ recordEvent: vi.fn().mockResolvedValue(undefined) }))

import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { broadcast } from '@/lib/realtime'
import { recordEvent } from '@/lib/booking-actions/history'
import { PATCH } from './route'

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const req = (body: unknown) =>
  new Request('http://localhost/api/booking-actions/a1', {
    method: 'PATCH', headers: { cookie: 'wa_inbox_session=tok', 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
const ctx = { params: Promise.resolve({ id: 'a1' }) }
const action = (over: Record<string, unknown> = {}) => ({
  id: 'a1', conversationId: 'c1', bookingId: '77', type: 'CHANGE', field: 'pickup_point', proposedValue: 'X', state: 'OPEN', ...over,
})

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(recordEvent).mockClear()
  vi.mocked(broadcast).mockClear()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc1', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) => fn(mockPrisma)) as never)
  mockPrisma.bookingAction.findUnique.mockResolvedValue(action() as never)
  mockPrisma.bookingAction.updateMany.mockResolvedValue({ count: 1 } as never)
})

describe('PATCH /api/booking-actions/[id]', () => {
  it('401 without session', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null)
    expect((await PATCH(req({ op: 'reject' }), ctx)).status).toBe(401)
  })

  it('400 on invalid body', async () => {
    expect((await PATCH(req({ op: 'explode' }), ctx)).status).toBe(400)
  })

  it('404 when action missing', async () => {
    mockPrisma.bookingAction.findUnique.mockResolvedValue(null)
    expect((await PATCH(req({ op: 'reject' }), ctx)).status).toBe(404)
  })

  it('AGENT can reject', async () => {
    expect((await PATCH(req({ op: 'reject' }), ctx)).status).toBe(200)
  })

  it('reject records REJECTED with accountId', async () => {
    await PATCH(req({ op: 'reject', reason: 'salah paham' }), ctx)
    expect(mockPrisma.bookingAction.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', state: 'OPEN' },
      data: expect.objectContaining({ state: 'REJECTED', closedReason: 'REJECTED', closedById: 'acc1', closedAt: expect.any(Date) }),
    })
    expect(recordEvent).toHaveBeenCalledWith(mockPrisma, expect.objectContaining({
      event: 'REJECTED', actor: 'ACCOUNT', accountId: 'acc1', actionId: 'a1', conversationId: 'c1', reason: 'salah paham',
    }))
    expect(broadcast).toHaveBeenCalledWith({ type: 'booking-actions.changed', conversationId: 'c1' })
  })

  it('409 on closed action', async () => {
    mockPrisma.bookingAction.findUnique.mockResolvedValue(action({ state: 'EXECUTED' }) as never)
    expect((await PATCH(req({ op: 'reject' }), ctx)).status).toBe(409)
    expect(recordEvent).not.toHaveBeenCalled()
  })

  it('409 when a concurrent click closed it first (conditional update count 0)', async () => {
    mockPrisma.bookingAction.updateMany.mockResolvedValue({ count: 0 } as never)
    expect((await PATCH(req({ op: 'reject' }), ctx)).status).toBe(409)
    expect(recordEvent).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('dismiss on MISMATCH -> RESOLVED / DISMISSED_CHAT_WRONG', async () => {
    mockPrisma.bookingAction.findUnique.mockResolvedValue(action({ type: 'MISMATCH' }) as never)
    expect((await PATCH(req({ op: 'dismiss' }), ctx)).status).toBe(200)
    expect(mockPrisma.bookingAction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: 'RESOLVED', closedReason: 'DISMISSED_CHAT_WRONG' }),
    }))
    expect(recordEvent).toHaveBeenCalledWith(mockPrisma, expect.objectContaining({ event: 'RESOLVED' }))
  })

  it('done on TASK -> DONE / MARKED_DONE with note; not_needed -> NOT_NEEDED', async () => {
    mockPrisma.bookingAction.findUnique.mockResolvedValue(action({ type: 'TASK' }) as never)
    await PATCH(req({ op: 'done', note: 'sudah di backoffice' }), ctx)
    expect(mockPrisma.bookingAction.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: 'DONE', closedReason: 'MARKED_DONE' }),
    }))
    expect(recordEvent).toHaveBeenLastCalledWith(mockPrisma, expect.objectContaining({ event: 'RESOLVED', reason: 'sudah di backoffice' }))
    await PATCH(req({ op: 'not_needed' }), ctx)
    expect(mockPrisma.bookingAction.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: 'DONE', closedReason: 'NOT_NEEDED' }),
    }))
  })

  it('400 when op does not fit the action type', async () => {
    mockPrisma.bookingAction.findUnique.mockResolvedValue(action({ type: 'MISMATCH' }) as never)
    expect((await PATCH(req({ op: 'reject' }), ctx)).status).toBe(400)
    mockPrisma.bookingAction.findUnique.mockResolvedValue(action({ type: 'CHANGE' }) as never)
    expect((await PATCH(req({ op: 'dismiss' }), ctx)).status).toBe(400)
    mockPrisma.bookingAction.findUnique.mockResolvedValue(action({ type: 'DATA_REQUEST' }) as never)
    expect((await PATCH(req({ op: 'done' }), ctx)).status).toBe(400)
    expect(mockPrisma.bookingAction.updateMany).not.toHaveBeenCalled()
  })

  it('500 generic on failure', async () => {
    mockPrisma.bookingAction.findUnique.mockRejectedValue(new Error('secret'))
    const res = await PATCH(req({ op: 'reject' }), ctx)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
  })
})
