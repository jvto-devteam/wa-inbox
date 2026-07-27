import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { GET } from './route'
import { getCoexistStatus } from '@/lib/coexist/client'

// See src/app/api/conversations/route.test.ts for why the mock must be constructed inline
// inside the factory rather than via an outer `let` variable (vi.mock factories are hoisted
// above `let`/`const` declarations, so closing over a reassigned outer variable throws a TDZ
// error).
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/coexist/client', () => ({ getCoexistStatus: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function daysFromNow(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d
}

beforeEach(() => {
  mockReset(mockPrisma)
  mockPrisma.conversation.count.mockResolvedValue(0)
  mockPrisma.message.count.mockResolvedValue(0)
  mockPrisma.conversation.findMany.mockResolvedValue([])
  mockPrisma.reminder.findMany.mockResolvedValue([])
  mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ accessToken: 'tok' } as never)
  vi.mocked(getCoexistStatus).mockResolvedValue({ connected: true })
})

describe('GET /api/dashboard/summary', () => {
  it('returns zeroed counts and empty lists when there is no activity', async () => {
    const res = await GET()
    const body = await res.json()

    expect(body).toEqual({
      openCount: 0,
      handoffTodayCount: 0,
      officialTokenValid: true,
      unofficialConnected: true,
      needsAttention: [],
      remindersDue: [],
    })
  })

  it('counts open conversations for openCount', async () => {
    mockPrisma.conversation.count.mockResolvedValue(7)

    const body = await (await GET()).json()

    expect(body.openCount).toBe(7)
    expect(mockPrisma.conversation.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'OPEN' }) })
    )
  })

  it('counts only handoff-log BOT messages (content: null) from today for handoffTodayCount, not every bot reply', async () => {
    mockPrisma.message.count.mockResolvedValue(3)

    const body = await (await GET()).json()

    expect(body.handoffTodayCount).toBe(3)
    expect(mockPrisma.message.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sentBy: 'BOT',
          content: null,
          createdAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      })
    )
  })

  it('reports officialTokenValid false when the WaNumber has no access token', async () => {
    mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ accessToken: '' } as never)

    const body = await (await GET()).json()

    expect(body.officialTokenValid).toBe(false)
  })

  it('reports unofficialConnected false when getCoexistStatus reports disconnected', async () => {
    vi.mocked(getCoexistStatus).mockResolvedValue({ connected: false })

    const body = await (await GET()).json()

    expect(body.unofficialConnected).toBe(false)
  })

  it('maps needsAttention conversations that were handed off (botEnabled: false) and are still unassigned', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([
      { id: 'conv_1', contact: { name: 'Bruno' } },
      { id: 'conv_2', contact: { name: null } },
    ] as never)

    const body = await (await GET()).json()

    expect(body.needsAttention).toEqual([
      { id: 'conv_1', contactName: 'Bruno', reason: 'Menunggu agen setelah handoff' },
      { id: 'conv_2', contactName: null, reason: 'Menunggu agen setelah handoff' },
    ])
    expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'OPEN', botEnabled: false, assignedAgentId: null }),
      })
    )
  })

  it('maps remindersDue with note and contact name', async () => {
    mockPrisma.reminder.findMany.mockResolvedValue([
      { id: 'r1', note: 'Follow up soal itinerary', contact: { name: 'Bruno' } },
    ] as never)

    const body = await (await GET()).json()

    expect(body.remindersDue).toEqual([{ id: 'r1', note: 'Follow up soal itinerary', contactName: 'Bruno' }])
  })

  it('includes an overdue reminder (due yesterday) via an end-of-today upper bound, not just exactly-now', async () => {
    mockPrisma.reminder.findMany.mockResolvedValue([])

    await GET()

    const yesterday = daysFromNow(-1)
    const call = mockPrisma.reminder.findMany.mock.calls[0][0] as { where: { dueAt: { lte: Date } } }
    expect(yesterday.getTime()).toBeLessThanOrEqual(call.where.dueAt.lte.getTime())
  })

  it('excludes a reminder due tomorrow via the end-of-today upper bound', async () => {
    mockPrisma.reminder.findMany.mockResolvedValue([])

    await GET()

    const tomorrow = daysFromNow(1)
    const call = mockPrisma.reminder.findMany.mock.calls[0][0] as { where: { dueAt: { lte: Date } } }
    expect(call.where.dueAt.lte.getTime()).toBeLessThan(tomorrow.getTime())
  })
})
