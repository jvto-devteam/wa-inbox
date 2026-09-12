/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { recordUnsourcedReplyGap, UNSOURCED_REPLY_REASON } from './gap-log'
import type { BotDecision, DecisionKnowledge } from '@/lib/bot/types'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function knowledge(overrides: Partial<DecisionKnowledge> = {}): DecisionKnowledge {
  return {
    catalogLines: [],
    managedLines: [{ line: 'ATV 1 jam: IDR 350000', source: 'FAQ Harga ATV (v2)', sourceId: 'ks_1', sourceKey: 'managed/atv', version: 2 }],
    rejected: [],
    gateBypassed: false,
    attributions: [],
    ...overrides,
  }
}

const unsourced: BotDecision = { mode: 'faq', draft: 'Halo kak!', sourceTopic: 'price', topic: 'price', knowledge: knowledge() }

function params(overrides: Record<string, unknown> = {}) {
  return {
    decision: unsourced,
    conversationId: 'conv_1',
    messageId: 'msg_bot',
    runId: 'run_1',
    inboundText: 'berapa harga ATV sekarang?',
    ...overrides,
  } as Parameters<typeof recordUnsourcedReplyGap>[0]
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  mockPrisma.knowledgeGapLog.create.mockResolvedValue({ id: 'gap_1' } as never)
})

describe('recordUnsourcedReplyGap', () => {
  it('menulis satu baris gap dengan ketiga id dan alasan reply_unsourced', async () => {
    await recordUnsourcedReplyGap(params())

    expect(mockPrisma.knowledgeGapLog.create).toHaveBeenCalledWith({
      data: {
        conversationId: 'conv_1',
        topic: 'price',
        reason: UNSOURCED_REPLY_REASON,
        messageText: 'berapa harga ATV sekarang?',
        messageId: 'msg_bot',
        runId: 'run_1',
      },
    })
  })

  it('memancarkan knowledge.gap setelah barisnya tersimpan', async () => {
    await recordUnsourcedReplyGap(params())
    expect(broadcast).toHaveBeenCalledWith({ type: 'knowledge.gap', conversationId: 'conv_1' })
  })

  it('memakai sourceTopic bila keputusan tidak membawa topic', async () => {
    await recordUnsourcedReplyGap(params({ decision: { mode: 'faq', draft: 'x', sourceTopic: 'payment', knowledge: knowledge() } }))
    expect(mockPrisma.knowledgeGapLog.create.mock.calls[0][0].data).toMatchObject({ topic: 'payment' })
  })

  it('menyimpan messageId null saat pengiriman tidak mengembalikan pesan', async () => {
    await recordUnsourcedReplyGap(params({ messageId: undefined }))
    expect(mockPrisma.knowledgeGapLog.create.mock.calls[0][0].data).toMatchObject({ messageId: null })
  })

  it('tidak menulis apa pun untuk balasan yang paragrafnya bersumber', async () => {
    const attributions = [{ paragraph: 0, lines: [{ kind: 'managed' as const, line: 'ATV 1 jam: IDR 350000', sourceId: 'ks_1', title: 'FAQ Harga ATV', version: 2 }] }]
    await recordUnsourcedReplyGap(params({ decision: { ...unsourced, knowledge: knowledge({ attributions }) } }))

    expect(mockPrisma.knowledgeGapLog.create).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('tidak menulis apa pun untuk clarify, handoff, atau booking_context', async () => {
    await recordUnsourcedReplyGap(params({ decision: { mode: 'clarify', reply: 'Ke mana?', knowledge: knowledge() } }))
    await recordUnsourcedReplyGap(params({ decision: { mode: 'handoff', reason: 'eskalasi', knowledge: knowledge() } }))
    await recordUnsourcedReplyGap(params({ decision: { mode: 'booking_context', reply: 'Berangkat 5 Agustus.', knowledge: knowledge() } }))

    expect(mockPrisma.knowledgeGapLog.create).not.toHaveBeenCalled()
  })

  it('menelan galat basis data, mencatatnya, dan tidak memancarkan apa pun', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.knowledgeGapLog.create.mockRejectedValue(new Error('db down'))

    await expect(recordUnsourcedReplyGap(params())).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledWith('recordUnsourcedReplyGap gagal', expect.objectContaining({ conversationId: 'conv_1' }))
    expect(broadcast).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
