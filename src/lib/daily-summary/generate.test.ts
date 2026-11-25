/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { Prisma, type PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('./collect', async (importOriginal) => ({ ...(await importOriginal<typeof import('./collect')>()), collectDay: vi.fn() }))
vi.mock('./review', async (importOriginal) => ({ ...(await importOriginal<typeof import('./review')>()), reviewConversation: vi.fn() }))
vi.mock('@/lib/chat-review/store', () => ({
  saveChatReview: vi.fn().mockResolvedValue(true),
  pruneChatReviews: vi.fn().mockResolvedValue({ cleared: 0 }),
}))
vi.mock('@/lib/summary-items/sync', () => ({
  syncSummaryItems: vi.fn().mockResolvedValue({ created: 0, updated: 0, reopened: 0 }),
  reconcileSummaryItems: vi.fn().mockResolvedValue({ closed: 0, converted: 0, reopened: 0 }),
  pruneSummaryItems: vi.fn().mockResolvedValue({ deleted: 0 }),
}))

import { prisma } from '@/lib/db'
import { collectDay, type CollectedDay, type ConversationFacts, type TranscriptMessage } from './collect'
import { reviewConversation } from './review'
import { pruneChatReviews, saveChatReview } from '@/lib/chat-review/store'
import { buildPayload, generateDailySummary, pruneDailySummaries, reusableReview } from './generate'
import type { ConversationReview } from './payload-schema'
import { jakartaDayRange } from './time'

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const DATE = '2026-09-21'
const { start, end } = jakartaDayRange(DATE)
const HOUR = 60 * 60 * 1000

function msg(direction: 'INBOUND' | 'OUTBOUND', at: Date, content = 'halo'): TranscriptMessage {
  return { id: `m-${direction}-${at.getTime()}`, direction, sentBy: direction === 'INBOUND' ? 'CUSTOMER' : 'AGENT', type: 'text', content, createdAt: at }
}

function conv(id: string, messages: TranscriptMessage[], extra: Partial<ConversationFacts> = {}): ConversationFacts {
  return {
    conversationId: id,
    contactName: `Kontak ${id}`,
    pipelineStage: 'new',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    tripBrief: null,
    messages,
    inboundToday: 0,
    outboundToday: 0,
    ...extra,
  }
}

function review(status: ConversationReview['status']): ConversationReview {
  return {
    status,
    alasan: 'alasan',
    jenisKontak: 'calon_tamu',
    topik: 'Ijen',
    pertanyaan: [],
    poinPenting: [],
    janjiTim: [],
    profil: [],
    statusAgen: '',
    langkahBerikut: '',
  }
}

function day(conversations: ConversationFacts[], extra: Partial<CollectedDay> = {}): CollectedDay {
  return { start, end, conversations, handoffRuns: [], gaps: [], openGapTotal: 0, contactNames: new Map(), ...extra }
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(collectDay).mockReset()
  vi.mocked(reviewConversation).mockReset()
  vi.mocked(saveChatReview).mockClear()
})

