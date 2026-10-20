/**
 * "Setujui" pada kartu CHANGE: menulis perubahan ke backoffice lewat `writeBookingChange` (Task 9) dan
 * mencatat hasilnya. Ini satu-satunya jalur di wa-inbox yang MENGUBAH booking produksi, jadi bentuknya
 * dibuat untuk idempoten dan jujur:
 *
 * Mesin status satu aksi:
 *   OPEN --klaim--> EXECUTING --sukses--> EXECUTED (closedReason EXECUTED, closedById, event EXECUTED)
 *                             --gagal---> OPEN (lastError, event EXECUTE_FAILED)
 *   EXECUTING > 2 menit (proses mati di tengah) --releaseStaleExecuting-->
 *       RESOLVED/MATCHED_IN_BACKOFFICE bila booking sudah memuat nilainya, selain itu OPEN (lastError).
 *
 * - KLAIM sebelum memanggil backoffice: `updateMany where {id, state:'OPEN'}` yang menstempel kolom
 *   `claimedAt = claimAt` (R22: kolom sendiri, bukan `updatedAt`, karena perilaku `@updatedAt` yang diisi
 *   eksplisit tidak terbukti di query compiler Prisma 7). Klik ganda / dua admin bersamaan: hanya satu
 *   mendapat count 1, yang lain 409. Transisi akhir mensyaratkan `{state:'EXECUTING', claimedAt: claimAt}`
 *   dan selalu mengosongkan `claimedAt`, jadi baris yang dilepas sebagai basi lalu diklaim permintaan lain
 *   tidak pernah disentuh permintaan pertama.
 * - Sesudah klaim semuanya dalam try/finally: lemparan tak terduga melepas klaim ke OPEN, KECUALI tulisan
 *   sudah berhasil (kartu dibiarkan EXECUTING; pelepasan basi memeriksa booking lebih dulu).
 * - Booking yang dituju (Task 10): `bookingId` aksi harus sama dengan `bookingData.booking_id` terbaru.
 * - Ruling R16: `note`, `pickup_arrival`, `drop_arrival` tidak punya jalur tulis -> 400.
 * - Ruling R17 + R20: kartu titik <-> detail di sisi yang sama yang masih OPEN ikut diklaim dan ditulis
 *   dalam SATU patch; kartu jam disetujui sendiri.
 * - Ruling R19: kartu titik menerima `detail` opsional. Ia menimpa kartu detail pendamping (yang lalu
 *   tertutup EXECUTED dengan detail yang benar-benar ditulis, plus CORRECTED bila berbeda).
 * - Koreksi admin dicatat event CORRECTED dengan `oldValue` = usulan ASLI, lalu `proposedValue` ditimpa.
 *   Event itulah tempat nilai asli disimpan: `store.ts#loadBlocked` membaca CORRECTED milik aksi
 *   EXECUTED supaya ekstraksi berikutnya tidak mengusulkan lagi nilai yang sudah dikoreksi admin.
 * - `lastError` dan reason lewat `sanitizeTrace`; respons 502 memakai pesan generik, bukan teks backoffice.
 * - oldValue/newValue event berupa nilai polos (string/null) supaya riwayat terbaca "10:30 -> 09:00".
 * - Task 11a: sukses pada kartu tier BALI memicu SATU kabar ke vendor (`bali-vendor.ts`), sesudah transaksi,
 *   tanpa menunggu dan tanpa mengubah respons; gagal kirim = event VENDOR_NOTICE_FAILED + push admin.
 * - Log hanya id/kind/status: tanpa teks pelanggan dan tanpa token url booking.
 *
 * Pelepasan klaim basi dipanggil dari GET panel kartu (`/api/conversations/[id]/booking-actions`) dan
 * dari `POST /api/summary-items/tick` (tiap 5 menit, semua percakapan, satu kueri).
 */
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { sanitizeTrace } from '@/lib/bot-control/trace-sanitizer'
import {
  writeBookingChange,
  writeConfigured,
  type BookingPatch,
  type WriteErrorKind,
  type WriteResult,
  type WrittenPart,
} from '@/lib/booking/backoffice-client'
import type { BookingData } from '@/lib/booking/client'
import { changeAlreadyApplied } from './compare'
import { normalizeFieldValue, parseTshirtSizes, readBookingField, type FieldKey } from './fields'
import { recordEvent } from './history'
import { notifyBaliVendor } from './bali-vendor'
import { currentBookingId } from './scope'
import { reevaluateBookingActions } from './store'
import { canExecuteField, companionFields, detailFieldOf } from './view'

