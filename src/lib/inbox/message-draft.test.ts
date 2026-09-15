/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { decideAndRespond } from '@/lib/bot/orchestrator'
import { recordBotDecisionRun, attachMessageToDecisionRun } from '@/lib/bot-control/decision-recorder'
import { sendMessage } from '@/lib/send'
import { recordUnsourcedReplyGap } from '@/lib/inbox/gap-log'
import { generateDraft, editDraft, sendDraft } from './message-draft'
import type { BotDecision } from '@/lib/bot/types'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/bot/orchestrator', () => ({ decideAndRespond: vi.fn() }))
vi.mock('@/lib/bot-control/decision-recorder', () => ({
  recordBotDecisionRun: vi.fn(),
  attachMessageToDecisionRun: vi.fn(),
}))
vi.mock('@/lib/send', () => ({ sendMessage: vi.fn() }))
vi.mock('@/lib/inbox/gap-log', () => ({ recordUnsourcedReplyGap: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const CONVERSATION_ID = 'conv_1'
const MESSAGE_ID = 'msg_source'
const ACCOUNT_ID = 'acc_1'

const sourceMessage = {
  id: MESSAGE_ID,
  conversationId: CONVERSATION_ID,
  direction: 'INBOUND' as const,
  content: 'Berapa harga paket Ijen 2D1N?',
  createdAt: new Date('2026-09-14T08:00:00.000Z'),
}

const faqDecision: BotDecision = {
  mode: 'faq',
  draft: 'Paket Ijen 2D1N mulai dari Rp1.200.000 per orang.',
  sourceTopic: 'price',
}

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft_1',
    conversationId: CONVERSATION_ID,
    sourceMessageId: MESSAGE_ID,
    generatedText: 'Paket Ijen 2D1N mulai dari Rp1.200.000 per orang.',
    text: 'Paket Ijen 2D1N mulai dari Rp1.200.000 per orang.',
    decision: faqDecision,
    pendingKnowledgeGaps: [],
    decisionRunId: 'run_1',
    generatedById: ACCOUNT_ID,
    generatedAt: new Date('2026-09-14T08:00:05.000Z'),
    editedById: null,
    editedAt: null,
    sentById: null,
    sentAt: null,
    sentMessageId: null,
    createdAt: new Date('2026-09-14T08:00:05.000Z'),
    updatedAt: new Date('2026-09-14T08:00:05.000Z'),
    ...overrides,
  }
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  mockPrisma.message.findUnique.mockResolvedValue(sourceMessage as never)
  mockPrisma.account.findMany.mockResolvedValue([{ id: ACCOUNT_ID, name: 'Agen Satu' }] as never)
  vi.mocked(decideAndRespond).mockResolvedValue(faqDecision)
  vi.mocked(recordBotDecisionRun).mockResolvedValue('run_1')
})

