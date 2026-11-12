import { normalizePoint, type ConversationReview, type PointKind } from '@/lib/daily-summary/payload-schema'
import type { BookingData } from '@/lib/booking/client'
import { isNoiseForCrew, isUnsafeForCrew, scrubMoney } from './crew-note'

/**
 * "Note untuk Schedule" (owner 2026-11-12): poin dari chat tamu yang belum punya tempat di Schedule, supaya ops tidak
 * perlu membaca chat. Disusun murni lewat kode dari `poinPenting` ringkasan chat (TANPA panggilan LLM baru) dan dihitung
 * saat dibaca (`at` = waktu ringkasan chat yang dipakai), jadi selalu sesuai data booking terbaru. Tidak ditulis ke mana pun.
 *
 * Aturan utamanya: JANGAN mengulang yang sudah ada di Schedule. Tiga lapis:
 * 1. Jenis poin: hanya kebutuhan, keputusan, trip. Jemput/antar, lokasi, bayar, komplain tidak pernah ikut.
 * 2. Topik yang punya field sendiri di Schedule (jemput, antar, hotel, tanggal, pax, kaos) dibuang walau jenisnya lolos.
 * 3. Baris yang kata pentingnya sudah ada di data booking (titik, nama hotel, paket) atau di note admin dibuang.
 * Plus saringan uang/kontak yang sama dengan catatan crew.
 */

const INCLUDED_KINDS: ReadonlySet<PointKind> = new Set<PointKind>(['kebutuhan', 'keputusan', 'trip'])

/** Topik yang sudah punya tempat di Schedule: baris yang menyebutnya tidak masuk note. */
const FIELD_TOPIC_RE =
  /\b(?:jemput|menjemput|pick-?up|antar|mengantar|drop-?off|drop|bandara|airport|stasiun|station|terminal|hotel|penginapan|menginap|homestay|villa|resort|tanggal|jadwal|kaos|t-?shirt|ukuran)\b/i

/** Perubahan jumlah rombongan ("jadi 3 pax", "reduce to 4 pax") = tugas admin, bukan note; "vegetarian 1 pax" tetap boleh. */
const HEADCOUNT_CHANGE_RE = /\b\d+\s*(?:pax|orang|people|guests?)\b.*\b(?:jadi|menjadi|berubah|ganti|tambah|kurang|reduce|add)\b|\b(?:jadi|menjadi|berubah|ganti|tambah|kurang|reduce|add)\b.*\b\d+\s*(?:pax|orang|people|guests?)\b/i

/** Kata pembuka nama hotel yang terlalu umum untuk dipakai sebagai penanda. */
const GENERIC_NAME_WORD = new Set(['hotel', 'bromo', 'ijen', 'surabaya', 'bali', 'resort', 'villa', 'cabin', 'homestay', 'mount', 'grand', 'bondowoso', 'banyuwangi', 'airport', 'station', 'terminal'])

const STOP = new Set(['dan', 'yang', 'untuk', 'dari', 'ke', 'di', 'ada', 'the', 'and', 'tamu', 'minta', 'ingin', 'mau', 'jam', 'pada', 'dengan'])

export const SCHEDULE_NOTE_MAX_LINES = 5
const MAX_LINE = 160

export type ScheduleNote = { baris: string[]; diperbaruiAt: string }

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => !STOP.has(t) && (t.length >= 3 || /\d/.test(t)))
}

/** Nilai di data booking yang tidak boleh diulang di note: titik jemput/antar, nama hotel, nama paket. */
function knownValues(booking: BookingData): string[] {
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const hotelNames = (booking.hotels ?? []).map((h) => text(h.hotel))
  return [
    text(booking.pickup?.meeting_point),
    text(booking.pickup?.meeting_point_value),
    text(booking.dropoff?.drop_point),
    text(booking.dropoff?.drop_point_value),
    text(booking.package),
    ...hotelNames,
  ].filter((v): v is string => v !== null)
}

/** Note admin yang sudah ada di Schedule (`notes` dari booking-overview), bila API-nya membawa. */
function adminNoteOf(booking: BookingData): string {
  const raw = booking.notes
  return typeof raw === 'string' ? raw : ''
}

/** Penanda nama: dua kata pertama ("manis ae") dan, untuk hotel, kata pertama yang khas ("riverside", "artha"). */
function nameKeys(values: string[], hotels: string[]): string[] {
  const words = (v: string) => v.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const keys = values.map((v) => words(v).slice(0, 2).join(' '))
  for (const h of hotels) {
    const first = words(h)[0]
    if (first && first.length >= 5 && !GENERIC_NAME_WORD.has(first)) keys.push(first)
  }
  return keys.filter((k) => k.length >= 5)
}

function overlaps(line: string, known: Set<string>): boolean {
  const t = tokens(line)
  return t.length > 0 && t.every((x) => known.has(x))
}

export function buildScheduleNote(
  review: Pick<ConversationReview, 'poinPenting'>,
  booking: BookingData | null | undefined,
  at: Date,
): ScheduleNote | null {
  // Tanpa booking tidak ada Schedule yang dituju, dan tidak ada data pembanding untuk mencegah dobel.
  if (!booking || typeof booking !== 'object') return null
  const hotelNames = (booking.hotels ?? []).map((h) => (typeof h.hotel === 'string' ? h.hotel.trim() : '')).filter(Boolean)
  const values = knownValues(booking)
  const knownTokens = new Set([...values.flatMap(tokens), ...tokens(adminNoteOf(booking))])
  const packageName = typeof booking.package === 'string' ? booking.package.trim() : ''
  const knownNames = [...values.map((v) => v.toLowerCase()).filter((v) => v.length >= 4), ...nameKeys(values.filter((v) => v !== packageName), hotelNames)]
  const admin = adminNoteOf(booking).toLowerCase()

  const lines: string[] = []
  const seen = new Set<string>()
  for (const point of review.poinPenting) {
    const { teks, jenis } = normalizePoint(point)
    if (!jenis || !INCLUDED_KINDS.has(jenis)) continue
    const clean = scrubMoney(teks).replace(/\s+/g, ' ').trim()
    if (!clean || isUnsafeForCrew(clean) || isNoiseForCrew(clean)) continue
    if (FIELD_TOPIC_RE.test(clean) || HEADCOUNT_CHANGE_RE.test(clean)) continue
    const lower = clean.toLowerCase()
    if (knownNames.some((n) => lower.includes(n))) continue
    if (overlaps(clean, knownTokens)) continue
    if (admin && admin.includes(lower)) continue
    const line = clean.length > MAX_LINE ? `${clean.slice(0, MAX_LINE - 1)}…` : clean
    if (seen.has(line.toLowerCase())) continue
    seen.add(line.toLowerCase())
    lines.push(line)
    if (lines.length >= SCHEDULE_NOTE_MAX_LINES) break
  }
  return lines.length > 0 ? { baris: lines, diperbaruiAt: at.toISOString() } : null
}
