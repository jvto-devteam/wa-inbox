// Laporan inquiry WhatsApp → booking (menu Laporan di /new). Satu-satunya halaman /new yang
// membaca DATA ASLI. Logika murni di sini; kueri ada di src/app/api/new/report/route.ts.
//
// Definisi (ditampilkan juga di halaman supaya angka bisa dibaca dengan benar):
// - Inquiry   = percakapan WhatsApp (bukan sandbox) yang pesan MASUK pertamanya jatuh di periode.
//               Kontak yang dinilai ringkasan sebagai mitra/lainnya (vendor, crew, hotel) dibuang.
// - Booking   = percakapan WhatsApp yang bookingData-nya bertanggal booking (booking_date) SAMA
//               ATAU SESUDAH hari chat pertama: awalnya chat, lalu booking. Tamu yang sudah booking
//               sebelum pertama kali chat tidak dihitung.
// Batas data: bookingData hanya menyimpan booking terbaru per nomor, dan hanya untuk percakapan
// yang sudah dicek ke API booking (tick 5 menit menyegarkan bertahap).
import { jakartaDay, parseBookingDay } from '@/lib/bot/eval/replay-pairs'

export interface ReportRow {
  id: string
  name: string | null
  phone: string | null
  stage: string
  firstIn: Date
  bookingDate: string | null
  bookingNumber: string | null
  pkg: string | null
  startYmd: string | null
  orderChannel: string | null
  kind: string | null
}

export interface ReportBooking {
  conversationId: string
  name: string
  phoneTail: string
  firstChatDay: string
  bookingDay: string
  daysToBook: number
  bookingNumber: string
  pkg: string
  startYmd: string
  orderChannel: string
  stage: string
}

export interface WeekPoint {
  from: string
  to: string
  inquiries: number
  booked: number
}

export interface Report {
  from: string
  to: string
  inquiries: number
  /** Inquiry periode ini yang (sampai hari ini) sudah booking. */
  inquiriesBooked: number
  /** Booking (tanggal booking di periode ini) dari customer yang awalnya chat WhatsApp. */
  bookings: ReportBooking[]
  trend: WeekPoint[]
}

const NON_CUSTOMER = new Set(['mitra', 'lainnya'])

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5)
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Senin minggu berjalan (WIB) untuk hari `ymd`. */
export function mondayOf(ymd: string): string {
  const dow = new Date(ymd + 'T00:00:00Z').getUTCDay() // 0 = Minggu
  return addDays(ymd, -((dow + 6) % 7))
}

interface Classified {
  row: ReportRow
  firstDay: string
  bookingDay: string | null
  /** booking lahir dari chat: tanggal booking ≥ hari chat pertama */
  fromChat: boolean
}

function classify(rows: ReportRow[]): Classified[] {
  return rows
    .filter((r) => !(r.kind && NON_CUSTOMER.has(r.kind)))
    .map((row) => {
      const firstDay = jakartaDay(row.firstIn)
      const bookingDay = parseBookingDay(row.bookingDate)
      return { row, firstDay, bookingDay, fromChat: !!bookingDay && bookingDay >= firstDay }
    })
}

function phoneTail(p: string | null): string {
  const d = (p || '').replace(/\D/g, '')
  return d ? '••• ' + d.slice(-4) : '—'
}

/** `from`/`to` inklusif, YYYY-MM-DD WIB. */
export function buildReport(rows: ReportRow[], from: string, to: string, trendWeeks = 8): Report {
  const C = classify(rows)
  const inRange = (d: string | null) => !!d && d >= from && d <= to
  const cohort = C.filter((c) => inRange(c.firstDay))
  const bookings = C.filter((c) => c.fromChat && inRange(c.bookingDay))
    .map((c): ReportBooking => ({
      conversationId: c.row.id,
      name: c.row.name || '(tanpa nama)',
      phoneTail: phoneTail(c.row.phone),
      firstChatDay: c.firstDay,
      bookingDay: c.bookingDay!,
      daysToBook: dayDiff(c.firstDay, c.bookingDay!),
      bookingNumber: c.row.bookingNumber || '—',
      pkg: c.row.pkg || '—',
      startYmd: c.row.startYmd || '—',
      orderChannel: c.row.orderChannel || '—',
      stage: c.row.stage,
    }))
    .sort((a, b) => b.bookingDay.localeCompare(a.bookingDay) || a.name.localeCompare(b.name))

  const lastMon = mondayOf(to)
  const trend: WeekPoint[] = []
  for (let i = trendWeeks - 1; i >= 0; i--) {
    const wf = addDays(lastMon, -7 * i)
    const wt = addDays(wf, 6)
    trend.push({
      from: wf,
      to: wt,
      inquiries: C.filter((c) => c.firstDay >= wf && c.firstDay <= wt).length,
      booked: C.filter((c) => c.fromChat && c.bookingDay! >= wf && c.bookingDay! <= wt).length,
    })
  }

  return {
    from,
    to,
    inquiries: cohort.length,
    inquiriesBooked: cohort.filter((c) => c.fromChat).length,
    bookings,
    trend,
  }
}

export type PeriodKey = 'minggu-ini' | 'minggu-lalu' | 'bulan-ini' | 'bulan-lalu'

export function periodRange(k: PeriodKey, today: string): { from: string; to: string } {
  if (k === 'minggu-ini') return { from: mondayOf(today), to: today }
  if (k === 'minggu-lalu') { const m = addDays(mondayOf(today), -7); return { from: m, to: addDays(m, 6) } }
  const [y, mo] = today.split('-').map(Number)
  if (k === 'bulan-ini') return { from: `${y}-${String(mo).padStart(2, '0')}-01`, to: today }
  const py = mo === 1 ? y - 1 : y
  const pm = mo === 1 ? 12 : mo - 1
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate()
  return { from: `${py}-${String(pm).padStart(2, '0')}-01`, to: `${py}-${String(pm).padStart(2, '0')}-${last}` }
}
