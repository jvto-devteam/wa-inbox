/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { Prisma, type PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

import { prisma } from '@/lib/db'
import { LOOKBACK_MS, TRANSCRIPT_MAX_MESSAGES, UNREPLIED_MIN_MS } from '@/lib/daily-summary/config'
import { createLiveReplyItems } from './sync'

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
// 15.00 WIB Senin 19 Oktober.
const NOW = new Date('2026-10-19T08:00:00Z')
const HOUR = 60 * 60 * 1000
const ago = (ms: number) => new Date(NOW.getTime() - ms)

type Msg = { id: string; direction: 'INBOUND' | 'OUTBOUND'; sentBy: 'CUSTOMER' | 'AGENT' | 'BOT'; type: string; content: string | null; createdAt: Date }
const inbound = (id: string, createdAt: Date, content: string | null = 'harga Ijen berapa?', type = 'text'): Msg => ({
  id, direction: 'INBOUND', sentBy: 'CUSTOMER', type, content, createdAt,
})
const outbound = (id: string, createdAt: Date): Msg => ({ id, direction: 'OUTBOUND', sentBy: 'AGENT', type: 'text', content: 'halo', createdAt })

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
const row = (over: Record<string, unknown> = {}) => ({
  id: 'i1', conversationId: 'c1', kind: 'REPLY', state: 'DONE', anchorAt: ago(30 * HOUR), anchorMessageId: 'old', snippet: 'lama',
  review: null, handoff: false, newLead: false, openedOn: '2026-10-17', lastSeenOn: '2026-10-18', reminderId: null, dueAt: null,
  closedReason: 'REPLIED', note: null, closedById: null, closedAt: ago(29 * HOUR), ...over,
})
const review = (status: string) => ({
  status, ringkasan: 'x', pertanyaanTerbuka: [], poinPenting: [], janjiTim: [], statusAgen: '', langkahBerikut: '',
})

function given(conversations: ReturnType<typeof conv>[], skipIndonesian = false) {
  mockPrisma.settings.findUnique.mockResolvedValue({ skipBotForIndonesianNumbers: skipIndonesian } as never)
  mockPrisma.conversation.findMany.mockResolvedValue(conversations as never)
}
const created = () => mockPrisma.summaryItem.create.mock.calls.map((c) => c[0].data)
const updated = () => mockPrisma.summaryItem.update.mock.calls.map((c) => c[0].data)

beforeEach(() => {
  mockReset(mockPrisma)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('createLiveReplyItems: pemilihan kandidat', () => {
  it('satu kueri percakapan dengan saringan test/otomatis dan jendela waktu, pesan ikut terbawa', async () => {
    given([])
    await createLiveReplyItems(NOW)
    expect(mockPrisma.conversation.findMany).toHaveBeenCalledTimes(1)
    const args = mockPrisma.conversation.findMany.mock.calls[0][0]
    const cutoff = ago(UNREPLIED_MIN_MS)
    const lookbackStart = ago(LOOKBACK_MS)
    expect(args?.where).toEqual({
      isTest: false,
      mailAutomated: false,
      messages: {
        some: { direction: 'INBOUND', createdAt: { gte: lookbackStart, lte: cutoff } },
        none: { direction: 'OUTBOUND', createdAt: { gt: cutoff } },
      },
    })
    expect(args?.select?.summaryItem).toBe(true)
    expect(args?.select?.messages).toMatchObject({ where: { createdAt: { gte: lookbackStart } }, orderBy: { createdAt: 'desc' }, take: TRANSCRIPT_MAX_MESSAGES })
    expect(mockPrisma.message.findMany).not.toHaveBeenCalled()
    expect(mockPrisma.message.findFirst).not.toHaveBeenCalled()
  })

  it('pesan pelanggan tepat 1 jam belum dibalas masuk antrean sebagai REPLY OPEN', async () => {
    given([conv([outbound('o1', ago(5 * HOUR)), inbound('m1', ago(UNREPLIED_MIN_MS))])])
    expect(await createLiveReplyItems(NOW)).toEqual({ created: 1, reopened: 0, skipped: 0 })
    expect(created()[0]).toMatchObject({
      conversationId: 'c1', kind: 'REPLY', state: 'OPEN', anchorAt: ago(UNREPLIED_MIN_MS), anchorMessageId: 'm1',
      snippet: 'harga Ijen berapa?', review: Prisma.DbNull, handoff: false, openedOn: '2026-10-19', lastSeenOn: '2026-10-19',
    })
  })

  it('pesan yang baru 59 menit belum jadi item', async () => {
    given([conv([inbound('m1', ago(UNREPLIED_MIN_MS - 1))])])
    expect(await createLiveReplyItems(NOW)).toEqual({ created: 0, reopened: 0, skipped: 0 })
    expect(mockPrisma.summaryItem.create).not.toHaveBeenCalled()
  })

  it('lama menunggu dihitung dari pesan PERTAMA: 09.00, 09.40, 10.20 dengan now 10.30 → item anchor 09.00', async () => {
    const now = new Date('2026-10-19T03:30:00Z') // 10.30 WIB
    const wib = (hhmm: string) => new Date(`2026-10-19T${hhmm}:00+07:00`)
    given([conv([outbound('o1', wib('08:30')), inbound('m1', wib('09:00'), 'mau booking Bromo'), inbound('m2', wib('09:40'), 'halo?'), inbound('m3', wib('10:20'), 'kak')])])
    expect(await createLiveReplyItems(now)).toEqual({ created: 1, reopened: 0, skipped: 0 })
    expect(created()[0]).toMatchObject({ anchorMessageId: 'm1', anchorAt: wib('09:00'), snippet: 'mau booking Bromo' })
  })

  it('balasan kita di tengah memotong rangkaian: pesan sesudahnya yang baru 10 menit belum jadi item', async () => {
    given([conv([inbound('m1', ago(3 * HOUR)), outbound('o1', ago(2 * HOUR)), inbound('m2', ago(10 * 60 * 1000))])])
    expect(await createLiveReplyItems(NOW)).toEqual({ created: 0, reopened: 0, skipped: 0 })
    expect(mockPrisma.summaryItem.create).not.toHaveBeenCalled()
  })

  it('batas 14 hari: tepat 14 hari masih masuk, lebih tua tidak', async () => {
    given([conv([inbound('m1', ago(LOOKBACK_MS))], { id: 'c1' }), conv([inbound('m2', ago(LOOKBACK_MS + 1))], { id: 'c2' })])
    expect(await createLiveReplyItems(NOW)).toEqual({ created: 1, reopened: 0, skipped: 0 })
    expect(created().map((d) => d.conversationId)).toEqual(['c1'])
  })

  it('pesan terakhir dari kita: tidak ada item', async () => {
    given([conv([inbound('m1', ago(5 * HOUR)), outbound('o1', ago(4 * HOUR))])])
    expect(await createLiveReplyItems(NOW)).toEqual({ created: 0, reopened: 0, skipped: 0 })
    expect(mockPrisma.summaryItem.create).not.toHaveBeenCalled()
  })

  it('nomor Indonesia dikecualikan hanya bila skipBotForIndonesianNumbers', async () => {
    const list = () => [conv([inbound('m1', ago(2 * HOUR))], { id: 'id', phone: '6281234567890' }), conv([inbound('m2', ago(2 * HOUR))], { id: 'uk' })]
    given(list(), true)
    await createLiveReplyItems(NOW)
    expect(created().map((d) => d.conversationId)).toEqual(['uk'])

    mockReset(mockPrisma)
    given(list(), false)
    await createLiveReplyItems(NOW)
    expect(created().map((d) => d.conversationId)).toEqual(['id', 'uk'])
  })

  it('newLead = percakapan lahir hari ini (WIB)', async () => {
    given([conv([inbound('m1', ago(2 * HOUR))], { createdAt: new Date('2026-10-18T17:30:00Z') })]) // 00.30 WIB 19 Okt
    await createLiveReplyItems(NOW)
    expect(created()[0]).toMatchObject({ newLead: true })
  })
})

describe('createLiveReplyItems: anchor dan saringan penutup', () => {
  it('anchor = pesan masuk PERTAMA sesudah balasan terakhir kita', async () => {
    given([conv([inbound('q0', ago(9 * HOUR)), outbound('o1', ago(8 * HOUR)), inbound('q1', ago(6 * HOUR), 'mau tanya'), inbound('q2', ago(3 * HOUR), 'halo kak')])])
    await createLiveReplyItems(NOW)
    expect(created()[0]).toMatchObject({ anchorMessageId: 'q1', anchorAt: ago(6 * HOUR), snippet: 'mau tanya' })
  })

  it('hanya penutup ("ok thanks") dilewati', async () => {
    given([conv([outbound('o1', ago(5 * HOUR)), inbound('m1', ago(4 * HOUR), 'ok thanks')])])
    expect(await createLiveReplyItems(NOW)).toEqual({ created: 0, reopened: 0, skipped: 1 })
    expect(mockPrisma.summaryItem.create).not.toHaveBeenCalled()
  })

  it('reaksi dilewati', async () => {
    given([conv([outbound('o1', ago(5 * HOUR)), inbound('m1', ago(4 * HOUR), '👍', 'reaction')])])
    expect(await createLiveReplyItems(NOW)).toEqual({ created: 0, reopened: 0, skipped: 1 })
  })

  it('penutup sesudah pertanyaan tidak menyembunyikannya: item anchor di pertanyaan', async () => {
    given([conv([outbound('o1', ago(6 * HOUR)), inbound('q1', ago(5 * HOUR), 'pickup jam berapa?'), inbound('m2', ago(4 * HOUR), 'ok thanks 🙏')])])
    expect(await createLiveReplyItems(NOW)).toEqual({ created: 1, reopened: 0, skipped: 0 })
    expect(created()[0]).toMatchObject({ anchorMessageId: 'q1', anchorAt: ago(5 * HOUR), snippet: 'pickup jam berapa?' })
  })

  it('penutup di depan pertanyaan: anchor tetap pesan pertama, snippet = pertanyaannya', async () => {
    given([conv([outbound('o1', ago(6 * HOUR)), inbound('m1', ago(5 * HOUR), 'ok'), inbound('q2', ago(4 * HOUR), 'harga untuk 4 orang?')])])
    await createLiveReplyItems(NOW)
    expect(created()[0]).toMatchObject({ anchorMessageId: 'm1', snippet: 'harga untuk 4 orang?' })
  })

  it('gambar tanpa caption (bukti transfer?) tetap jadi item', async () => {
    given([conv([outbound('o1', ago(6 * HOUR)), inbound('m1', ago(5 * HOUR), null, 'image')])])
    await createLiveReplyItems(NOW)
    expect(created()[0]).toMatchObject({ anchorMessageId: 'm1', snippet: '[image]' })
  })

  it('review terbaru sudah melihat pesan terakhir dan menilai "selesai": dilewati', async () => {
    given([conv([inbound('m1', ago(20 * HOUR), 'Great, see you then!')], { chatReview: review('selesai'), chatReviewAt: ago(15 * HOUR) })])
    expect(await createLiveReplyItems(NOW)).toEqual({ created: 0, reopened: 0, skipped: 1 })
  })

  it('review "selesai" yang lebih tua dari pesan terakhir tidak menahan item', async () => {
    given([conv([inbound('m1', ago(3 * HOUR), 'one more question')], { chatReview: review('selesai'), chatReviewAt: ago(15 * HOUR) })])
    expect((await createLiveReplyItems(NOW)).created).toBe(1)
  })

  it('review terbaru "perlu_tindakan" tidak menahan item', async () => {
    given([conv([inbound('m1', ago(20 * HOUR))], { chatReview: review('perlu_tindakan'), chatReviewAt: ago(15 * HOUR) })])
    expect((await createLiveReplyItems(NOW)).created).toBe(1)
  })
})

describe('createLiveReplyItems: baris yang sudah ada', () => {
  it.each(['OPEN', 'SCHEDULED'])('baris %s dibiarkan untuk reconcile, termasuk FOLLOW_UP/PROMISE', async (state) => {
    for (const kind of ['REPLY', 'FOLLOW_UP', 'PROMISE']) {
      mockReset(mockPrisma)
      given([conv([inbound('m1', ago(2 * HOUR))], { summaryItem: row({ kind, state, closedReason: null, closedAt: null }) })])
      expect(await createLiveReplyItems(NOW)).toEqual({ created: 0, reopened: 0, skipped: 1 })
      expect(mockPrisma.summaryItem.update).not.toHaveBeenCalled()
      expect(mockPrisma.summaryItem.create).not.toHaveBeenCalled()
    }
  })

  it('DONE/REPLIED lalu pelanggan chat lagi: dibuka ulang, penutupan dikosongkan', async () => {
    given([conv([outbound('o1', ago(29 * HOUR)), inbound('m1', ago(3 * HOUR), 'kak?')], { summaryItem: row({ note: 'x', closedById: 'a' }) })])
    expect(await createLiveReplyItems(NOW)).toEqual({ created: 0, reopened: 1, skipped: 0 })
    expect(updated()[0]).toMatchObject({
      kind: 'REPLY', state: 'OPEN', anchorAt: ago(3 * HOUR), anchorMessageId: 'm1', openedOn: '2026-10-19', lastSeenOn: '2026-10-19',
      closedReason: null, closedAt: null, note: null, closedById: null, reminderId: null, dueAt: null,
    })
  })

  it('FOLLOW_UP yang sudah tertutup jadi REPLY saat dibuka ulang', async () => {
    given([conv([inbound('m1', ago(3 * HOUR))], { summaryItem: row({ kind: 'FOLLOW_UP' }) })])
    expect((await createLiveReplyItems(NOW)).reopened).toBe(1)
    expect(updated()[0]).toMatchObject({ kind: 'REPLY', state: 'OPEN' })
  })

  it('DROPPED: pesan yang sama dengan kartu yang dilepas tidak membukanya lagi', async () => {
    given([conv([inbound('m1', ago(30 * HOUR))], { summaryItem: row({ state: 'DROPPED', closedReason: 'DROPPED', anchorAt: ago(30 * HOUR), closedAt: ago(2 * HOUR) }) })])
    expect(await createLiveReplyItems(NOW)).toEqual({ created: 0, reopened: 0, skipped: 1 })
    expect(mockPrisma.summaryItem.update).not.toHaveBeenCalled()
  })

  it('DROPPED: pesan baru sesudah anchor kartu membuka lagi, anchor di pesan baru pertama', async () => {
    const dropped = row({ state: 'DROPPED', closedReason: 'DROPPED', anchorAt: ago(30 * HOUR), closedAt: ago(20 * HOUR) })
    given([conv([inbound('m1', ago(30 * HOUR)), inbound('m2', ago(25 * HOUR), 'any update'), inbound('m3', ago(5 * HOUR), 'hello')], { summaryItem: dropped })])
    expect((await createLiveReplyItems(NOW)).reopened).toBe(1)
    expect(updated()[0]).toMatchObject({ state: 'OPEN', anchorMessageId: 'm2', anchorAt: ago(25 * HOUR), snippet: 'any update' })
  })

  it('DROPPED: yang baru hanya penutup tidak membuka lagi', async () => {
    const dropped = row({ state: 'DROPPED', closedReason: 'DROPPED', anchorAt: ago(30 * HOUR), closedAt: ago(20 * HOUR) })
    given([conv([inbound('m1', ago(30 * HOUR), 'harga?'), inbound('m2', ago(5 * HOUR), 'ok thanks')], { summaryItem: dropped })])
    expect(await createLiveReplyItems(NOW)).toEqual({ created: 0, reopened: 0, skipped: 1 })
  })

  it('DROPPED dibuka pesan baru yang baru 10 menit: tunggu tenggang 1 jam-nya sendiri', async () => {
    const dropped = row({ state: 'DROPPED', closedReason: 'DROPPED', anchorAt: ago(3 * HOUR), closedAt: ago(2 * HOUR) })
    given([conv([inbound('m1', ago(3 * HOUR)), inbound('m2', ago(10 * 60 * 1000), 'any update')], { summaryItem: dropped })])
    expect(await createLiveReplyItems(NOW)).toEqual({ created: 0, reopened: 0, skipped: 1 })
    expect(mockPrisma.summaryItem.update).not.toHaveBeenCalled()
  })

  it('REMINDER_DONE mengikuti aturan anchor baris, sama dengan sync malam', async () => {
    const reminderDone = row({ closedReason: 'REMINDER_DONE', anchorAt: ago(30 * HOUR), closedAt: ago(2 * HOUR) })
    given([conv([inbound('m1', ago(30 * HOUR)), inbound('m2', ago(10 * HOUR), 'kak?')], { summaryItem: reminderDone })])
    expect((await createLiveReplyItems(NOW)).reopened).toBe(1)
    expect(updated()[0]).toMatchObject({ anchorMessageId: 'm2' })
  })

  it('JUDGED_DONE: pesan sebelum closedAt tidak membuka, pesan sesudahnya membuka', async () => {
    const judged = row({ closedReason: 'JUDGED_DONE', anchorAt: ago(30 * HOUR), closedAt: ago(15 * HOUR) })
    given([conv([inbound('m1', ago(30 * HOUR), 'Great, see you then!')], { summaryItem: judged })])
    expect(await createLiveReplyItems(NOW)).toEqual({ created: 0, reopened: 0, skipped: 1 })

    mockReset(mockPrisma)
    given([conv([inbound('m1', ago(30 * HOUR), 'Great, see you then!'), inbound('m2', ago(3 * HOUR), 'oh wait, one question')], { summaryItem: judged })])
    expect((await createLiveReplyItems(NOW)).reopened).toBe(1)
    expect(updated()[0]).toMatchObject({ anchorMessageId: 'm2', state: 'OPEN' })
  })

  it('idempoten: tick berikutnya melihat baris OPEN dan tidak menulis apa pun', async () => {
    given([conv([inbound('m1', ago(2 * HOUR))], { summaryItem: row({ state: 'OPEN', closedReason: null, closedAt: null, anchorAt: ago(2 * HOUR) }) })])
    await createLiveReplyItems(NOW)
    expect(mockPrisma.summaryItem.update).not.toHaveBeenCalled()
    expect(mockPrisma.summaryItem.create).not.toHaveBeenCalled()
  })
})

describe('createLiveReplyItems: tidak pernah melempar', () => {
  it('Settings gagal dibaca', async () => {
    mockPrisma.settings.findUnique.mockRejectedValue(new Error('db down'))
    await expect(createLiveReplyItems(NOW)).resolves.toEqual({ created: 0, reopened: 0, skipped: 0 })
  })

  it('kueri percakapan gagal', async () => {
    mockPrisma.settings.findUnique.mockResolvedValue(null)
    mockPrisma.conversation.findMany.mockRejectedValue(new Error('db down'))
    await expect(createLiveReplyItems(NOW)).resolves.toEqual({ created: 0, reopened: 0, skipped: 0 })
  })

  it('satu tulisan gagal tidak menghentikan percakapan lain', async () => {
    given([conv([inbound('m1', ago(2 * HOUR))], { id: 'c1' }), conv([inbound('m2', ago(2 * HOUR))], { id: 'c2' })])
    mockPrisma.summaryItem.create.mockRejectedValueOnce(new Error('unique')).mockResolvedValueOnce({} as never)
    await expect(createLiveReplyItems(NOW)).resolves.toEqual({ created: 1, reopened: 0, skipped: 0 })
    expect(mockPrisma.summaryItem.create).toHaveBeenCalledTimes(2)
  })
})
