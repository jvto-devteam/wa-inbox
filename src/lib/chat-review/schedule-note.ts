import { callLLM } from '@/lib/bot/llm'
import { REVIEW_TIMEOUT_MS } from '@/lib/daily-summary/config'
import { normalizePoint, type ConversationReview, type PointKind, type ScheduleNote } from '@/lib/daily-summary/payload-schema'
import type { BookingData } from '@/lib/booking/client'
import { redactText } from '@/lib/summaries/digest'
import { isNoiseForCrew, isUnsafeForCrew, scrubMoney } from './crew-note'

/**
 * "Note untuk Schedule" (owner 2026-11-12/13): poin PENDEK dari chat tamu yang belum punya tempat di Schedule, supaya
 * ops tidak perlu membaca chat. Contoh: "Tamu vegan", "1 orang penerbangan beda (QZ321)", "Perlu internet stabil, rapat
 * online 3 Nov WITA". Dibuat sesudah ringkasan chat disimpan (`refresh.ts`) dan disimpan di `chatReview.catatanSchedule`.
 *
 * Aturan utamanya: JANGAN mengulang yang sudah ada di Schedule. Empat lapis:
 * 1. `scheduleNoteCandidates` (kode): hanya poin jenis kebutuhan, keputusan, trip; topik yang punya field sendiri
 *    (jemput/antar, hotel, kamar, tanggal, kaos), urusan uang/batal, dan kalimat tak berinformasi dibuang SEBELUM LLM.
 * 2. LLM hanya meringkas kandidat itu menjadi poin pendek, dan diberi data booking supaya bisa membuang yang mengulangnya.
 * 3. `parseScheduleNote` (kode) menyaring KELUARAN lagi dengan aturan topik yang sama, nama titik/hotel/paket di booking,
 *    nominal, telepon, dan email.
 * Tidak pernah melempar: gagal = null, dan pemanggil mempertahankan note sebelumnya.
 */

const INCLUDED_KINDS: ReadonlySet<PointKind> = new Set<PointKind>(['kebutuhan', 'keputusan', 'trip'])

/** Topik yang sudah punya tempat di Schedule (kolom jemput, antar, hotel + tipe kamar, tanggal, kaos). */
const FIELD_TOPIC_RE =
  /\b(?:jemput|menjemput|pick-?up|antar|mengantar|drop-?off|drop|bandara|airport|stasiun|station|terminal|hotel|penginapan|menginap|homestay|villa|resort|kamar|room|rooms|twin|double|kasur|bed|beds|titik|tanggal|jadwal|kaos|t-?shirt|ukuran)\b/i

/** Urusan admin (uang, batal, kompensasi) dan sentimen (review, pujian): tidak untuk note ops. */
const ADMIN_TOPIC_RE = /\b(?:batal|dibatalkan|pembatalan|cancel|cancelled|kredit|credit|kompensasi|voucher|refund|review|ulasan|pujian|positif|puas|kecewa)\b/i

/** Perubahan jumlah rombongan ("jadi 3 pax") = tugas admin, bukan note; "vegetarian 1 pax" tetap boleh. */
const HEADCOUNT_CHANGE_RE =
  /\b\d+\s*(?:pax|orang|people|guests?)\b.*\b(?:jadi|menjadi|berubah|ganti|tambah|kurang|reduce|add)\b|\b(?:jadi|menjadi|berubah|ganti|tambah|kurang|reduce|add)\b.*\b\d+\s*(?:pax|orang|people|guests?)\b/i

/** Kata pembuka nama hotel yang terlalu umum untuk dipakai sebagai penanda. */
const GENERIC_NAME_WORD = new Set(['hotel', 'bromo', 'ijen', 'surabaya', 'bali', 'resort', 'villa', 'cabin', 'homestay', 'mount', 'grand', 'bondowoso', 'banyuwangi', 'airport', 'station', 'terminal'])

export const SCHEDULE_NOTE_MAX_LINES = 5
const MAX_CANDIDATES = 8
const MAX_LINE = 80

function words(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

/** Penanda nama di booking: dua kata pertama titik/hotel ("manis ae") dan kata pertama khas hotel ("riverside"). */
function nameKeys(booking: BookingData): string[] {
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const points = [text(booking.pickup?.meeting_point), text(booking.pickup?.meeting_point_value), text(booking.dropoff?.drop_point), text(booking.dropoff?.drop_point_value)]
  const hotels = (booking.hotels ?? []).map((h) => text(h.hotel))
  const keys = [...points, ...hotels].filter((v): v is string => v !== null).map((v) => words(v).slice(0, 2).join(' '))
  for (const h of hotels) {
    const first = h ? words(h)[0] : undefined
    if (first && first.length >= 5 && !GENERIC_NAME_WORD.has(first)) keys.push(first)
  }
  return keys.filter((k) => k.length >= 5)
}

/** Kalimat tak berinformasi bagi ops: pertanyaan produk yang sudah dijawab dan hal yang tidak diketahui. */
const SALES_QA_RE = /\b(?:privat|private|sharing|gabung|bergabung|suhu|cuaca)\b/i

/** Kandidat untuk LLM: dari poin penting ringkasan, setelah saringan kode. Murni. */
export function scheduleNoteCandidates(review: Pick<ConversationReview, 'poinPenting'>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const point of review.poinPenting) {
    const { teks, jenis } = normalizePoint(point)
    if (!jenis || !INCLUDED_KINDS.has(jenis)) continue
    const clean = scrubMoney(teks).replace(/\s+/g, ' ').trim()
    if (!clean || isUnsafeForCrew(clean) || isNoiseForCrew(clean)) continue
    if (FIELD_TOPIC_RE.test(clean) || ADMIN_TOPIC_RE.test(clean) || HEADCOUNT_CHANGE_RE.test(clean) || SALES_QA_RE.test(clean)) continue
    if (seen.has(clean.toLowerCase())) continue
    seen.add(clean.toLowerCase())
    out.push(clean)
    if (out.length >= MAX_CANDIDATES) break
  }
  return out
}

