/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { DEFERRED_KNOWLEDGE_REPLY_REASON, recordUnsourcedReplyGap, UNSOURCED_REPLY_REASON } from './gap-log'
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
        missingQuestion: 'berapa harga ATV sekarang?',
        answerSnippet: 'Halo kak!',
        answerParagraph: 0,
        messageId: 'msg_bot',
        runId: 'run_1',
      },
    })
  })

  it('memancarkan knowledge.gap setelah barisnya tersimpan', async () => {
    await recordUnsourcedReplyGap(params())
    expect(broadcast).toHaveBeenCalledWith({ type: 'knowledge.gap', conversationId: 'conv_1' })
  })

  it('menulis reason reply_deferred_knowledge untuk balasan yang menunda sub-pertanyaan', async () => {
    await recordUnsourcedReplyGap(
      params({
        decision: {
          mode: 'faq',
          draft: 'Harga totalnya Rp9.100.000. Let me check with our team about your luggage and get back to you shortly.',
          sourceTopic: 'vehicle',
          topic: 'vehicle',
          knowledge: knowledge({
            catalogLines: ['We use an AC MPV for 1-3 guests.'],
            managedLines: [],
            attributions: [{ paragraph: 0, lines: [{ kind: 'catalog' as const, line: 'We use an AC MPV for 1-3 guests.' }] }],
          }),
        },
      }),
    )

    expect(mockPrisma.knowledgeGapLog.create.mock.calls[0][0].data).toMatchObject({
      reason: DEFERRED_KNOWLEDGE_REPLY_REASON,
      topic: 'vehicle',
      missingQuestion: 'berapa harga ATV sekarang?',
      answerSnippet: 'Harga totalnya Rp9.100.000. Let me check with our team about your luggage and get back to you shortly.',
      answerParagraph: 0,
    })
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


// Dilaporkan 14 September 2026: balasan yang menunda DUA pertanyaan hanya menghasilkan satu
// baris gap, jadi pertanyaan kedua tidak pernah muncul di daftar perbaikan. Satu paragraf yang
// ditunda = satu pekerjaan operator, jadi satu baris masing-masing -- dengan runId dan
// messageId yang sama, karena keduanya memang berasal dari satu giliran bot.
describe('recordUnsourcedReplyGap -- balasan dengan lebih dari satu penundaan', () => {
  const duaTunda: BotDecision = {
    mode: 'faq',
    draft: [
      'Hi!',
      '* Yes, the tour is available; the price for 4 people is Rp3.050.000 per person.',
      '* Let me check with our team regarding the flexibility of the pickup time and I will get back to you shortly!',
      '* Let me check with our team if leaving at 16:00-17:00 is possible without affecting the itinerary and I will follow up shortly!',
    ].join('\n\n'),
    sourceTopic: 'booking',
    topic: 'booking',
    knowledge: knowledge(),
  }

  it('menulis satu baris untuk setiap paragraf yang ditunda', async () => {
    await recordUnsourcedReplyGap(params({ decision: duaTunda, inboundText: 'How flexible is the pickup time? Could we leave at 16:00-17:00 instead?' }))

    expect(mockPrisma.knowledgeGapLog.create).toHaveBeenCalledTimes(2)
    const snippets = mockPrisma.knowledgeGapLog.create.mock.calls.map(([arg]) => arg.data.answerSnippet)
    expect(snippets[0]).toContain('flexibility of the pickup time')
    expect(snippets[1]).toContain('16:00-17:00')
  })

  it('menomori paragraf tiap baris sesuai posisinya di balasan', async () => {
    await recordUnsourcedReplyGap(params({ decision: duaTunda, inboundText: 'How flexible is the pickup time? Could we leave at 16:00-17:00 instead?' }))

    const paragraphs = mockPrisma.knowledgeGapLog.create.mock.calls.map(([arg]) => arg.data.answerParagraph)
    expect(paragraphs).toEqual([2, 3])
  })

  it('membunyikan lonceng sekali saja, bukan sekali per baris', async () => {
    await recordUnsourcedReplyGap(params({ decision: duaTunda, inboundText: 'How flexible is the pickup time?' }))

    expect(broadcast).toHaveBeenCalledTimes(1)
  })

  // Satu baris gagal ditulis tidak boleh menelan baris lainnya, dan tidak boleh menggagalkan
  // giliran bot yang sudah berhasil terkirim.
  it('tetap menulis baris kedua saat baris pertama gagal', async () => {
    mockPrisma.knowledgeGapLog.create
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ id: 'gap_2' } as never)

    await recordUnsourcedReplyGap(params({ decision: duaTunda, inboundText: 'How flexible is the pickup time?' }))

    expect(mockPrisma.knowledgeGapLog.create).toHaveBeenCalledTimes(2)
  })
})
