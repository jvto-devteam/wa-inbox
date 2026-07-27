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
  it('returns bot-authored messages with their trace', async () => {
    mockPrisma.message.findMany.mockResolvedValue([
      {
        id: 'm1',
        conversationId: 'conv_1',
        botTrace: { mode: 'handoff', reason: 'x' },
        createdAt: new Date(),
        conversation: { contact: { name: 'Bruno' } },
      },
    ] as never)

    const res = await GET(new Request('http://localhost/api/bot/decisions?mode=handoff'))
    const body = await res.json()

    expect(body).toHaveLength(1)
    expect(body[0].mode).toBe('handoff')
    expect(body[0].id).toBe('m1')
  })

  // Regression: the mode filter used to be a post-query `.filter()` applied AFTER
  // `take: 200`, so `?mode=handoff` on a day dominated by faq/funnel replies could
  // return zero rows even with real handoffs in history. It must be part of the
  // `where` clause so the database applies it before the row limit.
  it('pushes the mode filter into the Prisma where clause so the 200-row limit applies to the filtered set', async () => {
    mockPrisma.message.findMany.mockResolvedValue([] as never)

    await GET(new Request('http://localhost/api/bot/decisions?mode=handoff'))

    expect(mockPrisma.message.findMany).toHaveBeenCalledWith({
      // Postgres JSON-path filtering: `path` is an array of key segments.
      where: { sentBy: 'BOT', botTrace: { path: ['mode'], equals: 'handoff' } },
      include: { conversation: { include: { contact: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
  })

  it('does not constrain botTrace at all when no mode filter is given', async () => {
    mockPrisma.message.findMany.mockResolvedValue([] as never)

    await GET(new Request('http://localhost/api/bot/decisions'))

    expect(mockPrisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sentBy: 'BOT' } })
    )
  })

  // With the filter in the query, the route returns whatever the database gives back
  // verbatim — it must NOT re-filter in JS, or a 200-row page of genuine handoffs
  // would be silently trimmed a second time.
  it('returns every row the filtered query returned, without re-filtering in JS', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({
      id: `m${i}`,
      conversationId: `conv_${i}`,
      botTrace: { mode: 'handoff', reason: 'x' },
      createdAt: new Date(),
      conversation: { contact: { name: 'Bruno' } },
    }))
    mockPrisma.message.findMany.mockResolvedValue(rows as never)

    const res = await GET(new Request('http://localhost/api/bot/decisions?mode=handoff'))
    const body = await res.json()

    expect(body).toHaveLength(200)
    expect(body.every((d: { mode: string }) => d.mode === 'handoff')).toBe(true)
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