/** Klaim EXECUTING yang lebih tua dari ini dianggap proses mati di tengah. Tulis terlama ~10 s + segar. */
export const STALE_CLAIM_MS = 2 * 60 * 1000
export const BOOKING_CHANGED_ERROR = 'Booking di percakapan ini berubah sejak kartu dibuat. Periksa ulang.'
export const STALE_CLAIM_ERROR = 'Eksekusi terputus sebelum selesai. Periksa booking di backoffice sebelum menyetujui lagi.'
const UNEXPECTED_ERROR = 'Eksekusi berhenti karena galat tak terduga. Coba lagi.'
const MAX_ERROR = 500
const TRANSPORT_FIELDS: ReadonlySet<FieldKey> = new Set<FieldKey>([
  'pickup_point', 'pickup_detail', 'pickup_time', 'drop_point', 'drop_detail', 'drop_time',
])

export type ExecuteResult =
  | { status: 200; body: { ok: true; state: 'EXECUTED'; executed: string[]; written: WrittenPart[] } }
  | { status: 400 | 404 | 409 | 502 | 503; body: { error: string } }

type Included = { id: string; field: FieldKey; value: string; oldValue: string | null }
type StringPatchKey = Exclude<keyof BookingPatch, 'tshirt_sizes'>

const fail = (status: 400 | 404 | 409 | 502 | 503, error: string): ExecuteResult => ({ status, body: { error } })

function asBooking(raw: unknown): BookingData | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as BookingData) : null
}

function clean(text: string): string {
  const s = sanitizeTrace(text)
  return (typeof s === 'string' ? s : '').slice(0, MAX_ERROR)
}

const STATUS_BY_KIND: Record<WriteErrorKind, 400 | 409 | 502 | 503> = {
  invalid: 400,
  booking_changed: 409,
  unavailable: 503,
  backoffice: 502,
}

/** Pesan respons: validasi milik kita sendiri boleh tampil apa adanya; teks backoffice tidak. */
function responseError(result: Extract<WriteResult, { status: 'error' }>): string {
  if (result.kind === 'booking_changed') return BOOKING_CHANGED_ERROR
  if (result.kind === 'backoffice') {
    const code = result.httpStatus > 0 ? `HTTP ${result.httpStatus}` : 'tanpa jawaban'
    const partial = result.written.length > 0 ? `Sebagian sudah tertulis (${result.written.join(', ')}). ` : ''
    return `${partial}Backoffice gagal menulis perubahan (${code}). Lihat "Gagal terakhir" di kartu.`
  }
  return result.error
}

function buildPatch(included: Included[]): BookingPatch {
  const patch: BookingPatch = {}
  for (const a of included) {
    if (a.field === 'tshirt_sizes') {
      const sizes = parseTshirtSizes(a.value)
      if (sizes) patch.tshirt_sizes = sizes
    } else {
      patch[a.field as StringPatchKey] = a.value
    }
  }
  return patch
}