describe('buildPayload', () => {
  const unrepliedOk = conv('closed', [msg('INBOUND', new Date(end.getTime() - 3 * HOUR), 'ok thanks')], { inboundToday: 1 })
  const unrepliedOpen = conv('open', [msg('INBOUND', new Date(end.getTime() - 5 * HOUR), 'harga Ijen?')], { inboundToday: 1 })
  const unrepliedUnknown = conv('unknown', [msg('INBOUND', new Date(end.getTime() - 2 * HOUR), 'hmm')], { inboundToday: 1 })
  const dormantClosed = conv('dormant-closed', [msg('OUTBOUND', new Date(end.getTime() - 72 * HOUR))])

  const reviews = new Map<string, ConversationReview | null>([
    ['closed', review('selesai')],
    ['open', review('perlu_tindakan')],
    ['unknown', null],
    ['dormant-closed', review('selesai')],
  ])
  const payload = buildPayload(DATE, day([unrepliedOk, unrepliedOpen, unrepliedUnknown, dormantClosed]), reviews, end)

  it('kandidat yang dinilai selesai tidak tampil, tapi dihitung', () => {
    expect(payload.unreplied.map((u) => u.conversationId)).toEqual(['open', 'unknown'])
    // unrepliedIds: bahan penutupan JUDGED_DONE di syncSummaryItems; dormant tidak ikut.
    expect(payload.filteredOut).toEqual({ unreplied: 1, dormant: 1, unrepliedIds: ['closed'] })
    expect(payload.dormant).toEqual([])
  })

  it('unreplied membawa pesan pertama rangkaian yang belum dibalas (anchor REPLY)', () => {
    const run = conv('run', [
      msg('INBOUND', new Date(end.getTime() - 9 * HOUR), 'lama'),
      msg('OUTBOUND', new Date(end.getTime() - 8 * HOUR), 'balas'),
      msg('INBOUND', new Date(end.getTime() - 6 * HOUR), 'mau tanya'),
      msg('INBOUND', new Date(end.getTime() - 3 * HOUR), 'halo?'),
    ], { inboundToday: 2 })
    const p = buildPayload(DATE, day([run]), new Map([['run', review('perlu_tindakan')]]), end)
    const item = p.unreplied[0]
    expect(item.firstMessageAt).toBe(new Date(end.getTime() - 6 * HOUR).toISOString())
    expect(item.firstMessageId).toBe(run.messages[2].id)
    expect(item.lastMessageId).toBe(run.messages[3].id)
  })

  it('review gagal tetap tampil sebagai belum dicek dan dihitung', () => {
    expect(payload.unreplied.find((u) => u.conversationId === 'unknown')?.review).toBeNull()
    expect(payload.counts.reviewFailed).toBe(1)
    expect(payload.counts.reviewed).toBe(3)
  })

  it('belum dibalas diurutkan dari yang paling lama menunggu', () => {
    expect(payload.unreplied[0].waitingMs).toBe(5 * HOUR)
  })

  it('handoff ditandai masih menunggu bila percakapannya juga belum dibalas', () => {
    const p = buildPayload(
      DATE,
      day([unrepliedOpen], {
        handoffRuns: [{ id: 'run1', conversationId: 'open', startedAt: new Date(start.getTime() + HOUR), inboundText: 'mau bicara dengan orang' }],
        contactNames: new Map([['open', 'Kontak open']]),
      }),
      new Map([['open', review('perlu_tindakan')]]),
      end
    )
    expect(p.handoffs).toEqual([expect.objectContaining({ runId: 'run1', stillWaiting: true, contactName: 'Kontak open' })])
  })

  it('gap dikelompokkan per alasan dan topik', () => {
    const gap = (id: string, reason: string, topic: string) => ({ id, conversationId: 'open', messageId: null, contactName: null, topic, reason, messageText: 'x' })
    const p = buildPayload(
      DATE,
      day([], { gaps: [gap('g1', 'reply_unsourced', 'ijen'), gap('g2', 'reply_unsourced', 'bromo'), gap('g3', 'no_facts_resolved', 'ijen')], openGapTotal: 9 }),
      new Map(),
      end
    )
    expect(p.gaps.byReason).toEqual([{ key: 'reply_unsourced', count: 2 }, { key: 'no_facts_resolved', count: 1 }])
    expect(p.gaps.byTopic[0]).toEqual({ key: 'ijen', count: 2 })
    expect(p.gaps.openTotal).toBe(9)
  })
})

