/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('./automated', () => ({ findOurReply: vi.fn() }))

import { prisma } from '@/lib/db'
import { findOurReply } from './automated'
import { closeExcludedItems, exclusionFor, potentialNewBooking, tripEnded } from './exclusion'

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const NOW = new Date('2026-11-25T05:00:00Z') // 12:00 WIB
const conv = (o: { phone?: string | null; isTest?: boolean; end?: string; chatReview?: unknown; chatReviewAt?: Date; platform?: string; mail?: boolean } = {}) => ({
  isTest: o.isTest ?? false,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  bookingCheckedAt: null as Date | null,
  chatReviewAt: o.chatReviewAt ?? null,
  mailAccountId: o.mail ? 'mb1' : null,
  channelIdentityId: o.platform ? 'ci1' : null,
  channelIdentity: o.platform ? { platform: o.platform } : null,
  bookingData: o.end ? { date: { start_ymd: '2026-11-01', end_ymd: o.end } } : null,
  chatReview: o.chatReview ?? null,
  contact: { phone: o.phone === undefined ? '447700900123' : o.phone },
})

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(findOurReply).mockResolvedValue({ id: 'o1', createdAt: new Date('2026-11-20T00:00:00Z') })
  mockPrisma.message.findMany.mockResolvedValue([{ type: 'text', content: 'halo' }] as never)
})

describe('tripEnded / potentialNewBooking', () => {
  it('trip selesai = end_ymd sebelum hari ini WIB', () => {
    expect(tripEnded({ date: { end_ymd: '2026-11-24' } }, '2026-11-25')).toBe(true)
    expect(tripEnded({ date: { end_ymd: '2026-11-25' } }, '2026-11-25')).toBe(false)
    expect(tripEnded(null, '2026-11-25')).toBe(false)
    expect(tripEnded({ date: { end_ymd: 'TBA' } }, '2026-11-25')).toBe(false)
  })
  it('potensi booking baru: calon_tamu atau ada belumBooking', () => {
    expect(potentialNewBooking({ jenisKontak: 'calon_tamu' })).toBe(true)
    expect(potentialNewBooking({ jenisKontak: 'tamu_existing', belumBooking: { alasan: 'harga' } })).toBe(true)
    expect(potentialNewBooking({ jenisKontak: 'tamu_existing' })).toBe(false)
    expect(potentialNewBooking(null)).toBe(false)
  })
})

describe('contentlessRun: revoke membatalkan pesan berisi terakhir', () => {
  it('dokumen lalu dihapus = tanpa isi; teks + dokumen dihapus = masih berisi; revoke saja = tanpa isi', async () => {
    const { contentlessRun } = await import('./exclusion')
    expect(contentlessRun([{ type: 'document', content: null }, { type: 'revoke', content: null }])).toBe(true)
    expect(contentlessRun([{ type: 'text', content: 'halo?' }, { type: 'document', content: null }, { type: 'revoke', content: null }])).toBe(false)
    expect(contentlessRun([{ type: 'revoke', content: null }])).toBe(true)
    expect(contentlessRun([{ type: 'revoke', content: null }, { type: 'text', content: 'halo?' }])).toBe(false)
    expect(contentlessRun([])).toBe(false)
  })
})

