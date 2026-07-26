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

describe('GET /api/bot/decisions', () => {
  it('returns bot-authored messages with their trace, filterable by mode', async () => {
    mockPrisma.message.findMany.mockResolvedValue([
      {
        id: 'm1',
        conversationId: 'conv_1',
        botTrace: { mode: 'handoff', reason: 'x' },
        createdAt: new Date(),
        conversation: { contact: { name: 'Bruno' } },
      },
      {
        id: 'm2',
        conversationId: 'conv_2',
        botTrace: { mode: 'faq', draft: 'y', sourceTopic: 'inclusions' },
        createdAt: new Date(),
        conversation: { contact: { name: 'Siti' } },
      },
    ] as never)

    const res = await GET(new Request('http://localhost/api/bot/decisions?mode=handoff'))
    const body = await res.json()

    expect(body).toHaveLength(1)
    expect(body[0].mode).toBe('handoff')
    expect(body[0].id).toBe('m1')
    expect(mockPrisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sentBy: 'BOT' }),
      })
    )
  })

  it('returns all bot decisions when no mode filter is given', async () => {
    mockPrisma.message.findMany.mockResolvedValue([
      {
        id: 'm1',
        conversationId: 'conv_1',
        botTrace: { mode: 'handoff', reason: 'x' },
        createdAt: new Date(),
        conversation: { contact: { name: 'Bruno' } },
      },
      {
        id: 'm2',
        conversationId: 'conv_2',
        botTrace: { mode: 'faq', draft: 'y', sourceTopic: 'inclusions' },
        createdAt: new Date(),
        conversation: { contact: null },
      },
    ] as never)

    const res = await GET(new Request('http://localhost/api/bot/decisions'))
    const body = await res.json()

    expect(body).toHaveLength(2)
    expect(body[1].contactName).toBeNull()
  })

  it('falls back to mode "unknown" when botTrace is null', async () => {
    mockPrisma.message.findMany.mockResolvedValue([
      {
        id: 'm1',
        conversationId: 'conv_1',
        botTrace: null,
        createdAt: new Date(),
        conversation: { contact: { name: 'Bruno' } },
      },
    ] as never)

    const res = await GET(new Request('http://localhost/api/bot/decisions'))
    const body = await res.json()

    expect(body[0].mode).toBe('unknown')
    expect(body[0].trace).toBeNull()
  })
})
