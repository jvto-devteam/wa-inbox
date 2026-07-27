import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { PATCH } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
})

describe('PATCH /api/conversations/[id]/read', () => {
  it('sets lastReadAt to now and returns it', async () => {
    const now = new Date('2026-07-27T08:00:00.000Z')
    mockPrisma.conversation.update.mockResolvedValue({ id: 'conv_1', lastReadAt: now } as never)

    const res = await PATCH(new Request('http://localhost', { method: 'PATCH' }), {
      params: Promise.resolve({ id: 'conv_1' }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ lastReadAt: now.toISOString() })
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv_1' },
      data: { lastReadAt: expect.any(Date) },
    })
  })
})