describe('generateDailySummary', () => {
  beforeEach(() => {
    mockPrisma.settings.findUnique.mockResolvedValue({ ollamaModel: 'gemma4:31b-cloud' } as never)
    mockPrisma.dailySummary.deleteMany.mockResolvedValue({ count: 0 })
  })

  it('menilai tiap kandidat sekali dengan model Settings, lalu menyimpan PARTIAL bila ada yang gagal', async () => {
    mockPrisma.dailySummary.updateMany.mockResolvedValue({ count: 1 })
    vi.mocked(collectDay).mockResolvedValue(
      day([
        conv('a', [msg('INBOUND', new Date(end.getTime() - 2 * HOUR))], { inboundToday: 1 }),
        conv('b', [msg('OUTBOUND', new Date(end.getTime() - 3 * HOUR))], { outboundToday: 1 }),
      ])
    )
    // Percakapan b gagal dua kali: percobaan pertama dan satu percobaan ulang.
    vi.mocked(reviewConversation).mockResolvedValueOnce(review('perlu_tindakan')).mockResolvedValueOnce(null).mockResolvedValueOnce(null)

    const result = await generateDailySummary(DATE, end)

    expect(result).toEqual({ outcome: 'generated', date: DATE, status: 'PARTIAL' })
    expect(reviewConversation).toHaveBeenCalledTimes(3)
    expect(vi.mocked(reviewConversation).mock.calls[0][1]).toEqual(['unreplied', 'active'])
    expect(vi.mocked(reviewConversation).mock.calls[0][2]).toBe('gemma4:31b-cloud')
    // Transkrip bernomor + ids pesan, supaya `pesan` dari model bisa diterjemahkan ke messageId.
    const transcript = vi.mocked(reviewConversation).mock.calls[0][0]
    expect(transcript.ids).toEqual([`m-INBOUND-${end.getTime() - 2 * HOUR}`])
    expect(transcript.text).toMatch(/^#1 \[/)
    const update = mockPrisma.dailySummary.update.mock.calls[0][0]
    expect(update.data).toMatchObject({ status: 'PARTIAL', model: 'gemma4:31b-cloud', error: null })
    // Hanya review non-null yang disimpan sebagai ringkasan terbaru, dengan `end` sebagai "per".
    expect(saveChatReview).toHaveBeenCalledTimes(1)
    expect(vi.mocked(saveChatReview).mock.calls[0][0]).toBe('a')
    expect(vi.mocked(saveChatReview).mock.calls[0][2]).toEqual(end)
  })

  it('kegagalan menyimpan ringkasan terbaru tidak mengubah status ringkasan', async () => {
    mockPrisma.dailySummary.updateMany.mockResolvedValue({ count: 1 })
    vi.mocked(collectDay).mockResolvedValue(day([conv('a', [msg('INBOUND', new Date(end.getTime() - 2 * HOUR))], { inboundToday: 1 })]))
    vi.mocked(reviewConversation).mockResolvedValue(review('perlu_tindakan'))
    vi.mocked(saveChatReview).mockRejectedValueOnce(new Error('db mati'))

    const result = await generateDailySummary(DATE, end)

    expect(result).toEqual({ outcome: 'generated', date: DATE, status: 'DONE' })
  })

  it('mencoba ulang sekali percakapan yang gagal dinilai, lalu DONE bila berhasil', async () => {
    mockPrisma.dailySummary.updateMany.mockResolvedValue({ count: 1 })
    vi.mocked(collectDay).mockResolvedValue(day([conv('a', [msg('INBOUND', new Date(end.getTime() - 2 * HOUR))], { inboundToday: 1 })]))
    vi.mocked(reviewConversation).mockResolvedValueOnce(null).mockResolvedValueOnce(review('perlu_tindakan'))

    const result = await generateDailySummary(DATE, end)

    expect(result).toEqual({ outcome: 'generated', date: DATE, status: 'DONE' })
    expect(reviewConversation).toHaveBeenCalledTimes(2)
  })

  it('mengikuti setelan chatbot untuk nomor Indonesia', async () => {
    mockPrisma.settings.findUnique.mockResolvedValue({ ollamaModel: 'm', skipBotForIndonesianNumbers: true } as never)
    mockPrisma.dailySummary.updateMany.mockResolvedValue({ count: 1 })
    vi.mocked(collectDay).mockResolvedValue(day([]))

    await generateDailySummary(DATE, end)

    expect(vi.mocked(collectDay).mock.calls[0][2]).toEqual({ excludeIndonesian: true })
    const update = mockPrisma.dailySummary.update.mock.calls[0][0]
    expect(update.data.payload).toMatchObject({ excludedIndonesian: true })
  })

  it('menolak jalan ganda saat baris RUNNING masih segar', async () => {
    mockPrisma.dailySummary.updateMany.mockResolvedValue({ count: 0 })
    mockPrisma.dailySummary.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' })
    )

    const result = await generateDailySummary(DATE, end)

    expect(result).toEqual({ outcome: 'already_running', date: DATE })
    expect(collectDay).not.toHaveBeenCalled()
  })

  it('memangkas ringkasan chat lama dengan now yang sama, juga saat gagal', async () => {
    mockPrisma.dailySummary.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.dailySummary.update.mockResolvedValue({} as never)
    vi.mocked(collectDay).mockRejectedValue(new Error('x'))
    vi.mocked(pruneChatReviews).mockClear()
    await generateDailySummary(DATE, end)
    expect(pruneChatReviews).toHaveBeenCalledWith(end)
  })

  it('kegagalan pengumpulan data → FAILED tanpa pesan error mentah', async () => {
    mockPrisma.dailySummary.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.dailySummary.update.mockResolvedValue({} as never)
    vi.mocked(collectDay).mockRejectedValue(new Error('connect ECONNREFUSED postgres://user:secret@host'))

    const result = await generateDailySummary(DATE, end)

    expect(result).toEqual({ outcome: 'failed', date: DATE })
    const update = mockPrisma.dailySummary.update.mock.calls[0][0]
    expect(update.data.status).toBe('FAILED')
    expect(String(update.data.error)).not.toContain('secret')
  })
})