describe('generateDraft', () => {
  it('memanggil decideAndRespond dengan opsi draft yang benar', async () => {
    mockPrisma.messageDraft.findUnique.mockResolvedValue(null)
    mockPrisma.messageDraft.updateMany.mockResolvedValue({ count: 0 } as never)
    mockPrisma.messageDraft.create.mockResolvedValue(draftRow() as never)

    await generateDraft({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: ACCOUNT_ID })

    expect(decideAndRespond).toHaveBeenCalledWith(CONVERSATION_ID, sourceMessage.content, undefined, {
      draft: { historyBefore: sourceMessage.createdAt, knowledgeGaps: [] },
    })
  })

  it('mencatat run dengan simulated: true', async () => {
    mockPrisma.messageDraft.findUnique.mockResolvedValue(null)
    mockPrisma.messageDraft.updateMany.mockResolvedValue({ count: 0 } as never)
    mockPrisma.messageDraft.create.mockResolvedValue(draftRow() as never)

    await generateDraft({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: ACCOUNT_ID })

    expect(recordBotDecisionRun).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONVERSATION_ID,
        inboundText: sourceMessage.content,
        decision: faqDecision,
        simulated: true,
      })
    )
  })

  it('tidak pernah memanggil sendMessage maupun knowledgeGapLog.create', async () => {
    mockPrisma.messageDraft.findUnique.mockResolvedValue(null)
    mockPrisma.messageDraft.updateMany.mockResolvedValue({ count: 0 } as never)
    mockPrisma.messageDraft.create.mockResolvedValue(draftRow() as never)

    await generateDraft({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: ACCOUNT_ID })

    expect(sendMessage).not.toHaveBeenCalled()
    expect(mockPrisma.knowledgeGapLog.create).not.toHaveBeenCalled()
  })

  it('generate ulang pada draft yang sudah terkirim -> 409, engine tidak dipanggil', async () => {
    mockPrisma.messageDraft.findUnique.mockResolvedValue(draftRow({ sentAt: new Date(), sentById: ACCOUNT_ID }) as never)

    await expect(generateDraft({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: ACCOUNT_ID })).rejects.toMatchObject({
      status: 409,
      message: 'Draft sudah terkirim dan terkunci',
    })
    expect(decideAndRespond).not.toHaveBeenCalled()
  })

  it('pesan bukan teks/bukan inbound -> 400', async () => {
    mockPrisma.message.findUnique.mockResolvedValue({ ...sourceMessage, direction: 'OUTBOUND' } as never)

    await expect(generateDraft({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: ACCOUNT_ID })).rejects.toMatchObject({
      status: 400,
      message: 'Draft hanya bisa dibuat untuk pesan teks dari pelanggan',
    })
    expect(decideAndRespond).not.toHaveBeenCalled()
  })

  it('pesan kosong -> 400', async () => {
    mockPrisma.message.findUnique.mockResolvedValue({ ...sourceMessage, content: '   ' } as never)

    await expect(generateDraft({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: ACCOUNT_ID })).rejects.toMatchObject({
      status: 400,
    })
  })

  it('pesan dari percakapan lain -> 404', async () => {
    mockPrisma.message.findUnique.mockResolvedValue({ ...sourceMessage, conversationId: 'conv_lain' } as never)

    await expect(generateDraft({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: ACCOUNT_ID })).rejects.toMatchObject({
      status: 404,
      message: 'Pesan tidak ditemukan di percakapan ini',
    })
  })

  it('pesan tidak ada -> 404', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null)

    await expect(generateDraft({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: ACCOUNT_ID })).rejects.toMatchObject({
      status: 404,
    })
  })

  it('meregenerasi draft yang belum terkirim: mengosongkan editedAt dan menyamakan text dengan generatedText', async () => {
    mockPrisma.messageDraft.findUnique.mockResolvedValue(
      draftRow({ text: 'Teks yang sudah diedit operator', editedAt: new Date(), editedById: ACCOUNT_ID }) as never
    )
    mockPrisma.messageDraft.updateMany.mockResolvedValue({ count: 1 } as never)
    mockPrisma.messageDraft.findUniqueOrThrow.mockResolvedValue(draftRow() as never)

    await generateDraft({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: ACCOUNT_ID })

    expect(mockPrisma.messageDraft.updateMany).toHaveBeenCalledWith({
      where: { sourceMessageId: MESSAGE_ID, sentAt: null },
      data: expect.objectContaining({
        text: faqDecision.mode === 'faq' ? faqDecision.draft : null,
        generatedText: faqDecision.mode === 'faq' ? faqDecision.draft : null,
        editedAt: null,
        editedById: null,
      }),
    })
  })
})

