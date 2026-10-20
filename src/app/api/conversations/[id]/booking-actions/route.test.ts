/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/booking-actions/impact', () => ({
  computeImpact: vi.fn().mockResolvedValue({ crewClashes: ['Andi'], hotelNights: [], medicalCheckupDate: null }),
}))

import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { computeImpact } from '@/lib/booking-actions/impact'
import { GET } from './route'

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const req = () => new Request('http://localhost/api/conversations/c1/booking-actions', { headers: { cookie: 'wa_inbox_session=tok' } })
const ctx = { params: Promise.resolve({ id: 'c1' }) }

const bookingData = (pickup: string) => ({
  booking_id: 77, id: 'JVTO-77', date: { start: '2026-11-01', end: '2026-11-02' },
  pickup: { meeting_point: pickup },
})
const row = (over: Record<string, unknown>) => ({
  id: 'a1', conversationId: 'c1', bookingId: '77', type: 'CHANGE', field: 'pickup_point', tier: 'AI',
  proposedValue: 'Surabaya Hotel', state: 'OPEN', createdAt: new Date('2026-10-20T00:00:00Z'), ...over,
})

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(computeImpact).mockClear()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.bookingActionEvent.findMany.mockResolvedValue([])
  mockPrisma.bookingAction.updateMany.mockResolvedValue({ count: 0 } as never)
})

