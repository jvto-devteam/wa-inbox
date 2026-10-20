/**
 * Registry field booking yang boleh diubah lewat chat: pembacaan nilai saat ini dari
 * `bookingData`, normalisasi nilai usulan, dan pengelompokan perubahan (spec §5.3):
 *
 *   AI    titik/jam/detail di Surabaya, kaos, catatan -- AI boleh mengubah langsung.
 *   BALI  booking dengan transport Bali -- AI mengubah + admin mengabari vendor.
 *   HEAVY pindah Surabaya <-> Bali (ganti paket), tanggal, pax, hotel -- hanya admin.
 *
 * `null` dari `readBookingField` berarti "tidak diketahui" -- bukan "kosong yang sah".
 */
import type { BookingData } from '@/lib/booking/client'

export type FieldKey =
  | 'pickup_point' | 'pickup_detail' | 'pickup_arrival' | 'pickup_time'
  | 'drop_point' | 'drop_detail' | 'drop_arrival' | 'drop_time'
  | 'tshirt_sizes' | 'note' | 'travel_date' | 'total_pax' | 'hotel'

export type ChangeGroup = 'AI' | 'BALI' | 'HEAVY'

export const POINT_VALUES = [
  'Surabaya Airport',
  'Denpasar Airport',
  'Surabaya Train Station',
  'Surabaya Hotel',
  'Bali Hotel',
  'Others',
] as const

export const FIELD_KEYS: readonly FieldKey[] = [
  'pickup_point', 'pickup_detail', 'pickup_arrival', 'pickup_time',
  'drop_point', 'drop_detail', 'drop_arrival', 'drop_time',
  'tshirt_sizes', 'note', 'travel_date', 'total_pax', 'hotel',
]

const BALI_POINTS: readonly string[] = ['Denpasar Airport', 'Bali Hotel']
const MAX_FREE_TEXT = 300
const MAX_PAX = 60

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function readBookingField(b: BookingData, key: FieldKey): string | null {
  switch (key) {
    case 'pickup_point': return text(b.pickup?.meeting_point)
    case 'pickup_detail': return text(b.pickup?.meeting_point_value)
    case 'pickup_arrival': return text(b.pickup?.meeting_point_arrival)
    case 'pickup_time': return text(b.pickup?.pickup_time)
    case 'drop_point': return text(b.dropoff?.drop_point)
    case 'drop_detail': return text(b.dropoff?.drop_point_value)
    case 'drop_arrival': return text(b.dropoff?.drop_point_arrival)
    case 'drop_time': return text(b.dropoff?.drop_time)
    case 'tshirt_sizes': return text(b.tshirtSize)
    case 'travel_date': return text(b.date?.start_ymd)
    case 'total_pax': return typeof b.total_pax === 'number' && Number.isFinite(b.total_pax) ? String(b.total_pax) : null
    case 'hotel': {
      const names = (b.hotels ?? []).map((h) => text(h.hotel)).filter((h): h is string => h !== null)
      return names.length > 0 ? names.join(', ') : null
    }
    case 'note': return null // catatan booking tidak ada di respons API booking
  }
}

/**
 * Apakah booking ini memakai transport Bali (perubahan jam/detail harus ikut dikabari ke vendor).
 *
 * Keterbatasan: respons `ScheduleController` TIDAK memuat add-on (hanya `book_add_on_total` yang
 * muncul tersirat sebagai tautan invoice `?addon=true`, tanpa jenis add-on), jadi add-on transport
 * Bali pada paket yang mulai dari Surabaya tidak terdeteksi. Sinyal yang dipakai: titik jemput
 * atau antar `Bali Hotel`/`Denpasar Airport`, atau itinerary hari pertama bertujuan/berisi Bali.
 */
export function usesBaliTransport(booking: BookingData): boolean {
  const points = [booking.pickup?.meeting_point, booking.dropoff?.drop_point]
  if (points.some((p) => typeof p === 'string' && BALI_POINTS.includes(p.trim()))) return true
  const first = (booking.itinerary ?? []).find((d) => String(d.day ?? '').trim() === '1') ?? booking.itinerary?.[0]
  if (!first) return false
  const haystack = [first.destination, first.itinerary].filter((v): v is string => typeof v === 'string').join(' ')
  return /\bbali\b/i.test(haystack)
}

export function changeGroup(key: FieldKey, newValue: string, booking: BookingData): ChangeGroup {
  if (key === 'travel_date' || key === 'total_pax' || key === 'hotel') return 'HEAVY'
  if (key === 'pickup_point' || key === 'drop_point') {
    const old = readBookingField(booking, key)
    // Menyentuh Bali di sisi mana pun = ganti paket, bukan sekadar ubah titik.
    if (BALI_POINTS.includes(newValue) || (old !== null && BALI_POINTS.includes(old))) return 'HEAVY'
  }
  return usesBaliTransport(booking) ? 'BALI' : 'AI'
}

function normalizeTime(raw: string): string | null {
  const low = raw.trim().toLowerCase()
  // Seluruh teks hanya boleh memuat SATU jam: tanggal ("2026-10-20") atau angka lain tidak lolos.
  const m = /^[^\d]*(\d{1,2})(?:[.:](\d{2}))?([^\d]*)$/.exec(low)
  if (!m) return null
  let hour = Number(m[1])
  const minute = m[2] ? Number(m[2]) : 0
  if (minute > 59 || hour > 23) return null
  const pm = /\b(pm|sore|malam)\b/.test(low)
  const siang = /\bsiang\b/.test(low)
  const am = /\b(am|pagi)\b/.test(low)
  if (pm && hour < 12) hour += 12
  else if (siang && hour < 11) hour += 12
  else if (am && hour === 12) hour = 0
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function normalizeFieldValue(key: FieldKey, raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  switch (key) {
    case 'pickup_time':
    case 'drop_time':
      return normalizeTime(value)
    case 'total_pax': {
      if (!/^\d+$/.test(value)) return null
      const n = Number(value)
      return n >= 1 && n <= MAX_PAX ? String(n) : null
    }
    case 'pickup_point':
    case 'drop_point':
      return POINT_VALUES.find((p) => p.toLowerCase() === value.toLowerCase()) ?? null
    case 'travel_date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
      const d = new Date(`${value}T00:00:00Z`)
      return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : value
    }
    default:
      return value.length > MAX_FREE_TEXT ? `${value.slice(0, MAX_FREE_TEXT - 1)}…` : value
  }
}
