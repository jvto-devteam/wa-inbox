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
  // `draftsForConversation` bails out before touching anything else when there are no
  // drafts, so this default keeps the two existing tests below untouched by Task 4.
  mockPrisma.messageDraft.findMany.mockResolvedValue([] as never)
})

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft_1',
    conversationId: 'conv_1',
    sourceMessageId: 'm1',
    generatedText: 'Tentu, ada beberapa pilihan paket Ijen.',
    text: 'Tentu, ada beberapa pilihan paket Ijen.',
    decision: { mode: 'faq', draft: 'Tentu, ada beberapa pilihan paket Ijen.', sourceTopic: 'price' },
    pendingKnowledgeGaps: [],
    decisionRunId: 'run_1',
    generatedById: null,
    generatedAt: new Date('2026-09-15T08:00:05.000Z'),
    editedById: null,
    editedAt: null,
    sentById: null,
    sentAt: null,
    sentMessageId: null,
    createdAt: new Date('2026-09-15T08:00:05.000Z'),
    updatedAt: new Date('2026-09-15T08:00:05.000Z'),
    ...overrides,
  }
}

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

  it('melampirkan draft ke pesan sumbernya dan fromDraft ke pesan yang terkirim dari draft', async () => {
    const mainMessages = [
      { id: 'm1', direction: 'INBOUND', content: 'Ada paket ijen?', channel: 'OFFICIAL', sentBy: 'CUSTOMER', deliveryStatus: 'DELIVERED', createdAt: new Date('2026-09-15T08:00:00.000Z'), botTrace: null },
      { id: 'm_sent', direction: 'OUTBOUND', content: 'Tentu, ada beberapa pilihan paket Ijen.', channel: 'OFFICIAL', sentBy: 'AGENT', deliveryStatus: 'SENT', createdAt: new Date('2026-09-15T08:00:06.000Z'), botTrace: null },
      { id: 'm_other', direction: 'OUTBOUND', content: 'Pesan lain yang tidak berhubungan.', channel: 'OFFICIAL', sentBy: 'AGENT', deliveryStatus: 'SENT', createdAt: new Date('2026-09-15T08:01:00.000Z'), botTrace: null },
    ]

    // `message.findMany` mocks two different call sites within the same request: the route's
    // own message list (by `conversationId`) and `draftsForConversation`'s lookup of source
    // message content (by `id: { in: [...] }`) -- distinguish them by shape, not call order.
    mockPrisma.message.findMany.mockImplementation(((args: { where?: { conversationId?: string } }) =>
      args?.where?.conversationId
        ? Promise.resolve(mainMessages as never)
        : Promise.resolve([{ id: 'm1', content: 'Ada paket ijen?' }] as never)) as never)
    mockPrisma.knowledgeGapLog.findMany.mockResolvedValue([] as never)
    mockPrisma.messageDraft.findMany.mockResolvedValue([draftRow({ sentMessageId: 'm_sent' })] as never)

    const res = await GET(new Request('http://localhost/api/conversations/conv_1/messages'), { params: Promise.resolve({ id: 'conv_1' }) })
    const body = await res.json()

    type BodyMessage = { id: string; draft: unknown; fromDraft: boolean }
    const byId = new Map<string, BodyMessage>((body as BodyMessage[]).map((m) => [m.id, m]))

    expect(byId.get('m1')?.draft).toMatchObject({ id: 'draft_1', sourceMessageId: 'm1' })
    expect(byId.get('m1')?.fromDraft).toBe(false)

    expect(byId.get('m_sent')?.draft).toBeNull()
    expect(byId.get('m_sent')?.fromDraft).toBe(true)

    expect(byId.get('m_other')?.draft).toBeNull()
    expect(byId.get('m_other')?.fromDraft).toBe(false)

    expect(mockPrisma.messageDraft.findMany).toHaveBeenCalledTimes(1)
  })

  it('draftsForConversation gagal -> tetap 200 dengan pesan, draft null dan fromDraft false', async () => {
    mockPrisma.message.findMany.mockResolvedValue([
      { id: 'm1', direction: 'INBOUND', content: 'Halo', channel: 'OFFICIAL', sentBy: 'CUSTOMER', deliveryStatus: 'DELIVERED', createdAt: new Date(), botTrace: null },
    ] as never)
    mockPrisma.knowledgeGapLog.findMany.mockResolvedValue([] as never)
    mockPrisma.messageDraft.findMany.mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await GET(new Request('http://localhost/api/conversations/conv_1/messages'), { params: Promise.resolve({ id: 'conv_1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body[0].content).toBe('Halo')
    expect(body[0].draft).toBeNull()
    expect(body[0].fromDraft).toBe(false)
  })
})