describe('GET /api/conversations/[id]/booking-actions', () => {
  it('lists recently EXECUTED actions (last 24 h, current booking) with the old value from their EXECUTED event', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({ bookingData: bookingData('X') } as never)
    mockPrisma.bookingAction.findMany.mockImplementation((async ({ where }: { where: { state?: string } }) =>
      where.state === 'EXECUTED'
        ? [
            row({ id: 'x1', field: 'pickup_time', proposedValue: '09:00', state: 'EXECUTED', closedReason: 'AUTO_APPLIED', closedAt: new Date('2026-10-20T01:00:00Z') }),
            row({ id: 'x2', bookingId: '12', state: 'EXECUTED', closedAt: new Date('2026-10-20T01:00:00Z') }),
          ]
        : []) as never)
    mockPrisma.bookingActionEvent.findMany.mockResolvedValue([{ id: 'e1', actionId: 'x1', event: 'EXECUTED', oldValue: '10:30', newValue: '09:00' }] as never)
    const body = await (await GET(req(), ctx)).json()
    expect(body.executed).toEqual([{
      id: 'x1', conversationId: 'c1', field: 'pickup_time', tier: 'AI', newValue: '09:00', oldValue: '10:30',
      closedReason: 'AUTO_APPLIED', closedAt: '2026-10-20T01:00:00.000Z', revertable: true,
    }])
    const q = mockPrisma.bookingAction.findMany.mock.calls.map(([a]) => a?.where).find((w) => w?.state === 'EXECUTED')
    expect(q).toMatchObject({ conversationId: 'c1', state: 'EXECUTED', type: 'CHANGE', closedAt: { gte: expect.any(Date) } })
  })

  it('401 without session', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null)
    expect((await GET(req(), ctx)).status).toBe(401)
  })

  it('404 when conversation missing', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(null)
    expect((await GET(req(), ctx)).status).toBe(404)
  })

  it('GET old value reflects latest bookingData', async () => {
    mockPrisma.bookingAction.findMany.mockResolvedValue([row({})] as never)
    mockPrisma.conversation.findUnique.mockResolvedValue({ bookingData: bookingData('Surabaya Airport') } as never)
    const a = (await (await GET(req(), ctx)).json()).actions[0]
    expect(a.oldValue).toBe('Surabaya Airport')

    mockPrisma.conversation.findUnique.mockResolvedValue({ bookingData: bookingData('Surabaya Train Station') } as never)
    const b = (await (await GET(req(), ctx)).json()).actions[0]
    expect(b.oldValue).toBe('Surabaya Train Station')
  })

  it('returns booking summary, impact for TASK only, history newest 50, scoped to current booking', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({ bookingData: bookingData('X') } as never)
    mockPrisma.bookingAction.findMany.mockResolvedValue([
      row({ id: 'a1' }),
      row({ id: 'a2', type: 'TASK', field: 'total_pax', proposedValue: '4', tier: 'HEAVY' }),
      row({ id: 'a3', bookingId: '12' }),
      row({ id: 'a4', bookingId: null }),
    ] as never)
    mockPrisma.bookingActionEvent.findMany.mockResolvedValue([{ id: 'e1' }] as never)
    const body = await (await GET(req(), ctx)).json()
    expect(body.booking).toEqual({ id: '77', code: 'JVTO-77', start: '2026-11-01', end: '2026-11-02' })
    expect(body.actions.map((x: { id: string }) => x.id)).toEqual(['a1', 'a2', 'a4'])
    expect(body.actions[1].impact.crewClashes).toEqual(['Andi'])
    expect(body.actions[0].impact).toBeUndefined()
    expect(computeImpact).toHaveBeenCalledTimes(1)
    expect(body.history).toEqual([{ id: 'e1', accountName: null }])
    expect(body.writeEnabled).toBe(false) // LEGACY_BASE_URL tidak diset di test
    expect(mockPrisma.bookingActionEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { conversationId: 'c1' }, orderBy: { createdAt: 'desc' }, take: 50 }),
    )
  })

  it('writeEnabled follows writeConfigured (LEGACY_BASE_URL)', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({ bookingData: bookingData('X') } as never)
    mockPrisma.bookingAction.findMany.mockResolvedValue([] as never)
    mockPrisma.bookingActionEvent.findMany.mockResolvedValue([] as never)
    vi.stubEnv('LEGACY_BASE_URL', 'https://legacy.example')
    try {
      expect((await (await GET(req(), ctx)).json()).writeEnabled).toBe(true)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('booking null when conversation has no booking', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({ bookingData: null } as never)
    mockPrisma.bookingAction.findMany.mockResolvedValue([] as never)
    const body = await (await GET(req(), ctx)).json()
    expect(body.booking).toBeNull()
    expect(body.actions).toEqual([])
  })

  it('500 with generic error on failure', async () => {
    mockPrisma.conversation.findUnique.mockRejectedValue(new Error('secret db url'))
    const res = await GET(req(), ctx)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
  })

  it('EXECUTING older than 2 minutes is released back to OPEN (EXECUTE_FAILED by SYSTEM) before listing', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-20T03:00:00Z'), toFake: ['Date'] })
    try {
      mockPrisma.conversation.findUnique.mockResolvedValue({ bookingData: bookingData('X') } as never)
      const stuck = row({ id: 's1', state: 'EXECUTING', field: 'pickup_time', proposedValue: '09:00' })
      mockPrisma.bookingAction.findMany.mockImplementation((async ({ where }: { where: { state: string } }) =>
        where.state === 'EXECUTING' ? [stuck] : [{ ...stuck, state: 'OPEN' }]) as never)
      mockPrisma.bookingAction.updateMany.mockResolvedValue({ count: 1 } as never)
      const body = await (await GET(req(), ctx)).json()

      const cutoff = new Date('2026-10-20T02:58:00Z')
      expect(mockPrisma.bookingAction.findMany.mock.calls[0][0]?.where).toEqual({ conversationId: 'c1', state: 'EXECUTING', claimedAt: { lt: cutoff } })
      expect(mockPrisma.bookingAction.updateMany).toHaveBeenCalledWith({
        where: { id: 's1', state: 'EXECUTING', claimedAt: { lt: cutoff } },
        data: { state: 'OPEN', claimedAt: null, lastError: expect.stringContaining('Eksekusi terputus') },
      })
      expect(mockPrisma.bookingActionEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actionId: 's1', event: 'EXECUTE_FAILED', actor: 'SYSTEM' }),
      })
      expect(body.actions.map((x: { id: string }) => x.id)).toEqual(['s1'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('a fresh EXECUTING claim is not released, and a failing release never breaks the panel', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({ bookingData: bookingData('X') } as never)
    mockPrisma.bookingAction.findMany.mockImplementation((async ({ where }: { where: { state: string } }) =>
      where.state === 'EXECUTING' ? [] : [row({})]) as never)
    expect((await GET(req(), ctx)).status).toBe(200)
    expect(mockPrisma.bookingAction.updateMany).not.toHaveBeenCalled()

    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockPrisma.bookingAction.findMany.mockImplementation((async ({ where }: { where: { state: string } }) => {
      if (where.state === 'EXECUTING') throw new Error('db')
      return [row({})]
    }) as never)
    const res = await GET(req(), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).actions).toHaveLength(1)
  })
})
