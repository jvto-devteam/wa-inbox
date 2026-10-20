/**
 * Klien tulis ke backoffice lewat jalur "my-booking" milik tamu (javavolcano-touroperator,
 * `UserBookingsController::updateTshirt/updatePickup/updateDrop`). Rute itu dikecualikan dari CSRF,
 * mencari booking lewat kolom `url` (segmen terakhir `bookingData.customer_portal`), dan membalas JSON
 * `{ success, message, data? }` (status 422/500 saat gagal).
 *
 * Aturan yang membentuk modul ini:
 * - `updatePickup`/`updateDrop` menulis ulang titik + detail SEKALIGUS (kolom `pickup`/`drop` dirakit dari
 *   keduanya), jadi klien selalu mengirim titik + detail + jam lengkap yang digabung dari booking dasar lalu
 *   ditimpa patch. Booking dasar WAJIB segar: pemanggil (eksekusi/Batalkan) mencari booking ke API tepat
 *   sebelumnya dan mengirimnya sebagai `baseBooking` -- `bookingData` tersimpan bisa ~24 jam basi dan nilai yang tidak
 *   disentuh patch akan membalik suntingan ops (final review Critical 1). Tanpa `base` (tidak dipakai jalur
 *   produksi) klien jatuh ke `bookingData` tersimpan.
 * - Jam kosong dari backoffice berupa '07:00' palsu (`date('H:i', strtotime(null))`, ruling R2). Bila patch
 *   tidak menyentuh jam dan jam booking tidak diketahui, jam TIDAK dikirim: controller hanya menulis jam bila
 *   `pickup_time1`/`drop_time1` tidak kosong.
 * - Controller hanya mengenal 'Denpasar Hotel'; `POINT_VALUES` memakai 'Bali Hotel'. Dipetakan saat kirim.
 * - Galat API TIDAK PERNAH menghapus `bookingData` (aturan yang sama dengan `BookingLookup`).
 * - Log hanya berisi jenis jalur dan kode status: tanpa teks pelanggan dan tanpa token `url` booking.
 */
import { prisma } from '@/lib/db'
import { ensureFreshBookingData, type BookingData } from '@/lib/booking/client'
import { readBookingField } from '@/lib/booking-actions/fields'
import { currentBookingId } from '@/lib/booking-actions/scope'

export type BookingPatch = Partial<
  Record<
    | 'pickup_point' | 'pickup_detail' | 'pickup_arrival' | 'pickup_time'
    | 'drop_point' | 'drop_detail' | 'drop_arrival' | 'drop_time',
    string
  >
> & { tshirt_sizes?: Record<string, number>; note?: string }

export type WrittenPart = 'pickup' | 'drop' | 'tshirt'

/**
 * Jenis galat, supaya pemanggil (eksekusi Task 11) memetakan kode HTTP tanpa mencocokkan teks:
 *   invalid         -- ditolak di sini sebelum ada permintaan (validasi/data booking tak lengkap); mengulang tidak membantu.
 *   booking_changed -- booking percakapan berganti/hilang sejak kartu dibuat.
 *   unavailable     -- jalur tulis belum dikonfigurasi.
 *   backoffice      -- backoffice menolak, tidak menjawab, atau tidak terjangkau (`httpStatus` 0 = jaringan/timeout).
 */
export type WriteErrorKind = 'invalid' | 'booking_changed' | 'unavailable' | 'backoffice'

/** `written` = bagian yang SUDAH masuk ke backoffice (berguna saat patch gabungan gagal di tengah). */
export type WriteResult =
  | { status: 'ok'; booking: BookingData; written: WrittenPart[] }
  | { status: 'error'; httpStatus: number; kind: WriteErrorKind; error: string; written: WrittenPart[] }

const TIMEOUT_MS = 10_000
const SIZES = ['xs', 's', 'm', 'l', 'xl', 'xxl'] as const

export function writeConfigured(): boolean {
  return Boolean(process.env.LEGACY_BASE_URL?.trim())
}

function fail(kind: WriteErrorKind, error: string, httpStatus = 0): WriteResult {
  return { status: 'error', httpStatus, kind, error, written: [] }
}

