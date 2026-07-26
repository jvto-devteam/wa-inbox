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

describe('GET /api/conversations', () => {
  it('returns conversations ordered by lastMessageAt desc, with contact + last message + labels', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([{
      id: 'conv_1',
      botEnabled: true,
      status: 'OPEN',
      lastMessageAt: new Date('2026-07-25T10:00:00Z'),
      contact: { name: 'Bruno Figarola', phone: '6281234567890' },
      messages: [{ content: 'Halo!', createdAt: new Date() }],
      labels: [{ label: { id: 'lbl_1', name: 'Confirmed Booking', color: '#3C6B42' } }],
    }] as never)

    const res = await GET(new Request('http://localhost/api/conversations'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body[0]).toEqual(expect.objectContaining({
      id: 'conv_1',
      contactName: 'Bruno Figarola',
      contactPhone: '6281234567890',
      lastMessage: 'Halo!',
      botEnabled: true,
      labels: [{ id: 'lbl_1', name: 'Confirmed Booking', color: '#3C6B42' }],
    }))
  })
})
