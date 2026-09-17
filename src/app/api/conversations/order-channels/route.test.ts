import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
})

describe('GET /api/conversations/order-channels', () => {
  it('returns the distinct order channels actually on file, excluding null', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([
      { orderChannel: 'JVTO' },
      { orderChannel: 'KLOOK' },
    ] as never)

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual(['JVTO', 'KLOOK'])
    expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith({
      where: { orderChannel: { not: null } },
      select: { orderChannel: true },
      distinct: ['orderChannel'],
      orderBy: { orderChannel: 'asc' },
    })
  })

  it('returns an empty list when no conversation has a booking yet', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([] as never)

    const res = await GET()
    const body = await res.json()

    expect(body).toEqual([])
  })
})