/** Segmen terakhir `…/my-booking/{url}`; null bila tidak ada atau bentuknya aneh. */
export function bookingUrlToken(booking: BookingData): string | null {
  const portal = booking.customer_portal
  if (typeof portal !== 'string') return null
  const path = portal.trim().split(/[?#]/)[0].replace(/\/+$/, '')
  const last = path.split('/').pop() ?? ''
  return /^[A-Za-z0-9_-]+$/.test(last) ? last : null
}

const LEGACY_POINT: Record<string, string> = { 'Bali Hotel': 'Denpasar Hotel' }
const canonicalPoint = (p: string): string => (p === 'Denpasar Hotel' ? 'Bali Hotel' : p)
const legacyPoint = (p: string): string => LEGACY_POINT[p] ?? p

/** Nama field detail di form legacy per titik (pickup / drop). */
const DETAIL_FIELD = {
  pickup: { airport: 'flight_ticket_type_number', hotel: 'hotel', train: 'train_ticket_type_number', others: 'others_location' },
  drop: { airport: 'drop_other_flight', hotel: 'drop_other_hotel', train: 'drop_other_train', others: 'drop_other_others' },
} as const

function detailFieldFor(side: 'pickup' | 'drop', legacyName: string): string | null {
  const map = DETAIL_FIELD[side]
  switch (legacyName) {
    case 'Surabaya Airport':
    case 'Denpasar Airport': return map.airport
    case 'Surabaya Hotel':
    case 'Denpasar Hotel': return map.hotel
    case 'Surabaya Train Station': return map.train
    case 'Others': return map.others
    default: return null
  }
}

type Form = { path: string; fields: Record<string, string>; kind: 'pickup' | 'drop' | 'tshirt' }
type Built = { forms: Form[] } | { error: string }

function timeParts(value: string | null | undefined): { h: string; m: string } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim())
  return m ? { h: m[1], m: m[2] } : null
}

/** '07:00' = jam palsu dari backoffice (R2): dianggap tidak diketahui. */
function bookingTimeKnown(value: string | null): boolean {
  return value !== null && value !== '' && value !== '07:00'
}

function buildPointForm(side: 'pickup' | 'drop', booking: BookingData, patch: BookingPatch): Form | { error: string } | null {
  const touched = (['point', 'detail', 'arrival', 'time'] as const).some((k) => patch[`${side}_${k}` as keyof BookingPatch] !== undefined)
  if (!touched) return null
  if (patch[`${side}_arrival` as 'pickup_arrival' | 'drop_arrival'] !== undefined) {
    return { error: 'Jam kedatangan belum punya jalur tulis' }
  }

  const curPoint = readBookingField(booking, `${side}_point` as 'pickup_point' | 'drop_point')
  const patchPoint = patch[`${side}_point` as 'pickup_point' | 'drop_point']
  const point = patchPoint ?? curPoint
  if (!point) return { error: 'Titik belum diketahui' }

  const legacy = legacyPoint(point)
  const pointChanged = patchPoint !== undefined && curPoint !== null && canonicalPoint(patchPoint) !== canonicalPoint(curPoint)
  // Detail lama milik jenis titik lain (mis. nomor penerbangan) tidak boleh terbawa ke titik baru, dan
  // controller tidak menghapus `meeting_point_value` bila detail dikirim kosong: titik baru wajib bawa detail baru.
  const patchDetail = patch[`${side}_detail` as 'pickup_detail' | 'drop_detail']
  const curDetail = readBookingField(booking, `${side}_detail` as 'pickup_detail' | 'drop_detail')
  if (pointChanged && patchDetail === undefined && curDetail !== null) {
    return { error: 'Isi detail titik baru dulu' }
  }
  const detail = patchDetail ?? (pointChanged ? '' : curDetail ?? '')
  const detailField = detailFieldFor(side, legacy)
  if (detailField === null) return { error: 'Titik tidak dikenal' }
  if (legacy === 'Others' && !detail.trim()) return { error: 'Detail lokasi Others wajib diisi' }

  const fields: Record<string, string> = {}
  fields[side === 'pickup' ? 'meeting_point' : 'drop'] = legacy
  fields[detailField] = detail

  const curTime = readBookingField(booking, `${side}_time` as 'pickup_time' | 'drop_time')
  const patchTime = patch[`${side}_time` as 'pickup_time' | 'drop_time']
  let time: { h: string; m: string } | null = null
  if (patchTime !== undefined) {
    time = timeParts(patchTime)
    if (!time) return { error: 'Format jam tidak valid' }
  } else if (bookingTimeKnown(curTime)) {
    time = timeParts(curTime)
  }
  fields[`${side === 'pickup' ? 'pickup' : 'drop'}_time1`] = time?.h ?? ''
  fields[`${side === 'pickup' ? 'pickup' : 'drop'}_time2`] = time?.m ?? ''

  return { path: side === 'pickup' ? 'update-pickup' : 'update-drop', fields, kind: side }
}