describe('exclusionFor', () => {
  it('hanya WhatsApp: Instagram/Messenger/Email keluar; identitas WA atau percakapan lama bernomor tetap masuk', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ platform: 'INSTAGRAM' }) as never)
    expect(await exclusionFor('c', 'REPLY', null, NOW)).toBe('BUKAN_WHATSAPP')
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ platform: 'FACEBOOK' }) as never)
    expect(await exclusionFor('c', 'PROMISE', null, NOW)).toBe('BUKAN_WHATSAPP')
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ mail: true }) as never)
    expect(await exclusionFor('c', 'REPLY', null, NOW)).toBe('BUKAN_WHATSAPP')
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ platform: 'WHATSAPP' }) as never)
    expect(await exclusionFor('c', 'REPLY', null, NOW)).toBeNull()
    mockPrisma.conversation.findUnique.mockResolvedValue(conv() as never)
    expect(await exclusionFor('c', 'REPLY', null, NOW)).toBeNull()
  })

  it('nomor Indonesia keluar untuk semua jenis; percakapan uji (isTest) keluar juga', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ phone: '6281234567890' }) as never)
    expect(await exclusionFor('c', 'REPLY', null, NOW)).toBe('NOMOR_INDONESIA')
    expect(await exclusionFor('c', 'PROMISE', null, NOW)).toBe('NOMOR_INDONESIA')
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ phone: '6281234567890', isTest: true }) as never)
    expect(await exclusionFor('c', 'REPLY', null, NOW)).toBe('PERCAKAPAN_UJI')
  })

  it('tamu lama tanpa booking aktif (sudah dicek) = trip selesai; belum pernah dicek = tetap masuk', async () => {
    const past = { ...conv({ chatReview: { jenisKontak: 'tamu_existing', status: 'perlu_tindakan' } }), bookingCheckedAt: NOW }
    mockPrisma.conversation.findUnique.mockResolvedValue(past as never)
    expect(await exclusionFor('c', 'PROMISE', null, NOW)).toBe('TRIP_SELESAI')
    expect(await exclusionFor('c', 'FOLLOW_UP', null, NOW)).toBe('TRIP_SELESAI')
    mockPrisma.conversation.findUnique.mockResolvedValue({ ...past, bookingCheckedAt: null } as never)
    expect(await exclusionFor('c', 'PROMISE', null, NOW)).toBeNull()
  })

  it('lead yang memilih operator lain keluar dari Follow Up dan Janji; Balas tetap', async () => {
    mockPrisma.message.findMany.mockResolvedValue([{ type: 'text', content: 'halo?', createdAt: new Date('2026-11-25T01:00:00Z') }] as never)
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ chatReview: { jenisKontak: 'calon_tamu', status: 'perlu_tindakan', belumBooking: { alasan: 'pilih_lain' } } }) as never)
    expect(await exclusionFor('c', 'PROMISE', null, NOW)).toBe('PILIH_OPERATOR_LAIN')
    expect(await exclusionFor('c', 'FOLLOW_UP', null, NOW)).toBe('PILIH_OPERATOR_LAIN')
    expect(await exclusionFor('c', 'REPLY', null, NOW)).toBeNull()
  })

  it('tahun tanggal trip dari AI dibetulkan: tidak pernah sebelum percakapan dimulai', async () => {
    const { tripEndDay } = await import('./exclusion')
    const chatAt = new Date('2026-11-22T03:00:00Z')
    expect(tripEndDay({ tanggalTripSelesai: '2025-12-24' }, chatAt)).toBe('2026-12-24') // Villeval
    expect(tripEndDay({ tanggalTripSelesai: '2024-11-24' }, chatAt)).toBe('2026-11-24')
    expect(tripEndDay({ tanggalTripSelesai: '2026-12-24' }, chatAt)).toBe('2026-12-24')
    // tahun yang sama dipercaya: tanggal sebelum chat dimulai memang sudah lewat (Pro Tech)
    expect(tripEndDay({ tanggalTripSelesai: '2026-11-13' }, new Date('2026-11-17T03:00:00Z'))).toBe('2026-11-13')
    expect(tripEndDay({ tanggalTripSelesai: '2025-03-10' }, chatAt)).toBe('2027-03-10')
    expect(tripEndDay({ tanggalTripSelesai: null }, chatAt)).toBeNull()
    mockPrisma.conversation.findUnique.mockResolvedValue({ ...conv({ chatReview: { jenisKontak: 'calon_tamu', status: 'perlu_tindakan', tanggalTripSelesai: '2025-12-24' } }), createdAt: chatAt } as never)
    expect(await exclusionFor('c', 'PROMISE', null, NOW)).toBeNull()
  })

  it('lead tanpa booking yang tanggal trip mintaannya sudah lewat keluar dari Follow Up/Janji; yang belum lewat atau ber-booking tetap', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ chatReview: { jenisKontak: 'calon_tamu', status: 'perlu_tindakan', tanggalTripSelesai: '2026-10-12' } }) as never)
    expect(await exclusionFor('c', 'PROMISE', null, NOW)).toBe('TANGGAL_TRIP_LEWAT')
    expect(await exclusionFor('c', 'FOLLOW_UP', null, NOW)).toBe('TANGGAL_TRIP_LEWAT')
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ chatReview: { jenisKontak: 'calon_tamu', status: 'perlu_tindakan', tanggalTripSelesai: '2026-12-24' } }) as never)
    expect(await exclusionFor('c', 'PROMISE', null, NOW)).toBeNull()
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ end: '2026-12-30', chatReview: { jenisKontak: 'tamu_existing', status: 'perlu_tindakan', tanggalTripSelesai: '2026-10-12' } }) as never)
    expect(await exclusionFor('c', 'PROMISE', null, NOW)).toBeNull()
  })

  it('Janji Admin yang AI nilai percakapannya selesai keluar', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ chatReview: { jenisKontak: 'calon_tamu', status: 'selesai' } }) as never)
    expect(await exclusionFor('c', 'PROMISE', null, NOW)).toBe('PERCAKAPAN_SELESAI')
  })

  it('pesan tanpa isi: reaksi, stiker, dihapus, edit, unsupported, lampiran IG; foto/dokumen/teks tetap isi', async () => {
    const { isNonContent } = await import('./exclusion')
    for (const t of ['reaction', 'sticker', 'revoke', 'edit', 'unsupported', 'system']) expect(isNonContent({ type: t, content: null })).toBe(true)
    for (const c of ['[Lampiran: story_mention]', '[Lampiran: ig_post]', '[Lampiran: unsupported_type]']) expect(isNonContent({ type: 'text', content: c })).toBe(true)
    for (const t of ['image', 'document', 'audio', 'video', 'location', 'contacts']) expect(isNonContent({ type: t, content: null })).toBe(false)
    expect(isNonContent({ type: 'text', content: 'can pay cash?' })).toBe(false)
    mockPrisma.conversation.findUnique.mockResolvedValue(conv() as never)
    mockPrisma.message.findMany.mockResolvedValue([{ type: 'revoke', content: null }, { type: 'text', content: '[Lampiran: story_mention]' }] as never)
    expect(await exclusionFor('c', 'REPLY', null, NOW)).toBe('HANYA_REAKSI')
    mockPrisma.message.findMany.mockResolvedValue([{ type: 'image', content: null }] as never)
    expect(await exclusionFor('c', 'REPLY', null, NOW)).toBeNull()
  })

  it('Belum dibalas yang rangkaiannya hanya reaksi keluar; ada teks = tetap masuk', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(conv() as never)
    mockPrisma.message.findMany.mockResolvedValue([{ type: 'reaction', content: null }, { type: 'reaction', content: null }] as never)
    expect(await exclusionFor('c', 'REPLY', null, NOW)).toBe('HANYA_REAKSI')
    expect(mockPrisma.message.findMany.mock.calls[0][0]).toMatchObject({ where: { direction: 'INBOUND', createdAt: { gt: new Date('2026-11-20T00:00:00Z') } } })
    mockPrisma.message.findMany.mockResolvedValue([{ type: 'reaction', content: null }, { type: 'text', content: 'halo?' }] as never)
    expect(await exclusionFor('c', 'REPLY', null, NOW)).toBeNull()
  })

  it('Follow Up / Janji untuk trip yang sudah selesai keluar, kecuali potensi booking baru; trip belum jalan tetap masuk', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ end: '2026-11-20', chatReview: { jenisKontak: 'tamu_existing' } }) as never)
    expect(await exclusionFor('c', 'PROMISE', null, NOW)).toBe('TRIP_SELESAI')
    expect(await exclusionFor('c', 'FOLLOW_UP', null, NOW)).toBe('TRIP_SELESAI')
    // Balas tidak terkena aturan trip selesai
    expect(await exclusionFor('c', 'REPLY', null, NOW)).toBeNull()
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ end: '2026-11-20', chatReview: { jenisKontak: 'calon_tamu' } }) as never)
    expect(await exclusionFor('c', 'PROMISE', null, NOW)).toBeNull()
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ end: '2026-11-30' }) as never)
    expect(await exclusionFor('c', 'PROMISE', null, NOW)).toBeNull()
  })
})

