import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
})

describe('POST /api/conversations/[id]/toggle-bot', () => {
  it('flips botEnabled from true to false', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({ botEnabled: true } as never)
    mockPrisma.conversation.update.mockResolvedValue({ botEnabled: false } as never)

    const res = await POST(new Request('http://localhost'), { params: Promise.resolve({ id: 'conv_1' }) })

    expect((await res.json()).botEnabled).toBe(false)
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith({ where: { id: 'conv_1' }, data: { botEnabled: false } })
  })

  it('flips botEnabled from false to true', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({ botEnabled: false } as never)
    mockPrisma.conversation.update.mockResolvedValue({ botEnabled: true } as never)

    const res = await POST(new Request('http://localhost'), { params: Promise.resolve({ id: 'conv_1' }) })

    expect((await res.json()).botEnabled).toBe(true)
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith({ where: { id: 'conv_1' }, data: { botEnabled: true } })
  })
})