function buildForms(booking: BookingData, patch: BookingPatch): Built {
  if (patch.note !== undefined) return { error: 'Catatan belum punya jalur tulis' }
  const forms: Form[] = []

  for (const side of ['pickup', 'drop'] as const) {
    const built = buildPointForm(side, booking, patch)
    if (built === null) continue
    if ('error' in built) return built
    forms.push(built)
  }

  if (patch.tshirt_sizes !== undefined) {
    const fields: Record<string, string> = Object.fromEntries(SIZES.map((s) => [s, '0']))
    for (const [rawKey, qty] of Object.entries(patch.tshirt_sizes)) {
      const key = rawKey.trim().toLowerCase()
      if (!(SIZES as readonly string[]).includes(key)) return { error: 'Ukuran kaos tidak dikenal' }
      if (!Number.isInteger(qty) || qty < 0) return { error: 'Jumlah kaos tidak valid' }
      fields[key] = String(qty)
    }
    const total = SIZES.reduce((sum, s) => sum + Number(fields[s]), 0)
    if (typeof booking.total_pax === 'number' && total !== booking.total_pax) {
      return { error: `Total kaos (${total}) harus sama dengan jumlah peserta (${booking.total_pax})` }
    }
    forms.push({ path: 'update-tshirt', fields, kind: 'tshirt' })
  }

  return forms.length > 0 ? { forms } : { error: 'Tidak ada perubahan untuk ditulis' }
}

async function post(base: string, token: string, form: Form): Promise<WriteResult | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${base}/bookings/${form.path}/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(form.fields).toString(),
      signal: controller.signal,
    })
    let body: { success?: unknown; message?: unknown } = {}
    try {
      body = (await res.json()) as typeof body
    } catch {
      body = {}
    }
    if (res.ok && body.success === true) return null
    // 200 tanpa success:true (atau bukan JSON) bukan sukses dan bukan kode HTTP yang berarti: 502.
    const httpStatus = res.ok ? 502 : res.status
    console.error('writeBookingChange: backoffice menolak', { kind: form.kind, httpStatus })
    const message = typeof body.message === 'string' && body.message.trim() ? body.message.trim().slice(0, 200) : 'Backoffice menolak perubahan'
    return fail('backoffice', message, httpStatus)
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError'
    console.error('writeBookingChange: permintaan gagal', { kind: form.kind, timedOut })
    return fail('backoffice', timedOut ? 'Backoffice tidak menjawab (timeout)' : 'Backoffice tidak terjangkau')
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Menulis perubahan ke backoffice untuk booking `bookingId` milik percakapan `conversationId`
 * (klien butuh `bookingData` terbaru untuk menggabung titik + detail + jam, jadi percakapan dimuat di sini).
 * Booking percakapan yang sudah berganti dari `bookingId` ditolak tanpa permintaan.
 */
export async function writeBookingChange(
  bookingId: string,
  patch: BookingPatch,
  conversationId: string,
  /** Booking segar dari API (lihat kepala file). */
  baseBooking?: BookingData
): Promise<WriteResult> {
  const base = process.env.LEGACY_BASE_URL?.trim().replace(/\/+$/, '')
  if (!base) return fail('unavailable', 'Jalur tulis backoffice belum dikonfigurasi')

  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true, bookingData: true, bookingCheckedAt: true, pipelineStage: true, orderChannel: true, isTest: true,
      contact: { select: { phone: true } },
    },
  })
  const raw = baseBooking ?? conv?.bookingData
  if (!conv || typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('booking_changed', 'Data booking tidak tersedia')
  const booking = raw as BookingData
  if (currentBookingId(booking) !== bookingId) return fail('booking_changed', 'Booking percakapan sudah berganti')

  const token = bookingUrlToken(booking)
  if (token === null) return fail('invalid', 'Tautan my-booking tidak ditemukan pada data booking')

  const built = buildForms(booking, patch)
  if ('error' in built) return fail('invalid', built.error)

  const written: WrittenPart[] = []
  let failure: WriteResult | null = null
  for (const form of built.forms) {
    failure = await post(base, token, form)
    if (failure) break
    written.push(form.kind)
  }

  // Sebagian perubahan mungkin sudah masuk sebelum yang lain gagal: segarkan juga, supaya data lokal jujur.
  // Penyegaran gagal = `booking` dikembalikan apa adanya (data SEBELUM tulis); pemanggil yang butuh nilai baru
  // (kabar vendor Bali) wajib memeriksa isinya sendiri.
  let fresh: BookingData = booking
  if (written.length > 0) {
    try {
      // bookingCheckedAt null memaksa ambil ulang; bila API booking gagal, data tersimpan tetap dipakai.
      const refreshed = await ensureFreshBookingData({ ...conv, bookingCheckedAt: null })
      if (refreshed) fresh = refreshed
    } catch (error) {
      console.error('writeBookingChange: penyegaran bookingData gagal', { error: error instanceof Error ? error.message : 'unknown' })
    }
  }

  if (failure && failure.status === 'error') return { ...failure, written }
  return { status: 'ok', booking: fresh, written }
}