describe('perluBalas dari ringkasan AI', () => {
  const last = new Date('2026-11-25T03:00:00Z')
  it('REPLY keluar bila ringkasan SESUDAH pesan terakhir menilai perluBalas false; sebelum pesan itu / tanpa nilai = tetap masuk', async () => {
    mockPrisma.message.findMany.mockResolvedValue([{ type: 'text', content: 'Correct', createdAt: last }] as never)
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ chatReview: { perluBalas: false }, chatReviewAt: new Date('2026-11-25T03:01:00Z') }) as never)
    expect(await exclusionFor('c', 'REPLY', null, NOW)).toBe('TIDAK_PERLU_BALAS')
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ chatReview: { perluBalas: false }, chatReviewAt: new Date('2026-11-25T02:59:00Z') }) as never)
    expect(await exclusionFor('c', 'REPLY', null, NOW)).toBeNull()
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ chatReview: { perluBalas: true }, chatReviewAt: new Date('2026-11-25T03:01:00Z') }) as never)
    expect(await exclusionFor('c', 'REPLY', null, NOW)).toBeNull()
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ chatReview: { status: 'selesai' }, chatReviewAt: new Date('2026-11-25T03:01:00Z') }) as never)
    expect(await exclusionFor('c', 'REPLY', null, NOW)).toBeNull()
  })
})

