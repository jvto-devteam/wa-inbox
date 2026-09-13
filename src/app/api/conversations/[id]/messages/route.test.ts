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

describe('GET /api/conversations/[id]/messages', () => {
  it('returns messages for the conversation ordered oldest first', async () => {
    mockPrisma.message.findMany.mockResolvedValue([
      { id: 'm1', direction: 'INBOUND', content: 'Halo', channel: 'OFFICIAL', sentBy: 'CUSTOMER', deliveryStatus: 'DELIVERED', createdAt: new Date(), botTrace: null },
    ] as never)
    mockPrisma.knowledgeGapLog.findMany.mockResolvedValue([] as never)

    const res = await GET(new Request('http://localhost/api/conversations/conv_1/messages'), { params: Promise.resolve({ id: 'conv_1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body[0].content).toBe('Halo')
    expect(mockPrisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId: 'conv_1' },
      orderBy: { createdAt: 'asc' },
    }))
  })

  it('attaches the newest unresolved knowledge gap to its bot reply message', async () => {
    mockPrisma.message.findMany.mockResolvedValue([
      { id: 'm_bot', direction: 'OUTBOUND', content: 'Let me check with our team.', channel: 'OFFICIAL', sentBy: 'BOT', deliveryStatus: 'SENT', createdAt: new Date('2026-09-13T02:00:00.000Z'), botTrace: null },
    ] as never)
    mockPrisma.knowledgeGapLog.findMany.mockResolvedValue([
      {
        id: 'gap_1',
        messageId: 'm_bot',
        topic: 'vehicle',
        reason: 'reply_deferred_knowledge',
        messageText: 'Can we bring ten suitcases?',
        missingQuestion: 'Can we bring ten suitcases?',
        answerSnippet: 'Let me check with our team.',
        answerParagraph: 0,
        createdAt: new Date('2026-09-13T02:01:00.000Z'),
      },
    ] as never)

    const res = await GET(new Request('http://localhost/api/conversations/conv_1/messages'), { params: Promise.resolve({ id: 'conv_1' }) })
    const body = await res.json()

    expect(body[0].knowledgeGap).toEqual({
      id: 'gap_1',
      topic: 'vehicle',
      reason: 'reply_deferred_knowledge',
      messageText: 'Can we bring ten suitcases?',
      missingQuestion: 'Can we bring ten suitcases?',
      answerSnippet: 'Let me check with our team.',
      answerParagraph: 0,
      createdAt: '2026-09-13T02:01:00.000Z',
    })
    expect(mockPrisma.knowledgeGapLog.findMany).toHaveBeenCalledWith({
      where: { resolvedAt: null, messageId: { in: ['m_bot'] } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        messageId: true,
        topic: true,
        reason: true,
        messageText: true,
        missingQuestion: true,
        answerSnippet: true,
        answerParagraph: true,
        createdAt: true,
      },
    })
  })
})
