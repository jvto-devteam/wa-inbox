/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { GET } from './route'

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const req = (qs = '?state=OPEN') => new Request(`http://localhost/api/booking-actions${qs}`, { headers: { cookie: 'wa_inbox_session=tok' } })

const row = (id: string, bookingId: string | null, currentBooking: number) => ({
  id, conversationId: `c${id}`, bookingId, type: 'CHANGE', field: 'pickup_point', proposedValue: 'X',
  createdAt: new Date('2026-10-20T00:00:00Z'),
  conversation: { bookingData: { booking_id: currentBooking }, contact: { name: `N${id}` } },
})

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc', role: 'AGENT', tokenVersion: 0 })
})

describe('GET /api/booking-actions', () => {
  it('401 without session', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null)
    expect((await GET(req())).status).toBe(401)
  })

  it('400 for unsupported state', async () => {
    expect((await GET(req('?state=DONE'))).status).toBe(400)
  })

  it('lists OPEN actions (max 100, newest first), dropping those of an older booking', async () => {
    mockPrisma.bookingAction.findMany.mockResolvedValue([row('1', '77', 77), row('2', '55', 77), row('3', null, 77)] as never)
    const res = await GET(req())
    const body = await res.json()
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(['1', '3'])
    expect(body.items[0]).toMatchObject({ contactName: 'N1', conversationId: 'c1', type: 'CHANGE' })
    expect(mockPrisma.bookingAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100, orderBy: { createdAt: 'desc' }, where: expect.objectContaining({ state: 'OPEN' }) })
    )
  })
})
