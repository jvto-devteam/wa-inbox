/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { Prisma, type PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

import { prisma } from '@/lib/db'
import { LOOKBACK_MS, TRANSCRIPT_MAX_MESSAGES, UNREPLIED_MIN_MS } from '@/lib/daily-summary/config'
import { createLiveReplyItems, syncSummaryItems } from './sync'
import type { DailySummaryPayload } from '@/lib/daily-summary/payload-schema'

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
// 15.00 WIB Senin 19 Oktober.
const NOW = new Date('2026-10-19T08:00:00Z')
const HOUR = 60 * 60 * 1000
const MIN = 60 * 1000
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const wib = (d: string, hhmm: string) => new Date(`2026-10-${d}T${hhmm}:00+07:00`)

type Msg = { id: string; direction: 'INBOUND' | 'OUTBOUND'; sentBy: 'CUSTOMER' | 'AGENT' | 'BOT'; type: string; content: string | null; createdAt: Date; botTrace?: unknown }
const inbound = (id: string, createdAt: Date, content: string | null = 'harga Ijen berapa?', type = 'text'): Msg => ({
  id, direction: 'INBOUND', sentBy: 'CUSTOMER', type, content, createdAt,
})
const outbound = (id: string, createdAt: Date, content = 'halo', sentBy: 'AGENT' | 'BOT' = 'AGENT'): Msg => ({ id, direction: 'OUTBOUND', sentBy, type: 'text', content, createdAt })

type ConvOver = {
  id?: string
  phone?: string | null
  createdAt?: Date
  summaryItem?: Record<string, unknown> | null
  chatReview?: unknown
  chatReviewAt?: Date | null
}
/** `messages` urut lama → baru, seperti dibaca orang; kueri aslinya urut baru → lama. */
function conv(messages: Msg[], over: ConvOver = {}) {
  return {
    id: over.id ?? 'c1',
    createdAt: over.createdAt ?? new Date('2026-10-01T00:00:00Z'),
    chatReview: over.chatReview ?? null,
    chatReviewAt: over.chatReviewAt ?? null,
    contact: { phone: over.phone === undefined ? '447700900123' : over.phone },
    summaryItem: over.summaryItem ?? null,
    messages: [...messages].reverse(),
  }
}
type Conv = ReturnType<typeof conv>
const row = (over: Record<string, unknown> = {}) => ({
  id: 'i1', conversationId: 'c1', kind: 'REPLY', state: 'DONE', anchorAt: ago(30 * HOUR), anchorMessageId: 'old', coveredUntil: ago(30 * HOUR), snippet: 'lama',
  review: null, handoff: false, newLead: false, openedOn: '2026-10-17', lastSeenOn: '2026-10-18', reminderId: null, dueAt: null,
  closedReason: 'REPLIED', note: null, closedById: null, closedAt: ago(29 * HOUR), ...over,
})
const review = (status: string) => ({
  status, alasan: '', jenisKontak: 'pelanggan', topik: '', pertanyaan: [], poinPenting: [], janjiTim: [], statusAgen: '', langkahBerikut: '',
})

/**
 * Tiruan dua tahap kueri: tahap 1 (tanpa `where.id`) mengembalikan satu pesan terbaru per
 * percakapan; tahap 2 (`where.id.in`) mengembalikan percakapan lengkap untuk id itu saja.
 */
function given(conversations: Conv[], skipIndonesian = false) {
  mockPrisma.settings.findUnique.mockResolvedValue({ skipBotForIndonesianNumbers: skipIndonesian } as never)
  mockPrisma.conversation.findMany.mockImplementation(((args: { where?: { id?: { in: string[] } } }) => {
    const ids = args.where?.id?.in
    if (ids) return Promise.resolve(conversations.filter((c) => ids.includes(c.id)))
    return Promise.resolve(conversations.map((c) => ({ id: c.id, contact: c.contact, messages: c.messages.slice(0, 5).map((m) => ({ id: m.id, direction: m.direction })) })))
  }) as never)
  automatedFrom(conversations)
}
/** Kueri id pesan otomatis (filter JSON positif `botTrace.source`) dijawab dari botTrace tiruan. */
function automatedFrom(conversations: Conv[]) {
  mockPrisma.message.findMany.mockImplementation(((args: { where: { conversationId: { in: string[] }; OR?: Array<{ botTrace: { equals: string } }> } }) => {
    const sources = (args.where.OR ?? []).map((o) => o.botTrace.equals)
    return Promise.resolve(conversations
      .filter((c) => args.where.conversationId.in.includes(c.id))
      .flatMap((c) => c.messages)
      .filter((m) => m.direction === 'OUTBOUND' && sources.includes(String((m.botTrace as { source?: unknown } | undefined)?.source)))
      .map((m) => ({ id: m.id })))
  }) as never)
}
const phase2Ids = () => {
  const call = mockPrisma.conversation.findMany.mock.calls.find((c) => (c[0]?.where as { id?: unknown } | undefined)?.id)
  return ((call?.[0]?.where as { id: { in: string[] } } | undefined)?.id.in) ?? null
}
const created = () => mockPrisma.summaryItem.create.mock.calls.map((c) => c[0].data)
const updated = () => mockPrisma.summaryItem.update.mock.calls.map((c) => c[0].data)
const none = { created: 0, updated: 0, reopened: 0, skipped: 0 }

beforeEach(() => {
  mockReset(mockPrisma)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('createLiveReplyItems: kueri dua tahap', () => {
  it('tahap 1: saringan test/otomatis/jendela waktu, hanya satu pesan terbaru; tahap 2: 30 pesan + review untuk kandidat saja', async () => {
    given([conv([inbound('m1', ago(2 * HOUR))], { id: 'calon' }), conv([inbound('m2', ago(5 * HOUR)), outbound('o1', ago(3 * HOUR))], { id: 'dibalas' })])
    await createLiveReplyItems(NOW)
    expect(mockPrisma.conversation.findMany).toHaveBeenCalledTimes(2)
    const [phase1, phase2] = mockPrisma.conversation.findMany.mock.calls.map((c) => c[0])
    const cutoff = ago(UNREPLIED_MIN_MS)
    const lookbackStart = ago(LOOKBACK_MS)
    expect(phase1?.where).toEqual({
      isTest: false,
      mailAutomated: false,
      messages: {
        some: { direction: 'INBOUND', createdAt: { gte: lookbackStart, lte: cutoff } },
        none: { direction: 'OUTBOUND', createdAt: { gt: cutoff } },
      },
    })
    expect(phase1?.select).not.toHaveProperty('chatReview')
    expect(phase1?.select?.messages).toMatchObject({ where: { createdAt: { gte: lookbackStart } }, orderBy: { createdAt: 'desc' }, take: 5 })
    // Review Important B: botTrace (BotDecision, bisa beberapa KB) tidak pernah dimuat di tahap 1 maupun 2.
    const messageSelect = (q: typeof phase1) => (q?.select?.messages as { select?: Record<string, unknown> } | undefined)?.select
    expect(messageSelect(phase1)).toEqual({ id: true, direction: true })
    expect(messageSelect(phase2)).not.toHaveProperty('botTrace')
    expect(phase2?.where).toEqual({ id: { in: ['calon'] } })
    expect(phase2?.select).toMatchObject({ chatReview: true, chatReviewAt: true, summaryItem: true })
    expect(phase2?.select?.messages).toMatchObject({ where: { createdAt: { gte: lookbackStart } }, orderBy: { createdAt: 'desc' }, take: TRANSCRIPT_MAX_MESSAGES })
    // Satu-satunya kueri pesan: id pesan otomatis untuk kandidat (hanya `id`, filter JSON positif).
    for (const [q] of mockPrisma.message.findMany.mock.calls) {
      expect(q?.select).toEqual({ id: true })
      expect(q?.where).toMatchObject({ direction: 'OUTBOUND', OR: [{ botTrace: { path: ['source'], equals: 'booking_update_notice' } }, { botTrace: { path: ['source'], equals: 'data_request' } }, { botTrace: { path: ['source'], equals: 'booking_request_ack' } }] })
    }
    expect(mockPrisma.message.findFirst).not.toHaveBeenCalled()
  })

  it('tanpa kandidat: tahap 2 tidak dijalankan', async () => {
    given([conv([inbound('m1', ago(5 * HOUR)), outbound('o1', ago(3 * HOUR))])])
    expect(await createLiveReplyItems(NOW)).toEqual(none)
    expect(mockPrisma.conversation.findMany).toHaveBeenCalledTimes(1)
  })

  it('nomor Indonesia dikecualikan di tahap 1 hanya bila skipBotForIndonesianNumbers', async () => {
    const list = () => [conv([inbound('m1', ago(2 * HOUR))], { id: 'id', phone: '6281234567890' }), conv([inbound('m2', ago(2 * HOUR))], { id: 'uk' })]
    given(list(), true)
    await createLiveReplyItems(NOW)
    expect(phase2Ids()).toEqual(['uk'])
    expect(created().map((d) => d.conversationId)).toEqual(['uk'])

    mockReset(mockPrisma)
    given(list(), false)
    await createLiveReplyItems(NOW)
    expect(created().map((d) => d.conversationId)).toEqual(['id', 'uk'])
  })
})

describe('createLiveReplyItems: pemilihan kandidat', () => {
  it('pesan pelanggan tepat 1 jam belum dibalas masuk antrean sebagai REPLY OPEN', async () => {
    given([conv([outbound('o1', ago(5 * HOUR)), inbound('m1', ago(UNREPLIED_MIN_MS))])])
    expect(await createLiveReplyItems(NOW)).toEqual({ ...none, created: 1 })
    expect(created()[0]).toMatchObject({
      conversationId: 'c1', kind: 'REPLY', state: 'OPEN', anchorAt: ago(UNREPLIED_MIN_MS), anchorMessageId: 'm1', coveredUntil: ago(UNREPLIED_MIN_MS),
      snippet: 'harga Ijen berapa?', review: Prisma.DbNull, handoff: false, openedOn: '2026-10-19', lastSeenOn: '2026-10-19',
    })
  })

  it('pesan yang baru 59 menit belum jadi item', async () => {
    given([conv([inbound('m1', ago(UNREPLIED_MIN_MS - 1))])])
    expect(await createLiveReplyItems(NOW)).toEqual(none)
    expect(mockPrisma.summaryItem.create).not.toHaveBeenCalled()
  })

  it('lama menunggu dari pesan PERTAMA: 09.00, 09.40, 10.20 dengan now 10.30 → anchor 09.00, cakupan + snippet 10.20', async () => {
    given([conv([outbound('o1', wib('19', '08:30')), inbound('m1', wib('19', '09:00'), 'mau booking Bromo'), inbound('m2', wib('19', '09:40'), 'halo?'), inbound('m3', wib('19', '10:20'), 'kak')])])
    expect(await createLiveReplyItems(wib('19', '10:30'))).toEqual({ ...none, created: 1 })
    expect(created()[0]).toMatchObject({ anchorMessageId: 'm1', anchorAt: wib('19', '09:00'), coveredUntil: wib('19', '10:20'), snippet: 'kak' })
  })

  it('balasan kita di tengah memotong rangkaian: pesan sesudahnya yang baru 10 menit belum jadi item', async () => {
    given([conv([inbound('m1', ago(3 * HOUR)), outbound('o1', ago(2 * HOUR)), inbound('m2', ago(10 * MIN))])])
    expect(await createLiveReplyItems(NOW)).toEqual(none)
    expect(mockPrisma.summaryItem.create).not.toHaveBeenCalled()
  })

  it('batas 14 hari: tepat 14 hari masih masuk, lebih tua tidak', async () => {
    given([conv([inbound('m1', ago(LOOKBACK_MS))], { id: 'c1' }), conv([inbound('m2', ago(LOOKBACK_MS + 1))], { id: 'c2' })])
    expect(await createLiveReplyItems(NOW)).toEqual({ ...none, created: 1 })
    expect(created().map((d) => d.conversationId)).toEqual(['c1'])
  })

  it('openedOn/lastSeenOn = hari WIB pesan terbaru, bukan hari tick', async () => {
    given([conv([inbound('m1', wib('18', '23:00')), inbound('m2', wib('18', '23:30'))])])
    await createLiveReplyItems(wib('19', '00:40'))
    expect(created()[0]).toMatchObject({ openedOn: '2026-10-18', lastSeenOn: '2026-10-18' })
  })

  it('newLead = percakapan lahir pada hari pesan terbaru (WIB)', async () => {
    given([conv([inbound('m1', ago(2 * HOUR))], { createdAt: new Date('2026-10-18T17:30:00Z') })]) // 00.30 WIB 19 Okt
    await createLiveReplyItems(NOW)
    expect(created()[0]).toMatchObject({ newLead: true })
  })
})

describe('createLiveReplyItems: saringan penutup', () => {
  it('hanya penutup ("ok thanks") dilewati', async () => {
    given([conv([outbound('o1', ago(5 * HOUR)), inbound('m1', ago(4 * HOUR), 'ok thanks')])])
    expect(await createLiveReplyItems(NOW)).toEqual({ ...none, skipped: 1 })
    expect(mockPrisma.summaryItem.create).not.toHaveBeenCalled()
  })

  it('reaksi (bentuk produksi: content null) dilewati', async () => {
    given([conv([outbound('o1', ago(5 * HOUR)), inbound('m1', ago(4 * HOUR), null, 'reaction')])])
    expect(await createLiveReplyItems(NOW)).toEqual({ ...none, skipped: 1 })
  })

  it('penutup sesudah pertanyaan tidak menyembunyikannya: anchor di pertanyaan, snippet = pesan terbaru', async () => {
    given([conv([outbound('o1', ago(6 * HOUR)), inbound('q1', ago(5 * HOUR), 'pickup jam berapa?'), inbound('m2', ago(4 * HOUR), 'ok thanks 🙏')])])
    expect(await createLiveReplyItems(NOW)).toEqual({ ...none, created: 1 })
    expect(created()[0]).toMatchObject({ anchorMessageId: 'q1', anchorAt: ago(5 * HOUR), coveredUntil: ago(4 * HOUR), snippet: 'ok thanks 🙏' })
  })

  it('"oke"/"siap" sesudah pertanyaan AGEN adalah jawaban, bukan penutup', async () => {
    for (const reply of [inbound('m1', ago(4 * HOUR), 'oke kak'), inbound('m1', ago(4 * HOUR), 'siap')]) {
      mockReset(mockPrisma)
      given([conv([outbound('o1', ago(5 * HOUR), 'Mau saya booking-kan untuk tanggal 20?'), reply])])
      expect(await createLiveReplyItems(NOW)).toEqual({ ...none, created: 1 })
    }
  })

  // Repro review N2: reaksi tersimpan dengan content null, jadi emojinya tidak diketahui.
  it('reaksi (content null) atau emoji saja sesudah pertanyaan agen maupun bot tetap penutup', async () => {
    for (const sentBy of ['AGENT', 'BOT'] as const) {
      for (const reply of [inbound('r1', ago(4 * HOUR), null, 'reaction'), inbound('r1', ago(4 * HOUR), '👍')]) {
        mockReset(mockPrisma)
        given([conv([outbound('o1', ago(5 * HOUR), 'Ada lagi yang bisa kami bantu?', sentBy), reply])])
        expect(await createLiveReplyItems(NOW)).toEqual({ ...none, skipped: 1 })
        expect(mockPrisma.summaryItem.create).not.toHaveBeenCalled()
      }
    }
  })

  it('"ok" sesudah pertanyaan persona BOT tetap penutup', async () => {
    given([conv([outbound('o1', ago(5 * HOUR), 'Ada lagi yang bisa kami bantu?', 'BOT'), inbound('m1', ago(4 * HOUR), 'ok')])])
    expect(await createLiveReplyItems(NOW)).toEqual({ ...none, skipped: 1 })
    expect(mockPrisma.summaryItem.create).not.toHaveBeenCalled()
  })

  it('"oke" sesudah pesan kita yang bukan pertanyaan tetap penutup; "thanks" sesudah pertanyaan juga', async () => {
    given([conv([outbound('o1', ago(5 * HOUR), 'Ini link pembayarannya.'), inbound('m1', ago(4 * HOUR), 'oke')], { id: 'c1' }),
      conv([outbound('o2', ago(5 * HOUR), 'Ada lagi yang bisa dibantu?'), inbound('m2', ago(4 * HOUR), 'thanks')], { id: 'c2' })])
    expect(await createLiveReplyItems(NOW)).toEqual({ ...none, skipped: 2 })
  })

  it('gambar tanpa caption (bukti transfer?) tetap jadi item', async () => {
    given([conv([outbound('o1', ago(6 * HOUR)), inbound('m1', ago(5 * HOUR), null, 'image')])])
    await createLiveReplyItems(NOW)
    expect(created()[0]).toMatchObject({ anchorMessageId: 'm1', snippet: '[image]' })
  })

  it('review "selesai" dengan chatReviewAt = waktu pesan terakhir belum melihatnya (transkrip `lt end`): item tetap dibuat', async () => {
    given([conv([inbound('m1', ago(20 * HOUR), 'Great, see you then!')], { chatReview: review('selesai'), chatReviewAt: ago(20 * HOUR) })])
    expect(await createLiveReplyItems(NOW)).toEqual({ ...none, created: 1 })
  })

  it('review terbaru "selesai" yang sudah melihat pesan terakhir (pesan < chatReviewAt): dilewati', async () => {
    given([conv([inbound('m1', ago(20 * HOUR), 'Great, see you then!')], { chatReview: review('selesai'), chatReviewAt: ago(20 * HOUR - 1) })])
    expect(await createLiveReplyItems(NOW)).toEqual({ ...none, skipped: 1 })
  })

  it('review "selesai" yang lebih tua dari pesan terakhir tidak menahan item', async () => {
    given([conv([inbound('m1', ago(3 * HOUR), 'one more question')], { chatReview: review('selesai'), chatReviewAt: ago(3 * HOUR + 1) })])
    expect((await createLiveReplyItems(NOW)).created).toBe(1)
  })

  it('review terbaru "perlu_tindakan" tidak menahan item', async () => {
    given([conv([inbound('m1', ago(20 * HOUR))], { chatReview: review('perlu_tindakan'), chatReviewAt: ago(15 * HOUR) })])
    expect((await createLiveReplyItems(NOW)).created).toBe(1)
  })
})

describe('createLiveReplyItems: baris yang sudah ada', () => {
  it.each(['OPEN', 'SCHEDULED'])('REPLY %s dengan pesan baru: cakupan + snippet maju, anchor tetap', async (state) => {
    const open = row({ state, closedReason: null, closedAt: null, anchorAt: ago(5 * HOUR), anchorMessageId: 'm1', coveredUntil: ago(5 * HOUR) })
    given([conv([inbound('m1', ago(5 * HOUR)), inbound('m2', ago(20 * MIN), 'any update')], { summaryItem: open })])
    expect(await createLiveReplyItems(NOW)).toEqual({ ...none, updated: 1 })
    expect(mockPrisma.summaryItem.update.mock.calls[0][0]).toEqual({ where: { id: 'i1' }, data: { coveredUntil: ago(20 * MIN), snippet: 'any update' } })
  })

  it('REPLY OPEN yang sudah mencakup pesan terbaru: tidak menulis apa pun (idempoten)', async () => {
    const open = row({ state: 'OPEN', closedReason: null, closedAt: null, anchorAt: ago(5 * HOUR), coveredUntil: ago(2 * HOUR) })
    given([conv([inbound('m1', ago(5 * HOUR)), inbound('m2', ago(2 * HOUR))], { summaryItem: open })])
    expect(await createLiveReplyItems(NOW)).toEqual({ ...none, skipped: 1 })
    expect(mockPrisma.summaryItem.update).not.toHaveBeenCalled()
    expect(mockPrisma.summaryItem.create).not.toHaveBeenCalled()
  })

  it.each(['FOLLOW_UP', 'PROMISE'])('%s OPEN/SCHEDULED dibiarkan untuk reconcile', async (kind) => {
    for (const state of ['OPEN', 'SCHEDULED']) {
      mockReset(mockPrisma)
      given([conv([inbound('m1', ago(2 * HOUR))], { summaryItem: row({ kind, state, closedReason: null, closedAt: null, coveredUntil: null }) })])
      expect(await createLiveReplyItems(NOW)).toEqual({ ...none, skipped: 1 })
      expect(mockPrisma.summaryItem.update).not.toHaveBeenCalled()
    }
  })

  it('DONE/REPLIED lalu pelanggan chat lagi: dibuka ulang, anchor pesan pertama, cakupan terbaru, penutupan dikosongkan', async () => {
    given([conv([outbound('o1', ago(29 * HOUR)), inbound('m1', ago(3 * HOUR), 'kak?'), inbound('m2', ago(2 * HOUR), 'halo')], { summaryItem: row({ note: 'x', closedById: 'a' }) })])
    expect(await createLiveReplyItems(NOW)).toEqual({ ...none, reopened: 1 })
    expect(updated()[0]).toMatchObject({
      kind: 'REPLY', state: 'OPEN', anchorAt: ago(3 * HOUR), anchorMessageId: 'm1', coveredUntil: ago(2 * HOUR), snippet: 'halo',
      openedOn: '2026-10-19', lastSeenOn: '2026-10-19', closedReason: null, closedAt: null, note: null, closedById: null, reminderId: null, dueAt: null,
    })
  })

  it('FOLLOW_UP yang sudah tertutup jadi REPLY saat dibuka ulang', async () => {
    given([conv([inbound('m1', ago(3 * HOUR))], { summaryItem: row({ kind: 'FOLLOW_UP', coveredUntil: null }) })])
    expect((await createLiveReplyItems(NOW)).reopened).toBe(1)
    expect(updated()[0]).toMatchObject({ kind: 'REPLY', state: 'OPEN' })
  })

  describe('satu Lepas berlaku untuk semua yang sudah tercakup kartu (repro review)', () => {
    const run = [outbound('o1', wib('19', '08:30')), inbound('m1', wib('19', '09:00'), 'mau booking Bromo'), inbound('m2', wib('19', '09:40'), 'halo?'), inbound('m3', wib('19', '10:20'), 'kak')]
    // Kartu live: dibuat 10.00 (anchor m1), cakupannya maju ke m3 pada tick 10.25, lalu dilepas 10.30.
    const dropped = row({ state: 'DROPPED', closedReason: 'DROPPED', anchorAt: wib('19', '09:00'), anchorMessageId: 'm1', coveredUntil: wib('19', '10:20'), closedAt: wib('19', '10:30') })

    it('tick sesudah Lepas tidak membukanya lagi oleh m2/m3 yang sudah ada sebelum Lepas', async () => {
      for (const at of ['10:45', '11:00', '14:00']) {
        mockReset(mockPrisma)
        given([conv(run, { summaryItem: dropped })])
        expect(await createLiveReplyItems(wib('19', at))).toEqual({ ...none, skipped: 1 })
        expect(mockPrisma.summaryItem.update).not.toHaveBeenCalled()
      }
    })

    it('pesan masuk yang benar-benar baru sesudah Lepas membukanya lagi', async () => {
      given([conv([...run, inbound('m4', wib('19', '11:10'), 'jadi bisa?')], { summaryItem: dropped })])
      expect(await createLiveReplyItems(wib('19', '11:15'))).toEqual({ ...none, reopened: 1 })
      expect(updated()[0]).toMatchObject({ state: 'OPEN', anchorMessageId: 'm1', anchorAt: wib('19', '09:00'), coveredUntil: wib('19', '11:10'), snippet: 'jadi bisa?' })
    })

    // Repro review N1, utuh: tick → sync malam → Lepas. Kartu harus menampilkan m4 sebelum Lepas
    // boleh mencakupnya; sesudah itu hanya pesan yang benar-benar baru yang membuka lagi.
    it('tick 00.15 memajukan kartu ke m4, sync malam 00.30 tidak memundurkan snippet, Lepas hanya menutup yang tampil', async () => {
      const m4 = inbound('m4', wib('20', '00:10'), 'pertanyaan baru 00.10')
      const open = row({ state: 'OPEN', closedReason: null, closedAt: null, anchorAt: wib('19', '09:00'), anchorMessageId: 'm1', coveredUntil: wib('19', '10:20'), snippet: 'kak', openedOn: '2026-10-19', lastSeenOn: '2026-10-19' })
      given([conv([...run, m4], { summaryItem: open })])
      expect(await createLiveReplyItems(wib('20', '00:15'))).toEqual({ ...none, updated: 1 })
      const afterTick = { ...open, ...updated()[0] }
      expect(afterTick).toMatchObject({ coveredUntil: wib('20', '00:10'), snippet: 'pertanyaan baru 00.10' })

      mockReset(mockPrisma)
      mockPrisma.summaryItem.findUnique.mockResolvedValue(afterTick as never)
      const nightly = {
        unreplied: [{ conversationId: 'c1', contactName: 'x', pipelineStage: 'new', lastMessageAt: wib('19', '10:20').toISOString(), lastMessageId: 'm3',
          firstMessageAt: wib('19', '09:00').toISOString(), firstMessageId: 'm1', waitingMs: 1, snippet: 'kak', review: null }],
        dormant: [], handoffs: [], newLeads: [], conversations: [],
      } as unknown as DailySummaryPayload
      await syncSummaryItems('2026-10-19', nightly, wib('20', '00:30'))
      const afterSync = { ...afterTick, ...updated()[0] }
      expect(afterSync).toMatchObject({ coveredUntil: wib('20', '00:10'), snippet: 'pertanyaan baru 00.10', anchorAt: wib('19', '09:00') })

      // Operator melihat m4 di kartu lalu Lepas: m4 tidak membukanya lagi, m5 membuka.
      const droppedAfter = { ...afterSync, state: 'DROPPED', closedReason: 'DROPPED', closedAt: wib('20', '08:00') }
      mockReset(mockPrisma)
      given([conv([...run, m4], { summaryItem: droppedAfter })])
      expect(await createLiveReplyItems(wib('20', '08:30'))).toEqual({ ...none, skipped: 1 })
      mockReset(mockPrisma)
      given([conv([...run, m4, inbound('m5', wib('20', '08:40'), 'jadi bisa?')], { summaryItem: droppedAfter })])
      expect(await createLiveReplyItems(wib('20', '09:00'))).toEqual({ ...none, reopened: 1 })
      expect(updated()[0]).toMatchObject({ coveredUntil: wib('20', '08:40'), snippet: 'jadi bisa?' })
    })

    it('yang baru hanya penutup tidak membuka lagi', async () => {
      given([conv([...run, inbound('m4', wib('19', '11:10'), 'ok thanks')], { summaryItem: dropped })])
      expect(await createLiveReplyItems(wib('19', '11:15'))).toEqual({ ...none, skipped: 1 })
    })
  })

  it('baris lama tanpa coveredUntil: cakupannya = anchor (dulu selalu pesan terakhir)', async () => {
    const legacy = row({ state: 'DROPPED', closedReason: 'DROPPED', anchorAt: ago(30 * HOUR), coveredUntil: null, closedAt: ago(20 * HOUR) })
    given([conv([inbound('m1', ago(30 * HOUR))], { summaryItem: legacy })])
    expect(await createLiveReplyItems(NOW)).toEqual({ ...none, skipped: 1 })
    mockReset(mockPrisma)
    given([conv([inbound('m1', ago(30 * HOUR)), inbound('m2', ago(25 * HOUR), 'any update')], { summaryItem: legacy })])
    expect((await createLiveReplyItems(NOW)).reopened).toBe(1)
  })

  it('REMINDER_DONE memakai cakupan kartu, sama dengan sync malam', async () => {
    const reminderDone = row({ closedReason: 'REMINDER_DONE', anchorAt: ago(30 * HOUR), coveredUntil: ago(12 * HOUR), closedAt: ago(2 * HOUR) })
    given([conv([inbound('m1', ago(30 * HOUR)), inbound('m2', ago(12 * HOUR), 'kak?')], { summaryItem: reminderDone })])
    expect((await createLiveReplyItems(NOW)).reopened).toBe(0)
    mockReset(mockPrisma)
    given([conv([inbound('m1', ago(30 * HOUR)), inbound('m2', ago(12 * HOUR), 'kak?'), inbound('m3', ago(5 * HOUR), 'halo')], { summaryItem: reminderDone })])
    expect((await createLiveReplyItems(NOW)).reopened).toBe(1)
  })

  it('JUDGED_DONE: pesan sebelum closedAt tidak membuka, pesan sesudahnya membuka', async () => {
    const judged = row({ closedReason: 'JUDGED_DONE', anchorAt: ago(30 * HOUR), coveredUntil: ago(30 * HOUR), closedAt: ago(15 * HOUR) })
    given([conv([inbound('m1', ago(30 * HOUR), 'Great, see you then!')], { summaryItem: judged })])
    expect(await createLiveReplyItems(NOW)).toEqual({ ...none, skipped: 1 })

    mockReset(mockPrisma)
    given([conv([inbound('m1', ago(30 * HOUR), 'Great, see you then!'), inbound('m2', ago(3 * HOUR), 'oh wait, one question')], { summaryItem: judged })])
    expect((await createLiveReplyItems(NOW)).reopened).toBe(1)
    expect(updated()[0]).toMatchObject({ anchorMessageId: 'm1', coveredUntil: ago(3 * HOUR), state: 'OPEN' })
  })
})

describe('createLiveReplyItems: tidak pernah melempar', () => {
  it('Settings gagal dibaca', async () => {
    mockPrisma.settings.findUnique.mockRejectedValue(new Error('db down'))
    await expect(createLiveReplyItems(NOW)).resolves.toEqual(none)
  })

  it('kueri percakapan gagal', async () => {
    mockPrisma.settings.findUnique.mockResolvedValue(null)
    mockPrisma.conversation.findMany.mockRejectedValue(new Error('db down'))
    await expect(createLiveReplyItems(NOW)).resolves.toEqual(none)
  })

  it('satu tulisan gagal tidak menghentikan percakapan lain', async () => {
    given([conv([inbound('m1', ago(2 * HOUR))], { id: 'c1' }), conv([inbound('m2', ago(2 * HOUR))], { id: 'c2' })])
    mockPrisma.summaryItem.create.mockRejectedValueOnce(new Error('unique')).mockResolvedValueOnce({} as never)
    await expect(createLiveReplyItems(NOW)).resolves.toEqual({ ...none, created: 1 })
    expect(mockPrisma.summaryItem.create).toHaveBeenCalledTimes(2)
  })
})

describe('review 2026-10-20 Important 1: kabar otomatis bukan balasan kita', () => {
  const notice = (id: string, createdAt: Date, source = 'booking_update_notice'): Msg => ({
    ...outbound(id, createdAt, 'Noted, thank you! Your booking has been updated:', 'BOT'), botTrace: { source, idempotencyKey: `guest_update:${id}` },
  })

  it('pertanyaan tamu + kabar otomatis sesudahnya -> REPLY tetap dibuat (anchor = pertanyaan)', async () => {
    given([conv([inbound('m1', ago(2 * HOUR), 'ganti kaos jadi L, dan bisa tambah Ijen?'), notice('n1', ago(2 * HOUR - 10_000))])])
    expect(await createLiveReplyItems(NOW)).toEqual({ ...none, created: 1 })
    expect(created()[0]).toMatchObject({ kind: 'REPLY', anchorMessageId: 'm1', snippet: 'ganti kaos jadi L, dan bisa tambah Ijen?' })
  })

  it('tanda terima "permintaan diterima" (booking_request_ack) juga otomatis: pertanyaan tamu tetap REPLY', async () => {
    given([conv([inbound('m1', ago(2 * HOUR), 'ganti kaos jadi L, dan bisa tambah Ijen?'), notice('n1', ago(2 * HOUR - 5_000), 'booking_request_ack')])])
    expect(await createLiveReplyItems(NOW)).toEqual({ ...none, created: 1 })
    expect(created()[0]).toMatchObject({ kind: 'REPLY', anchorMessageId: 'm1' })
  })

  it('pesan permintaan data juga dilewati; balasan agen sungguhan tetap menutup kandidat', async () => {
    given([conv([inbound('m1', ago(3 * HOUR)), notice('n1', ago(3 * HOUR - 10_000), 'data_request')])])
    expect((await createLiveReplyItems(NOW)).created).toBe(1)
    mockReset(mockPrisma)
    given([conv([inbound('m1', ago(3 * HOUR)), notice('n1', ago(3 * HOUR - 10_000)), outbound('o1', ago(2 * HOUR))])])
    expect((await createLiveReplyItems(NOW)).created).toBe(0)
  })

  it('percakapan yang tersaring tahap 1 karena kabar sesudah cutoff ditemukan lagi lewat event kabar', async () => {
    const c = conv([inbound('m1', ago(61 * MIN)), notice('n1', ago(59 * MIN))], { id: 'kabar' })
    mockPrisma.settings.findUnique.mockResolvedValue({ skipBotForIndonesianNumbers: false } as never)
    mockPrisma.bookingActionEvent.findMany.mockResolvedValue([{ conversationId: 'kabar' }] as never)
    mockPrisma.conversation.findMany.mockImplementation(((args: { where: { id?: { in: string[] }; isTest?: boolean } }) => {
      if (!args.where.id) return Promise.resolve([]) // `none OUTBOUND sesudah cutoff` menyingkirkannya
      if (args.where.isTest === false) return Promise.resolve([{ id: c.id, contact: c.contact, messages: c.messages.map((m) => ({ id: m.id, direction: m.direction })) }])
      return Promise.resolve([c])
    }) as never)
    automatedFrom([c])
    expect((await createLiveReplyItems(NOW)).created).toBe(1)
    expect(mockPrisma.bookingActionEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { event: { in: ['GUEST_NOTICE_SENT', 'GUEST_ACK_SENT', 'DRAFT_SENT'] }, createdAt: { gt: ago(UNREPLIED_MIN_MS) } },
    }))
  })
})
