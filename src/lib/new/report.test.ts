import { describe, expect, it } from 'vitest'
import { buildReport, mondayOf, periodRange, type ReportRow } from './report'

// Jam UTC: 2026-11-23T17:30Z = 24 Nov 00:30 WIB.
const row = (o: Omit<Partial<ReportRow>, 'firstIn'> & { id: string; firstIn: string }): ReportRow => ({
  name: o.id.toUpperCase(), phone: '447712347890', stage: 'new', bookingDate: null, bookingNumber: null,
  pkg: null, startYmd: null, orderChannel: null, kind: null, ...o, firstIn: new Date(o.firstIn),
})

const rows: ReportRow[] = [
  // chat Senin minggu ini, booking 2 hari kemudian -> inquiry + booking
  row({ id: 'a', firstIn: '2026-11-23T02:00:00Z', bookingDate: '25 Nov 2026', bookingNumber: 'JVTO-1', orderChannel: 'JVTO' }),
  // chat minggu ini, belum booking -> inquiry saja
  row({ id: 'b', firstIn: '2026-11-24T05:00:00Z' }),
  // tamu lama: booking sebelum chat pertama -> bukan inquiry (AL-01), bukan booking dari chat
  row({ id: 'c', firstIn: '2026-11-24T06:00:00Z', bookingDate: '01 Oct 2026' }),
  // chat minggu lalu, booking minggu ini -> booking minggu ini, bukan inquiry minggu ini
  row({ id: 'd', firstIn: '2026-11-18T03:00:00Z', bookingDate: '24 Nov 2026' }),
  // vendor -> tidak dihitung sama sekali
  row({ id: 'e', firstIn: '2026-11-24T07:00:00Z', kind: 'mitra', bookingDate: '24 Nov 2026' }),
  // 23 Nov 00:30 WIB tapi 22 Nov UTC -> tetap masuk minggu ini menurut WIB
  row({ id: 'f', firstIn: '2026-11-22T17:30:00Z' }),
]

describe('laporan: hanya nomor luar negeri', () => {
  it('nomor Indonesia (62…) tidak dihitung sebagai inquiry, booking, lead, maupun tren', () => {
    const id = [
      row({ id: 'id1', phone: '6281234567890', firstIn: '2026-11-24T02:00:00Z', bookingDate: '25 Nov 2026' }),
      row({ id: 'id2', phone: '6285700001111', firstIn: '2026-11-24T03:00:00Z' }),
    ]
    const base = buildReport(rows, '2026-11-23', '2026-11-29')
    const r = buildReport([...rows, ...id], '2026-11-23', '2026-11-29')
    expect(r.inquiries).toBe(base.inquiries)
    expect(r.inquiriesBooked).toBe(base.inquiriesBooked)
    expect(r.bookings.map((b) => b.conversationId)).not.toContain('id1')
    expect(r.leads.map((l) => l.conversationId)).not.toContain('id2')
    expect(r.trend.at(-1)).toEqual(base.trend.at(-1))
  })
})