export async function executeBookingAction(input: {
  actionId: string
  accountId: string
  value?: string
  detail?: string
  now?: Date
}): Promise<ExecuteResult> {
  const { actionId, accountId } = input
  const claimAt = input.now ?? new Date()

  // 1. Validasi tanpa mengubah apa pun.
  const action = await prisma.bookingAction.findUnique({ where: { id: actionId } })
  if (!action) return fail(404, 'Tindakan tidak ditemukan')
  if (action.type !== 'CHANGE') return fail(400, 'Operasi tidak cocok dengan jenis tindakan')
  if (action.state === 'EXECUTING') return fail(409, 'Tindakan sedang dijalankan')
  if (action.state !== 'OPEN') return fail(409, 'Tindakan sudah ditutup')
  const field = action.field as FieldKey
  if (!canExecuteField(field)) {
    return fail(400, 'Perubahan ini belum bisa ditulis otomatis. Ubah di backoffice lalu tandai Selesai.')
  }
  const detailField = detailFieldOf(field)
  let detail: string | null = null
  if (input.detail !== undefined) {
    if (detailField === null) return fail(400, 'Detail hanya untuk perubahan titik pickup/drop-off')
    detail = normalizeFieldValue(detailField, input.detail)
    if (detail === null) return fail(400, 'Detail titik tidak valid')
  }
  if (!writeConfigured()) return fail(503, 'Jalur tulis backoffice belum dikonfigurasi')

  const conversationId = action.conversationId
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { bookingData: true } })
  const booking = asBooking(conv?.bookingData)
  const bookingId = action.bookingId
  if (!booking || bookingId === null || currentBookingId(booking) !== bookingId) return fail(409, BOOKING_CHANGED_ERROR)

  const proposed = typeof action.proposedValue === 'string' && action.proposedValue.trim() ? action.proposedValue : null
  let value = proposed
  if (input.value !== undefined) {
    value = normalizeFieldValue(field, input.value)
    if (value === null) return fail(400, 'Nilai koreksi tidak valid')
  }
  if (value === null) return fail(400, 'Nilai usulan kosong. Isi nilai yang akan ditulis.')
  if (field === 'tshirt_sizes' && parseTshirtSizes(value) === null) {
    return fail(400, 'Format ukuran kaos tidak dikenali (contoh: M x 2, L x 1)')
  }
  const finalValue = value
  const corrected = finalValue !== proposed

  // 2-4. Klaim aksi ini (+ koreksi) dan kartu pendamping sisi yang sama (R17/R20) dalam satu transaksi.
  const included = await prisma.$transaction(async (tx) => {
    const claimed = await tx.bookingAction.updateMany({
      where: { id: actionId, state: 'OPEN' },
      data: { state: 'EXECUTING', claimedAt: claimAt, lastError: null, ...(corrected ? { proposedValue: finalValue } : {}) },
    })
    if (claimed.count === 0) return null
    if (corrected) {
      await recordEvent(tx, {
        conversationId, bookingId, actionId, event: 'CORRECTED', actor: 'ACCOUNT', accountId,
        oldValue: proposed, newValue: finalValue,
      })
    }
    const list: Included[] = [{ id: actionId, field, value: finalValue, oldValue: readBookingField(booking, field) }]
    const others = companionFields(field)
    if (others.length > 0) {
      const rows = (await tx.bookingAction.findMany({
        where: { conversationId, bookingId, type: 'CHANGE', state: 'OPEN', field: { in: others } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, field: true, proposedValue: true },
      })) ?? []
      for (const f of others) {
        const row = rows.find((r) => r.field === f && typeof r.proposedValue === 'string' && r.proposedValue.trim() !== '')
        if (!row || typeof row.proposedValue !== 'string') continue
        // R19: detail dari kartu titik menimpa usulan kartu detail pendamping.
        const override = f === detailField && detail !== null && detail !== row.proposedValue ? detail : null
        const res = await tx.bookingAction.updateMany({
          where: { id: row.id, state: 'OPEN' },
          data: { state: 'EXECUTING', claimedAt: claimAt, lastError: null, ...(override !== null ? { proposedValue: override } : {}) },
        })
        if (res.count !== 1) continue
        if (override !== null) {
          await recordEvent(tx, {
            conversationId, bookingId, actionId: row.id, event: 'CORRECTED', actor: 'ACCOUNT', accountId,
            oldValue: row.proposedValue, newValue: override,
          })
        }
        list.push({ id: row.id, field: f, value: override ?? row.proposedValue, oldValue: readBookingField(booking, f) })
      }
    }
    return list
  })
  if (!included) return fail(409, 'Tindakan sudah ditutup atau sedang dijalankan')
  const ids = included.map((a) => a.id)
  const patch = buildPatch(included)
  if (detail !== null && detailField !== null) patch[detailField] = detail

  // Sesudah klaim: apa pun yang terjadi, klaim tidak boleh tertinggal tanpa alasan.
  let settled = false
  let writeSucceeded = false
  try {
    // 5. Tulis.
    let result: WriteResult
    try {
      result = await writeBookingChange(bookingId, patch, conversationId)
    } catch (error) {
      // Klien sendiri tidak melempar; ini sabuk pengaman (mis. DB gagal sebelum permintaan).
      console.error('executeBookingAction: writeBookingChange melempar', { actionIds: ids, error: error instanceof Error ? error.name : 'unknown' })
      result = { status: 'error', kind: 'backoffice', httpStatus: 0, error: 'Gagal menulis ke backoffice', written: [] }
    }

    // 6. Sukses.
    if (result.status === 'ok') {
      writeSucceeded = true
      const written = result.written
      await prisma.$transaction(async (tx) => {
        for (const a of included) {
          await tx.bookingAction.updateMany({
            where: { id: a.id, state: 'EXECUTING', claimedAt: claimAt },
            data: { state: 'EXECUTED', closedReason: 'EXECUTED', closedById: accountId, closedAt: new Date(), claimedAt: null, lastError: null },
          })
          // Event selalu ditulis: perubahan SUDAH ada di backoffice, apa pun hasil update di atas.
          await recordEvent(tx, {
            conversationId, bookingId, actionId: a.id, event: 'EXECUTED', actor: 'ACCOUNT', accountId,
            oldValue: a.oldValue, newValue: a.value, backoffice: { written, httpStatus: 200 },
          })
        }
      })
      settled = true
      await reevaluate(conversationId)
      broadcast({ type: 'booking-actions.changed', conversationId })
      // Task 11a: kelompok BALI -> kabari vendor transport Bali sekali. Fire-and-forget; tidak mengubah respons.
      // Gate ganda: tier BALI DAN minimal satu field transport benar-benar ditulis (kartu + pendamping).
      // Tier saja tidak cukup: changeGroup memberi BALI pada semua field non-HEAVY, termasuk kaos/catatan.
      if (action.tier === 'BALI' && included.some((a) => TRANSPORT_FIELDS.has(a.field))) {
        void notifyBaliVendor({ actionId, conversationId, bookingId, booking: result.booking }).catch(() => undefined)
      }
      return { status: 200, body: { ok: true, state: 'EXECUTED', executed: ids, written } }
    }

    // 7. Gagal: lepas klaim, catat, kembalikan kode yang sesuai.
    const partial = result.written.length > 0
    const reason = clean(partial ? `Sebagian sudah tertulis (${result.written.join(', ')}): ${result.error}` : result.error)
    console.error('executeBookingAction: gagal', { actionIds: ids, kind: result.kind, httpStatus: result.httpStatus, written: result.written })
    await prisma.$transaction(async (tx) => {
      for (const a of included) {
        await tx.bookingAction.updateMany({
          where: { id: a.id, state: 'EXECUTING', claimedAt: claimAt },
          data: { state: 'OPEN', claimedAt: null, lastError: reason },
        })
        await recordEvent(tx, {
          conversationId, bookingId, actionId: a.id, event: 'EXECUTE_FAILED', actor: 'ACCOUNT', accountId,
          oldValue: a.oldValue, newValue: a.value, reason,
          backoffice: { written: result.written, httpStatus: result.httpStatus, kind: result.kind, ...(partial ? { partial: true } : {}) },
        })
      }
    })
    settled = true
    if (partial) await reevaluate(conversationId)
    broadcast({ type: 'booking-actions.changed', conversationId })
    return fail(STATUS_BY_KIND[result.kind], responseError(result))
  } finally {
    if (!settled && !writeSucceeded) await releaseClaims(ids, claimAt)
  }
}