describe('janji menunggu tamu', () => {
  it('permintaan jawaban: tanda tanya atau kalimat konfirmasi; kabar proses bukan', async () => {
    const { ASKS_GUEST } = await import('./exclusion')
    for (const t of ['Just to confirm, you are looking for private transportation.', 'Please let me know your flight.', 'Mohon konfirmasi jumlah orang.', 'Nanti kabari ya', 'berapa orang?'])
      expect(ASKS_GUEST.test(t), t).toBe(true)
    for (const t of ['Refund sedang kami proses.', 'Noted, we will send the invoice tomorrow.'])
      expect(ASKS_GUEST.test(t), t).toBe(false)
    const { asksGuest } = await import('./exclusion')
    expect(asksGuest('Here is our package https://javavolcano-touroperator.com/tours?utm_source=wa')).toBe(false)
    expect(asksGuest('See https://x.com/a?b=1 — how many people?')).toBe(true)
  })

  it('pertanyaan agen sesudah janji + tamu belum menjawab = menunggu tamu; dijawab atau tanpa pertanyaan = bukan', async () => {
    const { promiseAwaitingGuest } = await import('./exclusion')
    const q = { id: 'q1', createdAt: new Date('2026-09-23T00:00:00Z'), content: 'Just to confirm…?', type: 'text', direction: 'OUTBOUND', sentBy: 'AGENT' }
    mockPrisma.message.findFirst.mockResolvedValueOnce(q as never).mockResolvedValueOnce(null)
    expect(await promiseAwaitingGuest('c', new Date('2026-09-22T16:00:00Z'))).toEqual(q)
    // gte: pesan janji itu sendiri boleh jadi pertanyaan ke tamu
    expect(mockPrisma.message.findFirst.mock.calls[0][0]).toMatchObject({ where: { direction: 'OUTBOUND', sentBy: 'AGENT', createdAt: { gte: new Date('2026-09-22T16:00:00Z') } }, orderBy: { createdAt: 'desc' } })
    mockPrisma.message.findFirst.mockResolvedValueOnce(q as never).mockResolvedValueOnce({ id: 'jawab' } as never)
    expect(await promiseAwaitingGuest('c', new Date('2026-09-22T16:00:00Z'))).toBeNull()
    mockPrisma.message.findFirst.mockResolvedValueOnce(null)
    expect(await promiseAwaitingGuest('c', new Date('2026-09-22T16:00:00Z'))).toBeNull()
  })
})

