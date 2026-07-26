import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { GET } from './route'

// See src/app/api/contacts/[id]/reminders/route.test.ts for why the mock
// must be constructed inline inside the factory rather than via an outer
// `let` variable (vi.mock factories are hoisted above `let` declarations).
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
})

function daysFromNow(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d
}

describe('GET /api/reminders/due', () => {
  it('returns undone reminders due today or earlier, with contact name', async () => {
    mockPrisma.reminder.findMany.mockResolvedValue([
      { id: 'r1', note: 'Follow up', dueAt: new Date(), contact: { id: 'contact_1', name: 'Bruno' } },
    ] as never)

    const res = await GET()
    const body = await res.json()

    expect(body[0].contactName).toBe('Bruno')
    expect(body[0].contactId).toBe('contact_1')
    expect(mockPrisma.reminder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ done: false }) })
    )
  })

  it('includes a reminder due yesterday (overdue, not just due exactly today)', async () => {
    const yesterday = daysFromNow(-1)
    mockPrisma.reminder.findMany.mockResolvedValue([
      { id: 'r1', note: 'Overdue', dueAt: yesterday, contact: { id: 'contact_1', name: 'Bruno' } },
    ] as never)

    const res = await GET()
    const body = await res.json()

    expect(body).toHaveLength(1)
    const call = mockPrisma.reminder.findMany.mock.calls[0][0] as { where: { dueAt: { lte: Date } } }
    // The reminder due yesterday must fall within the query's upper bound.
    expect(yesterday.getTime()).toBeLessThanOrEqual(call.where.dueAt.lte.getTime())
  })

  it('excludes a reminder due tomorrow via the lte upper bound', async () => {
    mockPrisma.reminder.findMany.mockResolvedValue([])

    await GET()

    const tomorrow = daysFromNow(1)
    const call = mockPrisma.reminder.findMany.mock.calls[0][0] as { where: { dueAt: { lte: Date } } }
    // The query's upper bound (end of today) must be before a reminder due tomorrow.
    expect(call.where.dueAt.lte.getTime()).toBeLessThan(tomorrow.getTime())
  })
})
