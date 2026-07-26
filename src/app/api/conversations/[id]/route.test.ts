import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { GET } from './route'

// `vi.mock` factories are hoisted above regular imports and `let`/`const`
// declarations, so the mock instance must be constructed inline inside the
// factory (referencing only the already-imported `mockDeep` and the erased
// `PrismaClient` type) rather than via an outer variable — otherwise the
// factory throws "Cannot access ... before initialization".
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
})

describe('GET /api/conversations/[id]', () => {
  it('returns the conversation botEnabled flag', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({ botEnabled: true } as never)

    const res = await GET(new Request('http://localhost/api/conversations/conv_1'), { params: Promise.resolve({ id: 'conv_1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ botEnabled: true })
    expect(mockPrisma.conversation.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 'conv_1' } })
  })

  it('reflects botEnabled false when the bot has been taken over', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({ botEnabled: false } as never)

    const res = await GET(new Request('http://localhost/api/conversations/conv_1'), { params: Promise.resolve({ id: 'conv_1' }) })

    expect((await res.json()).botEnabled).toBe(false)
  })
})
