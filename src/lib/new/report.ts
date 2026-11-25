// Laporan inquiry WhatsApp → booking (menu Laporan di /new), DATA ASLI. Logika murni di sini;
// kueri ada di src/app/api/new/report/route.ts.
//
// Aturan lengkapnya di docs/aturan-antrean.md, bagian Laporan (AL-xx):
// - Inquiry   = percakapan WhatsApp (bukan sandbox) dari nomor LUAR NEGERI yang pesan MASUK pertamanya
//               jatuh di periode. Nomor Indonesia (62…) tidak dihitung (keputusan owner 2026-11-25).
//               Kontak yang dinilai ringkasan sebagai mitra/lainnya (vendor, crew, hotel) dibuang.
//               AL-01: orang yang SUDAH jadi tamu bukan inquiry (booking sebelum chat, booking Klook, atau
//               tamu lama tanpa booking aktif).
// - Booking   = percakapan WhatsApp yang bookingData-nya bertanggal booking (booking_date) SAMA
//               ATAU SESUDAH hari chat pertama: awalnya chat, lalu booking. Tamu yang sudah booking
//               sebelum pertama kali chat tidak dihitung. AL-02: booking Klook tidak lahir dari chat WA.
import { jakartaDay, parseBookingDay } from '@/lib/bot/eval/replay-pairs'
import { LEAD_BLOCKERS, LEAD_BLOCKER_TEXT, leadBlockerSchema, type LeadBlocker } from '@/lib/daily-summary/payload-schema'
import { isIndonesianNumber } from '@/lib/phone'

export { LEAD_BLOCKER_TEXT, type LeadBlocker }

export interface ReportRow {
  id: string
  /** Kontak percakapan; dipakai tombol Ingatkan (reminder kontak). */
  contactId?: string | null
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
  /** chatReview.belumBooking mentah (JSON); divalidasi di sini. */
  blocker?: unknown
  nextStep?: string | null
  reviewAt?: Date | null
  lastAt?: Date | null
  lastDir?: 'INBOUND' | 'OUTBOUND' | null
  /** Hari mulai (tanpa itu: selesai) trip mintaan menurut ringkasan chat, tahunnya sudah dibetulkan. */
  leadTripDay?: string | null
  /** chatReview.profil mentah; label `open_trip` dipakai AL-04. */
  profile?: unknown
  /** chatReview.menungguTamu mentah: giliran ada di tamu (berlaku bila review tidak lebih tua dari pesan terakhir). */
  awaitingGuest?: unknown
  /** Ada item Balas terbuka di Antrean (AL-05): sumber "menunggu balasan kita". */
  awaitingReply?: boolean
}

/** Calon tamu dari inquiry periode ini yang belum booking, dengan alasan dan rekomendasi follow-up. */
export interface ReportLead {
  conversationId: string
  contactId: string | null
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
  /** AL-05: ada item Balas terbuka di Antrean. */
  waitingUs: boolean
  /** AL-03: tanggal trip mintaan sudah lewat; tidak ada lagi yang bisa ditindaklanjuti. */
  tripPassed: boolean
  /** AL-03: trip lewat sementara giliran ada di tim (belum dijawab / info dijanjikan belum dikirim). */
  lostByUs: boolean
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
  /** booking lahir dari chat: tanggal booking ≥ hari chat pertama, dan bukan booking Klook (AL-02) */
  fromChat: boolean
  /** AL-01: sudah jadi tamu sebelum/di luar chat ini, jadi bukan inquiry */
  alreadyGuest: boolean
}

/** AL-02: booking Klook dibuat di Klook, bukan hasil chat WhatsApp kita. */
const isKlook = (channel: string | null) => (channel ?? '').trim().toUpperCase() === 'KLOOK'

function classify(rows: ReportRow[]): Classified[] {
  return rows
    .filter((r) => !isIndonesianNumber(r.phone) && !(r.kind && NON_CUSTOMER.has(r.kind)))
    .map((row) => {
      const firstDay = jakartaDay(row.firstIn)
      const bookingDay = parseBookingDay(row.bookingDate)
      const fromChat = !!bookingDay && bookingDay >= firstDay && !isKlook(row.orderChannel)
      const alreadyGuest = bookingDay ? !fromChat : row.kind === 'tamu_existing'
      return { row, firstDay, bookingDay, fromChat, alreadyGuest }
    })
}

/** AL-04: label profil `open_trip` dari ringkasan chat. */
function seeksOpenTrip(profile: unknown): boolean {
  return Array.isArray(profile) && profile.some((p) => (p as { label?: unknown } | null)?.label === 'open_trip')
}