export const SCHEDULE_NOTE_SYSTEM_PROMPT = `Kamu menulis note singkat untuk tim operasional Java Volcano Tour Operator tentang satu booking, dari hal yang dikatakan tamu di chat.

Masukan: JSON berisi "booking" (data booking yang SUDAH tercatat di Schedule) dan "kandidat" (kalimat dari ringkasan chat).

Tulis POIN PENTING saja: kebutuhan khusus, permintaan, atau kondisi tamu yang perlu diketahui ops. Satu poin = satu hal, sangat singkat (maks. 10 kata), tanpa kalimat penuh, tanpa "tim menjawab/menyarankan", tanpa alasan panjang.

Contoh (kandidat -> poin):
- "Satu orang peserta adalah vegetarian." -> "1 orang vegetarian"
- "Kedua tamu vegan; tim menjamin opsi vegan untuk makan yang termasuk." -> "2 tamu vegan"
- "Tamu meminta kepastian AC mobil dingin." -> "Minta AC mobil dingin"
- "Satu orang teman tiba dengan penerbangan berbeda (QZ321), dua orang lainnya tetap dengan SQ." -> "1 orang penerbangan beda (QZ321)"
- "Tamu membutuhkan internet stabil untuk rapat online pada 3 Nov pukul 15:00 waktu Bali; tim menyarankan kafe." -> "Perlu internet stabil, rapat online 3 Nov 15:00 WITA"

BUANG (jangan ditulis sama sekali):
- Yang sudah ada di data "booking": tanggal, jumlah pax, paket, rute, titik jemput/antar, hotel.
- Tipe kamar, jemput/antar, hotel, uang, refund, pembatalan.
- Pertanyaan produk yang sudah dijawab (privat atau gabung, suhu, perlengkapan), kekhawatiran umum, review atau pujian, dan jawaban tim.
- Tebakan: tulis hanya yang tertulis di kandidat.

Maksimal ${SCHEDULE_NOTE_MAX_LINES} poin. Bila tidak ada yang layak, kembalikan daftar kosong.
Keluaran HANYA JSON, tanpa teks lain: {"baris": ["...", "..."]}`

export function buildScheduleNotePrompt(candidates: string[], bookingContext: string | null): string {
  return `Masukan (JSON):\n${JSON.stringify({ booking: bookingContext ?? '', kandidat: candidates })}`
}

function stripCodeFence(raw: string): string {
  return raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '')
}

/** Keluaran LLM -> note. Setiap baris disaring ulang oleh kode, apa pun yang diminta prompt. Null bila bentuknya salah. */
export function parseScheduleNote(raw: string, booking: BookingData | null | undefined, contactName: string | null, at: Date): ScheduleNote | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFence(raw))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const list = (parsed as { baris?: unknown }).baris
  if (!Array.isArray(list)) return null
  const keys = booking ? nameKeys(booking) : []
  const lines: string[] = []
  const seen = new Set<string>()
  for (const item of list) {
    if (typeof item !== 'string') continue
    const text = redactText(scrubMoney(item), contactName).replace(/\[tamu\]/g, 'tamu').replace(/\s+/g, ' ').replace(/[.;]+$/, '').trim()
    if (!text || isUnsafeForCrew(text) || isNoiseForCrew(text)) continue
    if (FIELD_TOPIC_RE.test(text) || ADMIN_TOPIC_RE.test(text) || HEADCOUNT_CHANGE_RE.test(text)) continue
    const lower = text.toLowerCase()
    if (keys.some((k) => lower.includes(k))) continue
    if (seen.has(lower)) continue
    seen.add(lower)
    lines.push(text.length > MAX_LINE ? `${text.slice(0, MAX_LINE - 1)}…` : text)
    if (lines.length >= SCHEDULE_NOTE_MAX_LINES) break
  }
  return { baris: lines, diperbaruiAt: at.toISOString() }
}

/**
 * Membuat note dari review. Tanpa kandidat = note kosong tanpa memanggil LLM. Null bila LLM gagal/keluarannya tidak
 * sah (pemanggil mempertahankan note sebelumnya).
 */
export async function generateScheduleNote(args: {
  review: Pick<ConversationReview, 'poinPenting'>
  booking: BookingData | null | undefined
  bookingContext: string | null
  contactName: string | null
  model: string | undefined
  at: Date
}): Promise<ScheduleNote | null> {
  const { review, booking, bookingContext, contactName, model, at } = args
  try {
    const candidates = scheduleNoteCandidates(review)
    if (candidates.length === 0) return { baris: [], diperbaruiAt: at.toISOString() }
    const raw = await callLLM(buildScheduleNotePrompt(candidates, bookingContext), { system: SCHEDULE_NOTE_SYSTEM_PROMPT, model, timeoutMs: REVIEW_TIMEOUT_MS })
    const note = parseScheduleNote(raw, booking, contactName, at)
    if (!note) console.error('generateScheduleNote: keluaran LLM tidak sesuai bentuk')
    return note
  } catch (error) {
    console.error('generateScheduleNote gagal', { error: error instanceof Error ? error.message : 'unknown' })
    return null
  }
}