describe('reusableReview: tanpa pesan baru, ringkasan terakhir dipakai ulang', () => {
  const last = new Date(end.getTime() - 30 * HOUR)
  const stored = (at: Date | null, chatReview: unknown = review('perlu_tindakan')) => ({ chatReview, chatReviewAt: at })

  it('dipakai bila dibuat sesudah pesan terakhir dan tidak lewat akhir hari; catatan crew dibuang', () => {
    const withCrew = { ...review('perlu_tindakan'), catatanCrew: { diperbaruiAt: 'x', perubahan: ['a'] } }
    const r = reusableReview(stored(new Date(last.getTime() + HOUR), withCrew), last, end)
    expect(r).toMatchObject({ status: 'perlu_tindakan' })
    expect(r).not.toHaveProperty('catatanCrew')
    expect(reusableReview(stored(last), last, end)).not.toBeNull()
    expect(reusableReview(stored(end), last, end)).not.toBeNull()
  })

  it('tidak dipakai bila ada pesan sesudahnya, lebih baru dari akhir hari, belum ada, atau rusak', () => {
    expect(reusableReview(stored(new Date(last.getTime() - 1)), last, end)).toBeNull()
    expect(reusableReview(stored(new Date(end.getTime() + 1)), last, end)).toBeNull()
    expect(reusableReview(stored(null), last, end)).toBeNull()
    expect(reusableReview(undefined, last, end)).toBeNull()
    expect(reusableReview(stored(end, { status: 'aneh' }), last, end)).toBeNull()
    expect(reusableReview(stored(end), undefined, end)).toBeNull()
  })
})

describe('generateDailySummary: pakai ulang ringkasan', () => {
  beforeEach(() => {
    mockPrisma.settings.findUnique.mockResolvedValue({ ollamaModel: 'm' } as never)
    mockPrisma.dailySummary.deleteMany.mockResolvedValue({ count: 0 })
    mockPrisma.dailySummary.updateMany.mockResolvedValue({ count: 1 })
  })
  // 'diam': lead yang tidak ada pesan hari itu, ringkasan terakhir sesudah pesan terakhirnya.
  // 'aktif': ada pesan hari itu sesudah ringkasan terakhirnya → AI.
  const quietAt = new Date(end.getTime() - 72 * HOUR)
  const setup = () => {
    vi.mocked(collectDay).mockResolvedValue(day([
      conv('diam', [msg('OUTBOUND', quietAt)]),
      conv('aktif', [msg('INBOUND', new Date(end.getTime() - 2 * HOUR))], { inboundToday: 1 }),
    ]))
    mockPrisma.conversation.findMany.mockResolvedValue([
      { id: 'diam', bookingData: null, chatReview: review('perlu_tindakan'), chatReviewAt: new Date(quietAt.getTime() + HOUR) },
      { id: 'aktif', bookingData: null, chatReview: review('selesai'), chatReviewAt: new Date(end.getTime() - 5 * HOUR) },
    ] as never)
    vi.mocked(reviewConversation).mockResolvedValue(review('perlu_tindakan'))
  }

  it('cron: chat tanpa pesan baru tidak memanggil AI dan tidak ditulis ulang sebagai ringkasan terbaru', async () => {
    setup()
    await generateDailySummary(DATE, end)
    expect(reviewConversation).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reviewConversation).mock.calls[0][0].ids).toEqual([`m-INBOUND-${end.getTime() - 2 * HOUR}`])
    expect(vi.mocked(saveChatReview).mock.calls.map((c) => c[0])).toEqual(['aktif'])
    const payload = mockPrisma.dailySummary.update.mock.calls[0][0].data.payload as { counts: { reviewReused: number; reviewed: number }; dormant: { conversationId: string; review: unknown }[] }
    expect(payload.counts).toMatchObject({ reviewReused: 1, reviewed: 2 })
    expect(payload.dormant.find((d) => d.conversationId === 'diam')?.review).toMatchObject({ status: 'perlu_tindakan' })
  })

  it('Buat ulang (reuse: false): semua diringkas ulang oleh AI', async () => {
    setup()
    await generateDailySummary(DATE, end, { reuse: false })
    expect(reviewConversation).toHaveBeenCalledTimes(2)
    expect(vi.mocked(saveChatReview).mock.calls.map((c) => c[0]).sort()).toEqual(['aktif', 'diam'])
  })
})

describe('pruneDailySummaries', () => {
  it('menghapus hari yang lebih tua dari 30 hari, berdasarkan tanggal', async () => {
    mockPrisma.dailySummary.deleteMany.mockResolvedValue({ count: 2 })
    await expect(pruneDailySummaries(new Date('2026-09-22T05:00:00Z'))).resolves.toEqual({ deleted: 2 })
    expect(mockPrisma.dailySummary.deleteMany).toHaveBeenCalledWith({ where: { date: { lt: '2026-08-23' } } })
  })

  it('tidak pernah melempar', async () => {
    mockPrisma.dailySummary.deleteMany.mockRejectedValue(new Error('db down'))
    await expect(pruneDailySummaries()).resolves.toEqual({ deleted: 0 })
  })
})
