/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gap_1',
    conversationId: 'conv_1',
    topic: 'price',
    reason: 'reply_unsourced',
    messageText: 'berapa harga ATV sekarang?',
    createdAt: new Date('2026-09-12T02:00:00.000Z'),
    resolvedAt: null,
    conversation: { contact: { name: 'Bruno' } },
    ...overrides,
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  mockPrisma.knowledgeGapLog.findMany.mockResolvedValue([row()] as never)
})

describe('GET /api/bot/knowledge-gaps', () => {
  it('membawa resolvedAt supaya halaman bisa membedakan yang sudah ditangani', async () => {
    const body = (await (await GET(new Request('http://localhost/api/bot/knowledge-gaps'))).json()) as Array<Record<string, unknown>>

    expect(body[0]).toMatchObject({ id: 'gap_1', reason: 'reply_unsourced', resolvedAt: null })
  })

  it('meneruskan stempel selesai apa adanya', async () => {
    mockPrisma.knowledgeGapLog.findMany.mockResolvedValue([row({ resolvedAt: new Date('2026-09-12T03:00:00.000Z') })] as never)

    const body = (await (await GET(new Request('http://localhost/api/bot/knowledge-gaps'))).json()) as Array<{ resolvedAt: string | null }>

    expect(body[0].resolvedAt).toBe('2026-09-12T03:00:00.000Z')
  })

  it('saringan alasan yang sudah ada tidak berubah', async () => {
    await GET(new Request('http://localhost/api/bot/knowledge-gaps?reason=reply_unsourced'))

    expect(mockPrisma.knowledgeGapLog.findMany.mock.calls[0][0]).toMatchObject({ where: { reason: 'reply_unsourced' }, take: 200 })
  })
})