/** Penilaian `menungguTamu` hanya berlaku bila ringkasan sudah membaca pesan terakhir. */
function guestsTurn(r: ReportRow): boolean {
  return r.awaitingGuest === true && !!r.reviewAt && (!r.lastAt || r.reviewAt >= r.lastAt)
}

function phoneTail(p: string | null): string {
  const d = (p || '').replace(/\D/g, '')
  return d ? '••• ' + d.slice(-4) : '—'
}

function toLead(c: Classified, today: string): ReportLead {
  const lead = blockerOf(c, today)
  const owed = lead.alasan === 'belum_dijawab' || lead.alasan === 'menunggu_tim'
  return { ...lead, lostByUs: lead.tripPassed && owed }
}

function blockerOf(c: Classified, today: string): Omit<ReportLead, 'lostByUs'> {
  const r = c.row
  const lastDay = r.lastAt ? jakartaDay(r.lastAt) : null
  const lastFrom = r.lastDir === 'INBOUND' ? 'tamu' : r.lastDir === 'OUTBOUND' ? 'tim' : null
  const waitingUs = r.awaitingReply === true
  const base = {
    conversationId: r.id,
    contactId: r.contactId ?? null,
    name: r.name || '(tanpa nama)',
    phoneTail: phoneTail(r.phone),
    firstChatDay: c.firstDay,
    lastDay,
    lastFrom,
    silentDays: lastDay ? dayDiff(lastDay, today) : null,
    reviewDay: r.reviewAt ? jakartaDay(r.reviewAt) : null,
    waitingUs,
    tripPassed: !!r.leadTripDay && r.leadTripDay < today,
  } as const
  const parsed = leadBlockerSchema.safeParse(r.blocker)
  if (parsed.success) {
    // AL-04: alasan diselaraskan dengan penilaian AI lain di ringkasan yang sama.
    let alasan = parsed.data.alasan
    if (seeksOpenTrip(r.profile)) alasan = 'pilih_lain'
    else if ((alasan === 'belum_dijawab' || alasan === 'menunggu_tim') && guestsTurn(r)) alasan = 'tamu_diam'
    return {
      ...base,
      alasan,
      alasanText: LEAD_BLOCKER_TEXT[alasan],
      teks: parsed.data.teks,
      rekomendasi: parsed.data.rekomendasi || r.nextStep || '',
      sumber: 'ai',
    }
  }
  // Belum dinilai AI (ringkasan lama/belum ada): hanya fakta, tanpa menebak alasan lain. "Belum dijawab" hanya bila
  // Antrean memegang item Balas terbuka (AL-05), bukan sekadar pesan terakhir dari tamu.
  const alasan: LeadBlocker = waitingUs ? 'belum_dijawab' : lastFrom === 'tim' ? 'tamu_diam' : 'lainnya'
  return {
    ...base,
    alasan,
    alasanText: LEAD_BLOCKER_TEXT[alasan],
    teks: waitingUs ? 'Pesan terakhir dari tamu belum dibalas tim.' : lastFrom === 'tim' ? 'Tamu belum membalas sejak pesan terakhir tim.' : 'Belum ada ringkasan chat.',
    rekomendasi: r.nextStep || (waitingUs ? 'Balas pesan tamu.' : 'Tanyakan rencana tanggal dan jumlah orang.'),
    sumber: 'sinyal',
  }
}

/** `from`/`to` inklusif, YYYY-MM-DD WIB. `today` untuk menghitung lama diam. */
export function buildReport(rows: ReportRow[], from: string, to: string, trendWeeks = 8, today: string = to): Report {
  const C = classify(rows)
  const inRange = (d: string | null) => !!d && d >= from && d <= to
  const inquiry = (c: Classified) => !c.alreadyGuest
  const cohort = C.filter((c) => inquiry(c) && inRange(c.firstDay))
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

  // Lead = inquiry periode ini yang belum booking (tamu lama sudah dibuang AL-01). Urutan: menunggu balasan kita,
  // lalu yang masih bisa dikejar, lalu yang tanggal trip-nya sudah lewat (AL-03); di dalamnya yang terbaru dulu.
  const group = (l: ReportLead) => (l.tripPassed ? 2 : l.waitingUs ? 0 : 1)
  const leads = cohort
    .filter((c) => !c.bookingDay)
    .map((c) => toLead(c, today))
    .sort((a, b) => group(a) - group(b) || (b.lastDay || '').localeCompare(a.lastDay || '') || a.name.localeCompare(b.name))
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
      inquiries: C.filter((c) => inquiry(c) && c.firstDay >= wf && c.firstDay <= wt).length,
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