/** Lepas klaim permintaan ini (dan hanya ini) ke OPEN setelah lemparan tak terduga. Tidak pernah melempar. */
async function releaseClaims(ids: string[], claimAt: Date): Promise<void> {
  for (const id of ids) {
    try {
      await prisma.bookingAction.updateMany({
        where: { id, state: 'EXECUTING', claimedAt: claimAt },
        data: { state: 'OPEN', claimedAt: null, lastError: UNEXPECTED_ERROR },
      })
    } catch (error) {
      console.error('executeBookingAction: melepas klaim gagal', { actionId: id, error: error instanceof Error ? error.name : 'unknown' })
    }
  }
}

async function reevaluate(conversationId: string): Promise<void> {
  try {
    await reevaluateBookingActions(conversationId)
  } catch (error) {
    console.error('executeBookingAction: reevaluate gagal', { conversationId, error: error instanceof Error ? error.name : 'unknown' })
  }
}

/**
 * Klaim EXECUTING yang lebih tua dari `STALE_CLAIM_MS` (proses mati di tengah panggilan). Bila
 * `bookingData` sekarang sudah memuat nilainya (`changeAlreadyApplied`) tulisan itu ternyata masuk:
 * baris ditutup RESOLVED/MATCHED_IN_BACKOFFICE, supaya klik ulang tidak menulis produksi dua kali.
 * Selain itu kembali OPEN dengan `lastError`. Satu kueri (dengan bookingData percakapannya), lalu
 * update bersyarat per baris (`state EXECUTING AND claimedAt < cutoff`) supaya klaim hidup tidak dicuri.
 * Tanpa `conversationId` = semua percakapan (tick).
 */
