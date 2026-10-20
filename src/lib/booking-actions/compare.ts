/**
 * Pembanding murni: fakta aktif dari chat vs `bookingData`. Tanpa DB/jaringan/LLM.
 *
 * Jam kosong dari backoffice: `pickup_time`/`drop_time` dibentuk `date('H:i', strtotime(null))`,
 * jadi booking tanpa jam asli membawa jam palsu. Pembanding tidak boleh memperingatkan jam
 * bila sisi booking tidak punya jam asli (Review Focus #2).
 */
import type { BookingData } from '@/lib/booking/client'
import { normalizeFieldValue, readBookingField, type FieldKey } from './fields'

/**
 * Jam palsu dari `date('H:i', strtotime(null))`. Sumber: kueri baca-saja produksi 2026-10-20
 * (booking tanpa meeting_point ber-pickup_time 07:00; drop_time '07:00' nilai paling sering, 66x)
 * + `config/app.php` new-backoffice bertimezone `Asia/Jakarta`. Akibatnya jemput 07:00 sungguhan
 * tak terbedakan dan diperlakukan "tidak diketahui" (Ruling R2).
 */
export const FAKE_EMPTY_TIME = '07:00'

export type ActiveFact = { id: string; field: FieldKey; value: string }
export type Mismatch = { field: FieldKey; chatValue: string; bookingValue: string | null; factId: string }

const TIME_FIELDS: readonly FieldKey[] = ['pickup_time', 'drop_time']
const COMPACT_FIELDS: readonly FieldKey[] = ['pickup_arrival', 'drop_arrival']

export function bookingTimeKnown(raw: string | undefined | null): boolean {
  if (typeof raw !== 'string') return false
  const t = raw.trim()
  return t !== '' && t !== FAKE_EMPTY_TIME
}

/** Ukuran kaos dibandingkan dalam bentuk kanonik (`canonicalTshirtSizes` lewat `normalizeFieldValue`): urutan bebas. */
function comparable(field: FieldKey, raw: string): string {
  const value = normalizeFieldValue(field, raw) ?? raw.trim()
  const low = value.toLowerCase()
  // Nomor penerbangan/tiket: spasi tidak bermakna. Lainnya: rapatkan spasi ganda.
  return COMPACT_FIELDS.includes(field) ? low.replace(/\s+/g, '') : low.replace(/\s+/g, ' ')
}

/**
 * Nilai booking untuk dibandingkan, atau `undefined` bila field ini tak bisa dibandingkan.
 * `forMismatch`: jam yang tidak diketahui (null/''/'07:00', R2) tidak boleh memunculkan PERINGATAN, jadi
 * dilewati. Untuk "sudah diterapkan?" nilai mentah yang dinormalisasi yang dipakai: usulan '07:00' pada booking
 * berjam '07:00' memang sudah sama -- tanpa ini kartu jam 07:00 tidak pernah tertutup dan Setujui berulang.
 */
function comparableBookingValue(field: FieldKey, booking: BookingData, forMismatch: boolean): string | null | undefined {
  if (field === 'note') return undefined
  const value = readBookingField(booking, field)
  if (forMismatch && TIME_FIELDS.includes(field) && !bookingTimeKnown(value)) return undefined
  return value
}

/** Hotel: cocok bila sama dengan SALAH SATU nama di `hotels[]` (Ruling R9), bukan gabungannya. */
function matchesBooking(field: FieldKey, value: string, current: string, booking: BookingData): boolean {
  if (field === 'hotel') {
    const want = comparable(field, value)
    return (booking.hotels ?? []).some((h) => typeof h.hotel === 'string' && comparable(field, h.hotel) === want)
  }
  return comparable(field, current) === comparable(field, value)
}

export function findMismatches(facts: ActiveFact[], booking: BookingData): Mismatch[] {
  const out: Mismatch[] = []
  for (const f of facts) {
    const current = comparableBookingValue(f.field, booking, true)
    if (current === undefined) continue
    if (current !== null && matchesBooking(f.field, f.value, current, booking)) continue
    out.push({ field: f.field, chatValue: f.value, bookingValue: current, factId: f.id })
  }
  return out
}

/** Apakah booking SUDAH memuat nilai ini (nilai mentah ternormalisasi; '07:00' == '07:00')? */
export function changeAlreadyApplied(change: { field: FieldKey; value: string }, booking: BookingData): boolean {
  const current = comparableBookingValue(change.field, booking, false)
  if (current === undefined || current === null) return false
  return matchesBooking(change.field, change.value, current, booking)
}
