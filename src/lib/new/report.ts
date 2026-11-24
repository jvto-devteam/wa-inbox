// Laporan inquiry WhatsApp → booking (menu Laporan di /new). Seperti halaman /new lain, memakai
// DATA CONTOH (reportRows di mock-data.ts); logika murni di sini supaya bisa diuji dan nanti
// dipakai ulang saat disambung ke data asli.
//
// Definisi (ditampilkan juga di halaman supaya angka bisa dibaca dengan benar):
// - Inquiry   = percakapan WhatsApp (bukan sandbox) yang pesan MASUK pertamanya jatuh di periode.
//               Kontak yang dinilai ringkasan sebagai mitra/lainnya (vendor, crew, hotel) dibuang.
// - Booking   = percakapan WhatsApp yang bookingData-nya bertanggal booking (booking_date) SAMA
//               ATAU SESUDAH hari chat pertama: awalnya chat, lalu booking. Tamu yang sudah booking
//               sebelum pertama kali chat tidak dihitung.
import { jakartaDay, parseBookingDay } from '@/lib/bot/eval/replay-pairs'

/** Kenapa calon tamu belum booking (kosakata tetap; urutan = urutan tampil). */
export const LEAD_BLOCKERS = [
  'harga', 'belum_pasti', 'diskusi_rombongan', 'belum_dijawab', 'menunggu_tim', 'tamu_diam',
  'paket_tidak_cocok', 'pilih_lain', 'kendala_bayar', 'hanya_tanya', 'lainnya',
] as const
export type LeadBlocker = (typeof LEAD_BLOCKERS)[number]
export const LEAD_BLOCKER_TEXT: Record<LeadBlocker, string> = {
  harga: 'Harga / budget',
  belum_pasti: 'Tanggal atau rencana belum pasti',
  diskusi_rombongan: 'Menunggu keputusan rombongan',
  belum_dijawab: 'Pertanyaan tamu belum dijawab tuntas',
  menunggu_tim: 'Menunggu info yang dijanjikan tim',
  tamu_diam: 'Tamu diam setelah penawaran',
  paket_tidak_cocok: 'Paket/rute tidak cocok',
  pilih_lain: 'Memilih operator lain / open trip',
  kendala_bayar: 'Kendala pembayaran',
  hanya_tanya: 'Sekadar cari info',
  lainnya: 'Lainnya',
}
export interface LeadBlockerNote {
  alasan: LeadBlocker
  teks: string
  /** satu langkah follow-up untuk tim (internal, tidak dikirim) */
  rekomendasi: string
}

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
  /** penilaian AI kenapa belum booking; tidak ada = belum dinilai */
  blocker?: LeadBlockerNote | null
  nextStep?: string | null
  reviewAt?: Date | null
  lastAt?: Date | null
  lastDir?: 'INBOUND' | 'OUTBOUND' | null
}

/** Calon tamu dari inquiry periode ini yang belum booking, dengan alasan dan rekomendasi follow-up. */
export interface ReportLead {
  conversationId: string
  name: string
  phoneTail: string
  firstChatDay: string
  lastDay: string | null
  /** pesan terakhir dari tamu (menunggu kita) atau dari tim (menunggu tamu) */
  lastFrom: 'tamu' | 'tim' | null
  silentDays: number | null
  alasan: LeadBlocker
  alasanText: string
  teks: string
  rekomendasi: string
  /** ai = dinilai ringkasan chat; sinyal = belum dinilai AI, disimpulkan dari pesan terakhir */
  sumber: 'ai' | 'sinyal'
  reviewDay: string | null
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
  leads: ReportLead[]
  /** Jumlah lead per alasan, urut terbanyak; hanya alasan yang muncul. */
  blockers: { alasan: LeadBlocker; label: string; count: number }[]
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

function toLead(c: Classified, today: string): ReportLead {
  const r = c.row
  const lastDay = r.lastAt ? jakartaDay(r.lastAt) : null
  const lastFrom = r.lastDir === 'INBOUND' ? 'tamu' : r.lastDir === 'OUTBOUND' ? 'tim' : null
  const base = {
    conversationId: r.id,
    name: r.name || '(tanpa nama)',
    phoneTail: phoneTail(r.phone),
    firstChatDay: c.firstDay,
    lastDay,
    lastFrom,
    silentDays: lastDay ? dayDiff(lastDay, today) : null,
    reviewDay: r.reviewAt ? jakartaDay(r.reviewAt) : null,
  } as const
  if (r.blocker) {
    return {
      ...base,
      alasan: r.blocker.alasan,
      alasanText: LEAD_BLOCKER_TEXT[r.blocker.alasan],
      teks: r.blocker.teks,
      rekomendasi: r.blocker.rekomendasi || r.nextStep || '',
      sumber: 'ai',
    }
  }
  // Belum dinilai AI (ringkasan lama/belum ada): hanya fakta dari pesan terakhir, tanpa menebak alasan lain.
  const alasan: LeadBlocker = lastFrom === 'tamu' ? 'belum_dijawab' : lastFrom === 'tim' ? 'tamu_diam' : 'lainnya'
  return {
    ...base,
    alasan,
    alasanText: LEAD_BLOCKER_TEXT[alasan],
    teks: lastFrom === 'tamu' ? 'Pesan terakhir dari tamu belum dibalas tim.' : lastFrom === 'tim' ? 'Tamu belum membalas sejak pesan terakhir tim.' : 'Belum ada ringkasan chat.',
    rekomendasi: r.nextStep || (lastFrom === 'tamu' ? 'Balas pesan tamu.' : 'Follow-up: tanyakan rencana tanggal dan jumlah orang.'),
    sumber: 'sinyal',
  }
}

/** `from`/`to` inklusif, YYYY-MM-DD WIB. `today` untuk menghitung lama diam. */
export function buildReport(rows: ReportRow[], from: string, to: string, trendWeeks = 8, today: string = to): Report {
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

  // Lead = inquiry periode ini yang belum booking dan bukan tamu lama (booking sebelum chat / dinilai tamu_existing).
  const leads = cohort
    .filter((c) => !c.fromChat && !c.bookingDay && c.row.kind !== 'tamu_existing')
    .map((c) => toLead(c, today))
    .sort((a, b) => (b.lastDay || '').localeCompare(a.lastDay || '') || a.name.localeCompare(b.name))
  const counts = new Map<LeadBlocker, number>()
  for (const l of leads) counts.set(l.alasan, (counts.get(l.alasan) || 0) + 1)
  const blockers = LEAD_BLOCKERS.filter((k) => counts.has(k))
    .map((k) => ({ alasan: k, label: LEAD_BLOCKER_TEXT[k], count: counts.get(k)! }))
    .sort((a, b) => b.count - a.count)

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
    leads,
    blockers,
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