describe('laporan inquiry → booking', () => {
  it('menghitung inquiry, konversi kohort, dan booking dari chat', () => {
    const r = buildReport(rows, '2026-11-23', '2026-11-29')
    expect(r.inquiries).toBe(3) // a, b, f (c sudah jadi tamu sebelum chat)
    expect(r.inquiriesBooked).toBe(1) // a
    expect(r.bookings.map((b) => b.conversationId).sort()).toEqual(['a', 'd'])
    const a = r.bookings.find((b) => b.conversationId === 'a')!
    expect(a).toMatchObject({ firstChatDay: '2026-11-23', bookingDay: '2026-11-25', daysToBook: 2, bookingNumber: 'JVTO-1', phoneTail: '••• 7890' })
  })

  it('tren 8 minggu berakhir di minggu periode', () => {
    const r = buildReport(rows, '2026-11-23', '2026-11-29')
    expect(r.trend).toHaveLength(8)
    expect(r.trend[7]).toEqual({ from: '2026-11-23', to: '2026-11-29', inquiries: 3, booked: 2 })
    expect(r.trend[6]).toMatchObject({ from: '2026-11-16', inquiries: 1, booked: 0 })
  })

  it('lead belum booking: alasan AI, atau sinyal pesan terakhir bila belum dinilai', () => {
    const extra: ReportRow[] = [
      row({ id: 'g', firstIn: '2026-11-24T02:00:00Z', kind: 'calon_tamu', lastAt: new Date('2026-11-24T03:00:00Z'), lastDir: 'OUTBOUND',
        blocker: { alasan: 'harga', teks: 'Minta di bawah Rp4 jt', rekomendasi: 'Tawarkan 3D2N tanpa hotel' }, reviewAt: new Date('2026-11-24T04:00:00Z') }),
      // pesan terakhir dari tamu TANPA item Balas terbuka (mis. "nanti saya kabari") -> bukan "belum dijawab" (AL-05)
      row({ id: 'h', firstIn: '2026-11-24T05:00:00Z', lastAt: new Date('2026-11-24T05:00:00Z'), lastDir: 'INBOUND', nextStep: 'Kirim harga 2 orang' }),
      row({ id: 'h2', firstIn: '2026-11-24T05:10:00Z', lastAt: new Date('2026-11-24T05:10:00Z'), lastDir: 'INBOUND', awaitingReply: true }),
      // tamu lama yang dinilai tamu_existing -> bukan lead
      row({ id: 'i', firstIn: '2026-11-24T06:00:00Z', kind: 'tamu_existing' }),
    ]
    const r = buildReport([...rows, ...extra], '2026-11-23', '2026-11-29', 8, '2026-11-26')
    const ids = r.leads.map((l) => l.conversationId).sort()
    expect(ids).toEqual(['b', 'f', 'g', 'h', 'h2']) // a booking, c tamu lama (booking sebelum chat), i tamu_existing
    const g = r.leads.find((l) => l.conversationId === 'g')!
    expect(g).toMatchObject({ alasan: 'harga', alasanText: 'Harga / budget', rekomendasi: 'Tawarkan 3D2N tanpa hotel', sumber: 'ai', lastFrom: 'tim', silentDays: 2 })
    const h = r.leads.find((l) => l.conversationId === 'h')!
    expect(h).toMatchObject({ alasan: 'lainnya', sumber: 'sinyal', rekomendasi: 'Kirim harga 2 orang', lastFrom: 'tamu', waitingUs: false })
    expect(r.leads.find((l) => l.conversationId === 'h2')).toMatchObject({ alasan: 'belum_dijawab', waitingUs: true, rekomendasi: 'Balas pesan tamu.' })
    // yang menunggu balasan kita paling atas
    expect(r.leads[0].conversationId).toBe('h2')
    expect(r.blockers[0]).toMatchObject({ alasan: 'lainnya', count: 3 }) // b, f, h
    expect(r.blockers.reduce((n, b) => n + b.count, 0)).toBe(r.leads.length)
  })

  it('AL-01/AL-02: tamu lama tanpa booking dan booking Klook bukan inquiry maupun booking dari WA', () => {
    const extra: ReportRow[] = [
      row({ id: 'old', firstIn: '2026-11-24T02:00:00Z', kind: 'tamu_existing' }),
      row({ id: 'klook', firstIn: '2026-11-24T03:00:00Z', bookingDate: '24 Nov 2026', orderChannel: 'KLOOK', kind: 'tamu_existing' }),
    ]
    const base = buildReport(rows, '2026-11-23', '2026-11-29')
    const r = buildReport([...rows, ...extra], '2026-11-23', '2026-11-29')
    expect(r.inquiries).toBe(base.inquiries)
    expect(r.inquiriesBooked).toBe(base.inquiriesBooked)
    expect(r.bookings.map((b) => b.conversationId)).not.toContain('klook')
    expect(r.leads.map((l) => l.conversationId)).not.toContain('old')
    expect(r.trend.at(-1)).toEqual(base.trend.at(-1))
  })

  it('AL-03: lead yang tanggal trip-nya lewat = kelompok terakhir; lostByUs bila giliran ada di tim', () => {
    const r = buildReport([
      row({ id: 'lewat', firstIn: '2026-11-10T02:00:00Z', leadTripDay: '2026-11-20', blocker: { alasan: 'menunggu_tim', teks: 'Link DP belum dikirim', rekomendasi: 'Kirim link DP' } }),
      row({ id: 'lewat2', firstIn: '2026-11-10T03:00:00Z', leadTripDay: '2026-11-21', blocker: { alasan: 'harga', teks: 'Mahal', rekomendasi: 'Tawarkan 2D1N' } }),
      row({ id: 'nanti', firstIn: '2026-11-09T02:00:00Z', leadTripDay: '2026-12-20', blocker: { alasan: 'menunggu_tim', teks: 'Harga belum dikirim', rekomendasi: 'Kirim harga' } }),
    ], '2026-11-01', '2026-11-25', 8, '2026-11-25')
    expect(r.leads.map((l) => [l.conversationId, l.tripPassed, l.lostByUs])).toEqual([['nanti', false, false], ['lewat', true, true], ['lewat2', true, false]])
    // tetap dihitung di alasan
    expect(r.blockers).toEqual([{ alasan: 'menunggu_tim', label: 'Menunggu info yang dijanjikan tim', count: 2 }, { alasan: 'harga', label: 'Harga / budget', count: 1 }])
  })

  it('AL-04: alasan diselaraskan dengan penilaian AI lain (open trip, giliran tamu)', () => {
    const at = (h: number) => new Date(Date.UTC(2026, 10, 24, h))
    const r = buildReport([
      row({ id: 'ot', firstIn: '2026-11-24T01:00:00Z', profile: [{ label: 'open_trip', messageId: 'm1' }], blocker: { alasan: 'paket_tidak_cocok', teks: 'Mau open trip', rekomendasi: '' } }),
      row({ id: 'tg', firstIn: '2026-11-24T01:00:00Z', lastAt: at(3), awaitingGuest: true, reviewAt: at(4), blocker: { alasan: 'belum_dijawab', teks: 'Tamu belum memberi tanggal', rekomendasi: '' } }),
      // review lebih tua dari pesan terakhir: menungguTamu tidak berlaku
      row({ id: 'basi', firstIn: '2026-11-24T01:00:00Z', lastAt: at(5), awaitingGuest: true, reviewAt: at(4), blocker: { alasan: 'belum_dijawab', teks: 'Tanya harga', rekomendasi: '' } }),
    ], '2026-11-23', '2026-11-29')
    const by = (id: string) => r.leads.find((l) => l.conversationId === id)!.alasan
    expect([by('ot'), by('tg'), by('basi')]).toEqual(['pilih_lain', 'tamu_diam', 'belum_dijawab'])
  })

  it('periode dan Senin', () => {
    expect(mondayOf('2026-11-24')).toBe('2026-11-23')
    expect(mondayOf('2026-11-29')).toBe('2026-11-23')
    expect(periodRange('minggu-ini', '2026-11-24')).toEqual({ from: '2026-11-23', to: '2026-11-24' })
    expect(periodRange('minggu-lalu', '2026-11-24')).toEqual({ from: '2026-11-16', to: '2026-11-22' })
    expect(periodRange('bulan-ini', '2026-11-24')).toEqual({ from: '2026-11-01', to: '2026-11-24' })
    expect(periodRange('bulan-lalu', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
  })
})
