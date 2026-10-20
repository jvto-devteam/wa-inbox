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
  const pm = /\b(pm|sore)\b/.test(low)
  const malam = /\bmalam\b/.test(low)
  const siang = /\bsiang\b/.test(low)
  const am = /\b(am|pagi)\b/.test(low)
  // "malam": 12 malam = tengah malam (00:00); 1-4 malam = dini hari (jemput Bromo tengah malam, "jam 2 malam"
  // = 02:00); 5-11 malam = sore/malam hari (+12).
  if (malam && hour === 12) hour = 0
  else if (malam && hour >= 1 && hour <= 4) { /* dini hari, jam tetap */ }
  else if ((pm || malam) && hour < 12) hour += 12
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
    case 'tshirt_sizes':
      // Bentuk kanonik (urutan ukuran backoffice), jadi "L x 1, M x 2" == "M x 2, L x 1". Tak terbaca = ditolak.
      return canonicalTshirtSizes(value)
    default:
      return value.length > MAX_FREE_TEXT ? `${value.slice(0, MAX_FREE_TEXT - 1)}…` : value
  }
}

/**
 * Urutan ukuran persis seperti `ScheduleController` new-backoffice merangkai `tshirtSize`
 * ("XSS x 1, XXS x 1, XS x 1, S x 1, M x 2, L x 1, XL x 1, XXL x 1, XXXL x 1"; jumlah 0 tidak ditulis).
 */
export const TSHIRT_SIZE_ORDER = ['xss', 'xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl'] as const
/** Ukuran yang bisa ditulis jalur `update-tshirt` legacy (lihat `backoffice-client.ts`). */
const WRITABLE_SIZES: readonly string[] = ['xs', 's', 'm', 'l', 'xl', 'xxl']

const TSHIRT_SIZE = '(xxxl|xxl|xss|xxs|xl|xs|s|m|l)'
const SIZE_FIRST = new RegExp(`^${TSHIRT_SIZE}\\s*(?:[x×:=]\\s*)?(\\d{1,2})?$`, 'i')
/** "2 XL", "2 M": hitungan lalu spasi lalu ukuran utuh. */
const COUNT_SPACED = new RegExp(`^(\\d{1,2})\\s+${TSHIRT_SIZE}$`, 'i')
/** "2 x XL", "2x M", "2×L": hitungan lalu pemisah x eksplisit. */
const COUNT_TIMES = new RegExp(`^(\\d{1,2})\\s*[x×]\\s*${TSHIRT_SIZE}$`, 'i')
/** "2m", "3l": hitungan menempel pada ukuran yang tidak diawali "x" (tidak ambigu). */
const COUNT_GLUED = /^(\d{1,2})(xxxl|xxl|xss|xxs|xl|xs|s|m|l)$/i
/** "2XL x 1", "3xl:1": 2XL/3XL (= XXL/XXXL) HANYA diterima bila jumlahnya ditulis eksplisit. */
const ALIAS_WITH_QTY = /^(2|3)xl\s*[x×:=]\s*(\d{1,2})$/i
const ALIAS: Record<string, string> = { '2': 'xxl', '3': 'xxxl' }

/**
 * Menempel tanpa jumlah eksplisit: "2xl"/"3xl"/"2xs" ambigu (2 x XL atau satu 2XL? 2 x S atau satu 2XS?) -> ditolak.
 * Tidak ambigu (owner 2026-10-20): "1xl" = XL x 1, "2xxl"/"3xxl" = n x XXL, "2m", "3l". Ambigu hanya bila jumlah >= 2
 * dan sisanya persis "xl" atau "xs".
 */
function isAmbiguousGlued(part: string): boolean {
  const m = /^(\d{1,2})(xl|xs)$/i.exec(part)
  return m !== null && Number(m[1]) >= 2
}

function parseSizes(raw: string, allowed: readonly string[]): Record<string, number> | null {
  const parts = raw.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return null
  const out: Record<string, number> = {}
  for (const part of parts) {
    if (isAmbiguousGlued(part)) return null
    const alias = ALIAS_WITH_QTY.exec(part)
    const a = alias ? null : SIZE_FIRST.exec(part)
    const c = alias || a ? null : COUNT_SPACED.exec(part) ?? COUNT_GLUED.exec(part) ?? COUNT_TIMES.exec(part)
    const hit = alias
      ? { size: ALIAS[alias[1]], qty: alias[2] }
      : a
        ? { size: a[1], qty: a[2] ?? '1' }
        : c
          ? { size: c[2], qty: c[1] }
          : null
    if (!hit) return null
    const key = hit.size.toLowerCase()
    if (!allowed.includes(key)) return null
    out[key] = (out[key] ?? 0) + Number(hit.qty)
  }
  return out
}

/**
 * Teks ukuran kaos (bentuk usulan ekstraksi, mis. "M x 2, L x 1") jadi jumlah per ukuran untuk
 * `writeBookingChange`. Butir dipisah koma/titik koma/baris baru; tiap butir "M x 2", "M:2", "M 2",
 * "2 M", "2x M" atau "M" saja (= 1). "2XL x 1" (jumlah eksplisit) = xxl 1; "2xl"/"3xl"/"2xs" TANPA jumlah eksplisit ambigu
 * (2 x XL atau satu 2XL?) -> null; ekstraksi wajib menulis "XL x 2". "1xl" = XL x 1, "2xxl" = XXL x 2. Satu butir tak dikenal -- termasuk ukuran yang tidak
 * punya jalur tulis (XSS/XXS/XXXL) -- = null (minta admin mengoreksi); kecocokan total dengan jumlah
 * peserta diperiksa klien tulis, bukan di sini.
 */
export const TSHIRT_AMBIGUOUS_ERROR = 'Ukuran kaos tidak jelas ("2xl" bisa berarti 2 × XL atau satu 2XL) — tulis seperti: XL x 2, M x 1'

export function parseTshirtSizes(raw: string): Record<string, number> | null {
  return parseSizes(raw, WRITABLE_SIZES)
}

/**
 * Bentuk kanonik ukuran kaos untuk menyimpan dan MEMBANDINGKAN: "M x 2, L x 1" diurutkan menurut
 * `TSHIRT_SIZE_ORDER`, jumlah 0 dibuang, label huruf besar (sama dengan keluaran backoffice). Mengenal semua
 * ukuran backoffice (termasuk XXXL), supaya `tshirtSize` booking selalu terbaca. null bila tak terbaca/kosong.
 */
export function canonicalTshirtSizes(raw: string): string | null {
  const sizes = parseSizes(raw, TSHIRT_SIZE_ORDER)
  if (!sizes) return null
  const parts = TSHIRT_SIZE_ORDER.filter((s) => (sizes[s] ?? 0) > 0).map((s) => `${s.toUpperCase()} x ${sizes[s]}`)
  return parts.length > 0 ? parts.join(', ') : null
}
