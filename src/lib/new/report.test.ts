import { describe, expect, it } from 'vitest'
import { buildReport, mondayOf, periodRange, type ReportRow } from './report'

// Jam UTC: 2026-11-23T17:30Z = 24 Nov 00:30 WIB.
const row = (o: Omit<Partial<ReportRow>, 'firstIn'> & { id: string; firstIn: string }): ReportRow => ({
  name: o.id.toUpperCase(), phone: '6281234567890', stage: 'new', bookingDate: null, bookingNumber: null,
  pkg: null, startYmd: null, orderChannel: null, kind: null, ...o, firstIn: new Date(o.firstIn),
})

const rows: ReportRow[] = [
  // chat Senin minggu ini, booking 2 hari kemudian -> inquiry + booking
  row({ id: 'a', firstIn: '2026-11-23T02:00:00Z', bookingDate: '25 Nov 2026', bookingNumber: 'JVTO-1', orderChannel: 'JVTO' }),
  // chat minggu ini, belum booking -> inquiry saja
  row({ id: 'b', firstIn: '2026-11-24T05:00:00Z' }),
  // tamu lama: booking sebelum chat pertama -> inquiry, bukan booking dari chat
  row({ id: 'c', firstIn: '2026-11-24T06:00:00Z', bookingDate: '01 Oct 2026' }),
  // chat minggu lalu, booking minggu ini -> booking minggu ini, bukan inquiry minggu ini
  row({ id: 'd', firstIn: '2026-11-18T03:00:00Z', bookingDate: '24 Nov 2026' }),
  // vendor -> tidak dihitung sama sekali
  row({ id: 'e', firstIn: '2026-11-24T07:00:00Z', kind: 'mitra', bookingDate: '24 Nov 2026' }),
  // 23 Nov 00:30 WIB tapi 22 Nov UTC -> tetap masuk minggu ini menurut WIB
  row({ id: 'f', firstIn: '2026-11-22T17:30:00Z' }),
]

describe('laporan inquiry → booking', () => {
  it('menghitung inquiry, konversi kohort, dan booking dari chat', () => {
    const r = buildReport(rows, '2026-11-23', '2026-11-29')
    expect(r.inquiries).toBe(4) // a, b, c, f
    expect(r.inquiriesBooked).toBe(1) // a
    expect(r.bookings.map((b) => b.conversationId).sort()).toEqual(['a', 'd'])
    const a = r.bookings.find((b) => b.conversationId === 'a')!
    expect(a).toMatchObject({ firstChatDay: '2026-11-23', bookingDay: '2026-11-25', daysToBook: 2, bookingNumber: 'JVTO-1', phoneTail: '••• 7890' })
  })

  it('tren 8 minggu berakhir di minggu periode', () => {
    const r = buildReport(rows, '2026-11-23', '2026-11-29')
    expect(r.trend).toHaveLength(8)
    expect(r.trend[7]).toEqual({ from: '2026-11-23', to: '2026-11-29', inquiries: 4, booked: 2 })
    expect(r.trend[6]).toMatchObject({ from: '2026-11-16', inquiries: 1, booked: 0 })
  })

  it('lead belum booking: alasan AI, atau sinyal pesan terakhir bila belum dinilai', () => {
    const extra: ReportRow[] = [
      row({ id: 'g', firstIn: '2026-11-24T02:00:00Z', kind: 'calon_tamu', lastAt: new Date('2026-11-24T03:00:00Z'), lastDir: 'OUTBOUND',
        blocker: { alasan: 'harga', teks: 'Minta di bawah Rp4 jt', rekomendasi: 'Tawarkan 3D2N tanpa hotel' }, reviewAt: new Date('2026-11-24T04:00:00Z') }),
      row({ id: 'h', firstIn: '2026-11-24T05:00:00Z', lastAt: new Date('2026-11-24T05:00:00Z'), lastDir: 'INBOUND', nextStep: 'Kirim harga 2 orang' }),
      // tamu lama yang dinilai tamu_existing -> bukan lead
      row({ id: 'i', firstIn: '2026-11-24T06:00:00Z', kind: 'tamu_existing' }),
    ]
    const r = buildReport([...rows, ...extra], '2026-11-23', '2026-11-29', 8, '2026-11-26')
    const ids = r.leads.map((l) => l.conversationId).sort()
    expect(ids).toEqual(['b', 'f', 'g', 'h']) // a booking, c tamu lama (booking sebelum chat), i tamu_existing
    const g = r.leads.find((l) => l.conversationId === 'g')!
    expect(g).toMatchObject({ alasan: 'harga', alasanText: 'Harga / budget', rekomendasi: 'Tawarkan 3D2N tanpa hotel', sumber: 'ai', lastFrom: 'tim', silentDays: 2 })
    const h = r.leads.find((l) => l.conversationId === 'h')!
    expect(h).toMatchObject({ alasan: 'belum_dijawab', sumber: 'sinyal', rekomendasi: 'Kirim harga 2 orang', lastFrom: 'tamu' })
    // blocker tidak valid (alasan di luar kosakata) tidak dianggap penilaian AI
    expect(r.blockers[0]).toMatchObject({ count: 2 }) // b & f: tanpa pesan terakhir -> lainnya
    expect(r.blockers.reduce((n, b) => n + b.count, 0)).toBe(r.leads.length)
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