describe('lebih selektif: bukan tamu, mitra, percakapan selesai, utang tim', () => {
  it('teamOwed: janji belum ditepati atau alasan belum_dijawab/menunggu_tim; tamu_diam = bukan utang tim', async () => {
    const { teamOwed } = await import('./exclusion')
    expect(teamOwed({ janjiTim: [{ teks: 'Kirim harga', terpenuhi: false }] })).toBe('Kirim harga')
    expect(teamOwed({ janjiTim: [{ teks: 'Kirim harga', terpenuhi: true }], belumBooking: { alasan: 'belum_dijawab', teks: 'Jemput Banyuwangi belum dijawab' } })).toBe('Jemput Banyuwangi belum dijawab')
    expect(teamOwed({ belumBooking: { alasan: 'tamu_diam', teks: 'x' } })).toBeNull()
    expect(teamOwed(null)).toBeNull()
  })

  it('lainnya keluar dari semua jenis; mitra hanya keluar dari Follow Up; Follow Up yang AI nilai selesai keluar', async () => {
    mockPrisma.message.findMany.mockResolvedValue([{ type: 'text', content: 'halo', createdAt: new Date('2026-11-25T01:00:00Z') }] as never)
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ chatReview: { jenisKontak: 'lainnya' } }) as never)
    expect(await exclusionFor('c', 'REPLY', null, NOW)).toBe('BUKAN_TAMU')
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ chatReview: { jenisKontak: 'mitra' } }) as never)
    expect(await exclusionFor('c', 'FOLLOW_UP', null, NOW)).toBe('MITRA_BUKAN_FOLLOW_UP')
    expect(await exclusionFor('c', 'REPLY', null, NOW)).toBeNull()
    expect(await exclusionFor('c', 'PROMISE', null, NOW)).toBeNull()
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ chatReview: { jenisKontak: 'calon_tamu', status: 'selesai' } }) as never)
    expect(await exclusionFor('c', 'FOLLOW_UP', null, NOW)).toBe('PERCAKAPAN_SELESAI')
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ chatReview: { jenisKontak: 'calon_tamu', status: 'perlu_tindakan' } }) as never)
    expect(await exclusionFor('c', 'FOLLOW_UP', null, NOW)).toBeNull()
  })

  it('Follow Up yang utang tim pindah ke Janji (bertanda), lalu kembali bila utangnya beres', async () => {
    mockPrisma.summaryItem.findMany.mockResolvedValue([{ id: 'f1', conversationId: 'c', kind: 'FOLLOW_UP', review: null, anchorAt: NOW, note: null }] as never)
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ chatReview: { jenisKontak: 'calon_tamu', status: 'perlu_tindakan', belumBooking: { alasan: 'menunggu_tim', teks: 'Itinerary belum dikirim' } } }) as never)
    mockPrisma.message.findFirst.mockResolvedValue(null) // tidak ada pesan agen yang meminta jawaban
    await closeExcludedItems(NOW)
    expect(mockPrisma.summaryItem.update.mock.calls[0][0]).toEqual({ where: { id: 'f1' }, data: { kind: 'PROMISE', snippet: 'Itinerary belum dikirim', note: 'Pindahan Follow Up: tim masih berutang' } })

    mockPrisma.summaryItem.update.mockClear()
    mockPrisma.summaryItem.findMany.mockResolvedValue([{ id: 'f1', conversationId: 'c', kind: 'PROMISE', review: null, anchorAt: NOW, note: 'Pindahan Follow Up: tim masih berutang' }] as never)
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ chatReview: { jenisKontak: 'calon_tamu', status: 'perlu_tindakan', belumBooking: { alasan: 'tamu_diam', teks: 'x' } } }) as never)
    await closeExcludedItems(NOW)
    expect(mockPrisma.summaryItem.update.mock.calls[0][0]).toEqual({ where: { id: 'f1' }, data: { kind: 'FOLLOW_UP', note: null } })
  })

  it('utang tim tetapi pesan agen terakhir meminta jawaban tamu: tetap Follow Up', async () => {
    const { followUpOwedByTeam } = await import('./exclusion')
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ chatReview: { belumBooking: { alasan: 'menunggu_tim', teks: 'x' } } }) as never)
    mockPrisma.message.findFirst.mockResolvedValueOnce({ id: 'q', createdAt: NOW, content: 'Just to confirm the dates?', type: 'text', direction: 'OUTBOUND', sentBy: 'AGENT' } as never).mockResolvedValueOnce(null)
    expect(await followUpOwedByTeam('c')).toBeNull()
  })
})

describe('closeExcludedItems', () => {
  it('menutup item OPEN yang kena aturan dengan NOT_QUEUED + alasan; yang lain tidak disentuh', async () => {
    mockPrisma.summaryItem.findMany.mockResolvedValue([
      { id: 'i1', conversationId: 'indo', kind: 'REPLY', review: null, anchorAt: NOW, note: null },
      { id: 'i2', conversationId: 'ok', kind: 'REPLY', review: null, anchorAt: NOW, note: null },
    ] as never)
    mockPrisma.conversation.findUnique.mockImplementation((async (a: { where: { id: string } }) =>
      a.where.id === 'indo' ? conv({ phone: '6281234567890' }) : conv()) as never)
    mockPrisma.summaryItem.updateMany.mockResolvedValue({ count: 1 })

    expect(await closeExcludedItems(NOW)).toBe(1)
    expect(mockPrisma.summaryItem.findMany.mock.calls[0][0]).toMatchObject({ where: { state: 'OPEN' } })
    expect(mockPrisma.summaryItem.updateMany).toHaveBeenCalledTimes(1)
    expect(mockPrisma.summaryItem.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'i1', state: 'OPEN' },
      data: { state: 'DONE', closedReason: 'NOT_QUEUED', note: 'Nomor Indonesia', closedAt: NOW },
    })
  })
})