describe('editDraft', () => {
  it('mengisi editedAt/editedById saat text berbeda dari generatedText', async () => {
    mockPrisma.messageDraft.findUnique.mockResolvedValue(draftRow() as never)
    mockPrisma.messageDraft.updateMany.mockResolvedValue({ count: 1 } as never)
    mockPrisma.messageDraft.findUniqueOrThrow.mockResolvedValue(
      draftRow({ text: 'Versi baru dari agen', editedAt: new Date(), editedById: ACCOUNT_ID }) as never
    )

    await editDraft({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: ACCOUNT_ID, text: 'Versi baru dari agen' })

    expect(mockPrisma.messageDraft.updateMany).toHaveBeenCalledWith({
      where: { id: 'draft_1', sentAt: null },
      data: { text: 'Versi baru dari agen', editedAt: expect.any(Date), editedById: ACCOUNT_ID },
    })
  })

  it('mengosongkan editedAt/editedById saat text sama dengan generatedText', async () => {
    const original = draftRow()
    mockPrisma.messageDraft.findUnique.mockResolvedValue(original as never)
    mockPrisma.messageDraft.updateMany.mockResolvedValue({ count: 1 } as never)
    mockPrisma.messageDraft.findUniqueOrThrow.mockResolvedValue(original as never)

    await editDraft({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: ACCOUNT_ID, text: original.generatedText! })

    expect(mockPrisma.messageDraft.updateMany).toHaveBeenCalledWith({
      where: { id: 'draft_1', sentAt: null },
      data: { text: original.generatedText, editedAt: null, editedById: null },
    })
  })

  it('belum ada draft -> 404', async () => {
    mockPrisma.messageDraft.findUnique.mockResolvedValue(null)

    await expect(
      editDraft({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: ACCOUNT_ID, text: 'apa saja' })
    ).rejects.toMatchObject({ status: 404, message: 'Draft belum dibuat' })
  })

  it('draft sudah terkirim -> 409', async () => {
    mockPrisma.messageDraft.findUnique.mockResolvedValue(draftRow({ sentAt: new Date() }) as never)

    await expect(
      editDraft({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: ACCOUNT_ID, text: 'apa saja' })
    ).rejects.toMatchObject({ status: 409, message: 'Draft sudah terkirim dan terkunci' })
    expect(mockPrisma.messageDraft.updateMany).not.toHaveBeenCalled()
  })
})