export async function releaseStaleExecuting(conversationId?: string, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_CLAIM_MS)
  const rows = (await prisma.bookingAction.findMany({
    where: { ...(conversationId ? { conversationId } : {}), state: 'EXECUTING', claimedAt: { lt: cutoff } },
    select: { id: true, conversationId: true, bookingId: true, field: true, proposedValue: true, conversation: { select: { bookingData: true } } },
  })) ?? []
  let released = 0
  for (const r of rows) {
    const value = typeof r.proposedValue === 'string' ? r.proposedValue : null
    const booking = asBooking(r.conversation?.bookingData)
    const applied = value !== null && booking !== null && currentBookingId(booking) === r.bookingId &&
      changeAlreadyApplied({ field: r.field as FieldKey, value }, booking)
    const res = await prisma.bookingAction.updateMany({
      where: { id: r.id, state: 'EXECUTING', claimedAt: { lt: cutoff } },
      data: applied
        ? { state: 'RESOLVED', closedReason: 'MATCHED_IN_BACKOFFICE', closedAt: now, claimedAt: null, lastError: null }
        : { state: 'OPEN', claimedAt: null, lastError: STALE_CLAIM_ERROR },
    })
    if (res?.count !== 1) continue
    released++
    await recordEvent(prisma, {
      conversationId: r.conversationId, bookingId: r.bookingId, actionId: r.id, actor: 'SYSTEM', newValue: value,
      ...(applied
        ? { event: 'RESOLVED' as const, reason: 'MATCHED_IN_BACKOFFICE' }
        : { event: 'EXECUTE_FAILED' as const, reason: STALE_CLAIM_ERROR, backoffice: { interrupted: true } }),
    })
    broadcast({ type: 'booking-actions.changed', conversationId: r.conversationId })
  }
  if (released > 0) console.error('releaseStaleExecuting: klaim basi dilepas', { released })
  return released
}
