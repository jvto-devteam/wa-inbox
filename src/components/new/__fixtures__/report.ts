// Fixture test: laporan /api/new/report tiruan, dibangun dengan buildReport yang sama dengan server.
import { vi } from 'vitest'
import { jakartaDay } from '@/lib/bot/eval/replay-pairs'
import { addDays, buildReport, mondayOf, type Report, type ReportRow } from '@/lib/new/report'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const bookingDate = (ymd: string) => { const [y, m, d] = ymd.split('-'); return d + ' ' + MON[+m - 1] + ' ' + y }
const at = (ymd: string, h: number) => new Date(Date.parse(ymd + 'T' + String(h).padStart(2, '0') + ':00:00+07:00'))

export function sampleReport(today = jakartaDay(new Date())): Report {
  const mon = mondayOf(today)
  const row = (id: string, chatDay: string, o: Partial<ReportRow> = {}): ReportRow => ({
    id, name: 'Tamu ' + id, phone: '4477009001' + id.length, stage: 'new', firstIn: at(chatDay, 9), bookingDate: null, bookingNumber: null,
    pkg: null, startYmd: null, orderChannel: null, kind: 'calon_tamu', ...o,
  })
  const rows: ReportRow[] = [
    row('a', today, { bookingDate: bookingDate(today), bookingNumber: 'JVTO-1', pkg: '3D Bromo · Ijen', startYmd: addDays(today, 20), orderChannel: 'JVTO' }),
    row('b', today, { lastAt: at(today, 10), lastDir: 'OUTBOUND', blocker: { alasan: 'harga', teks: 'Minta di bawah Rp4 jt', rekomendasi: 'Tawarkan 3D2N' } }),
    row('c', today, { lastAt: at(today, 11), lastDir: 'INBOUND', blocker: { alasan: 'belum_dijawab', teks: 'Tanya jemput Banyuwangi', rekomendasi: 'Jawab soal jemput' } }),
  ]
  for (let w = 1; w <= 7; w++) rows.push(row('p' + w, addDays(mon, -7 * w)), row('q' + w, addDays(mon, -7 * w), { bookingDate: bookingDate(addDays(mon, -7 * w)) }))
  return buildReport(rows, mon, today, 8, today)
}

/** Stub fetch: /api/new/report menjawab sampleReport; route lain 404. */
export function stubReportFetch(report: Report = sampleReport()) {
  const fn = vi.fn(async (input: string) => {
    const path = new URL(input, 'http://x').pathname
    if (path === '/api/new/report') return { ok: true, status: 200, json: async () => report } as Response
    return { ok: false, status: 404, json: async () => ({ error: 'tidak ada' }) } as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