describe('sendDraft', () => {
  const sentMessageRow = {
    id: 'msg_sent',
    conversationId: CONVERSATION_ID,
    direction: 'OUTBOUND',
    type: 'text',
    content: 'Paket Ijen 2D1N mulai dari Rp1.200.000 per orang.',
    mediaUrl: null,
    mimeType: null,
    fileName: null,
    channel: 'UNOFFICIAL',
    sentBy: 'AGENT',
    deliveryStatus: 'SENT',
    createdAt: new Date('2026-09-14T08:05:00.000Z'),
    botTrace: faqDecision,
    topicLabels: null,
    templatePayload: null,
    replyTo: null,
  }

  beforeEach(() => {
    mockPrisma.messageDraft.findUnique.mockResolvedValue(draftRow() as never)
    mockPrisma.messageDraft.updateMany.mockResolvedValue({ count: 1 } as never)
    vi.mocked(sendMessage).mockResolvedValue({ id: 'msg_sent' } as never)
    mockPrisma.message.findUniqueOrThrow.mockResolvedValue(sentMessageRow as never)
    mockPrisma.messageDraft.findUniqueOrThrow.mockResolvedValue(draftRow({ sentAt: new Date(), sentById: ACCOUNT_ID, sentMessageId: 'msg_sent' }) as never)
  })

  it('memanggil sendMessage dengan sentBy AGENT, replyToId pesan sumber, dan botTrace = decision', async () => {
    await sendDraft({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: ACCOUNT_ID })

    expect(sendMessage).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      text: draftRow().text,
      sentBy: 'AGENT',
      agentId: ACCOUNT_ID,
      replyToId: MESSAGE_ID,
      botTrace: faqDecision,
    })
  })

  it('menautkan run keputusan ke pesan yang baru terkirim', async () => {
    await sendDraft({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: ACCOUNT_ID })

    expect(attachMessageToDecisionRun).toHaveBeenCalledWith('run_1', 'msg_sent')
  })

  it('mengklaim draft sebelum mengirim (sentAt/sentById) lewat updateMany dengan penjaga sentAt: null', async () => {
    await sendDraft({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: ACCOUNT_ID })

    expect(mockPrisma.messageDraft.updateMany).toHaveBeenCalledWith({
      where: { id: 'draft_1', sentAt: null },
      data: { sentAt: expect.any(Date), sentById: ACCOUNT_ID },
    })
  })

  it('menulis setiap pendingKnowledgeGaps ke knowledgeGapLog dan memanggil recordUnsourcedReplyGap dengan id pesan terkirim', async () => {
    mockPrisma.messageDraft.findUnique.mockResolvedValue(
      draftRow({
        pendingKnowledgeGaps: [{ topic: 'vehicle', reason: 'no_facts_resolved', messageText: 'Berapa harga paket Ijen 2D1N?' }],
      }) as never
    )
    mockPrisma.knowledgeGapLog.create.mockResolvedValue({ id: 'gap_1' } as never)

    await sendDraft({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: ACCOUNT_ID })

    expect(mockPrisma.knowledgeGapLog.create).toHaveBeenCalledWith({
      data: {
        conversationId: CONVERSATION_ID,
        topic: 'vehicle',
        reason: 'no_facts_resolved',
        messageText: 'Berapa harga paket Ijen 2D1N?',
      },
    })
    expect(recordUnsourcedReplyGap).toHaveBeenCalledWith({
      decision: faqDecision,
      conversationId: CONVERSATION_ID,
      messageId: 'msg_sent',
      runId: 'run_1',
      inboundText: sourceMessage.content,
    })
  })

  it('satu baris pendingKnowledgeGaps yang gagal ditulis tidak menggagalkan pengiriman', async () => {
    mockPrisma.messageDraft.findUnique.mockResolvedValue(
      draftRow({
        pendingKnowledgeGaps: [{ topic: 'vehicle', reason: 'no_facts_resolved', messageText: 'x' }],
      }) as never
    )
    mockPrisma.knowledgeGapLog.create.mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(sendDraft({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: ACCOUNT_ID })).resolves.toBeDefined()
  })

  it('draft belum ada -> 404', async () => {
    mockPrisma.messageDraft.findUnique.mockResolvedValue(null)

    await expect(sendDraft({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: ACCOUNT_ID })).rejects.toMatchObject({
      status: 404,
      message: 'Draft belum dibuat',
    })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('draft kosong setelah trim -> 400', async () => {
    mockPrisma.messageDraft.findUnique.mockResolvedValue(draftRow({ text: '   ' }) as never)

    await expect(sendDraft({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: ACCOUNT_ID })).rejects.toMatchObject({
      status: 400,
      message: 'Draft kosong, tulis jawabannya dulu',
    })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('kirim kedua kali -> 409 (klaim balapan gagal)', async () => {
    mockPrisma.messageDraft.updateMany.mockResolvedValue({ count: 0 } as never)

    await expect(sendDraft({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: ACCOUNT_ID })).rejects.toMatchObject({
      status: 409,
      message: 'Draft sudah terkirim dan terkunci',
    })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('draft yang sudah sentAt (dibaca ulang) -> 409 tanpa mengklaim', async () => {
    mockPrisma.messageDraft.findUnique.mockResolvedValue(draftRow({ sentAt: new Date(), sentById: ACCOUNT_ID }) as never)

    await expect(sendDraft({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: ACCOUNT_ID })).rejects.toMatchObject({
      status: 409,
    })
    expect(mockPrisma.messageDraft.updateMany).not.toHaveBeenCalled()
  })

  it('sendMessage melempar -> klaim dikembalikan (sentAt/sentById null) dan error dilempar ulang', async () => {
    vi.mocked(sendMessage).mockRejectedValue(new Error('provider down'))

    await expect(sendDraft({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: ACCOUNT_ID })).rejects.toThrow('provider down')

    expect(mockPrisma.messageDraft.update).toHaveBeenCalledWith({
      where: { id: 'draft_1' },
      data: { sentAt: null, sentById: null },
    })
    expect(recordUnsourcedReplyGap).not.toHaveBeenCalled()
  })
})
