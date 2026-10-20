/**
 * "Setujui" pada kartu CHANGE: menulis perubahan ke backoffice lewat `writeBookingChange` (Task 9) dan
 * mencatat hasilnya. Ini satu-satunya jalur di wa-inbox yang MENGUBAH booking produksi, jadi bentuknya
 * dibuat untuk idempoten dan jujur:
 *
 * Mesin status satu aksi:
 *   OPEN --klaim--> EXECUTING --sukses--> EXECUTED (closedReason EXECUTED, closedById, event EXECUTED)
 *                             --gagal---> OPEN (lastError, event EXECUTE_FAILED)
 *   EXECUTING > 2 menit (proses mati di tengah) --releaseStaleExecuting--> OPEN (lastError, EXECUTE_FAILED SYSTEM)
 *
 * - KLAIM sebelum memanggil backoffice: `updateMany where {id, state:'OPEN'}`. Klik ganda / dua admin
 *   bersamaan: hanya satu yang mendapat count 1, yang lain 409 -- backoffice ditulis sekali.
 * - Booking yang dituju (Task 10): `bookingId` aksi harus sama dengan `bookingData.booking_id` terbaru.
 * - Ruling R16: `note`, `pickup_arrival`, `drop_arrival` tidak punya jalur tulis -> 400.
 * - Ruling R17: kartu titik/detail/jam di sisi yang sama (pickup atau drop) yang masih OPEN ikut
 *   diklaim dan ditulis dalam SATU patch; semuanya EXECUTED atau semuanya kembali OPEN bersama.
 * - Koreksi admin (`value` beda dari usulan) dicatat CORRECTED dan menggantikan `proposedValue`.
 * - oldValue/newValue event berupa nilai polos (string/null) supaya riwayat terbaca "10:30 -> 09:00".
 * - Log hanya id/kind/status: tanpa teks pelanggan dan tanpa token url booking.
 *
 * Klaim basi: dilepas oleh `releaseStaleExecuting`, dipanggil dari GET panel kartu
 * (`/api/conversations/[id]/booking-actions`) -- tempat admin melihat kartunya -- bukan dari
 * reevaluate (yang bisa baru berjalan 24 jam kemudian saat cache booking basi).
 */
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import {
  writeBookingChange,
  writeConfigured,
  type BookingPatch,
  type WriteErrorKind,
  type WriteResult,
  type WrittenPart,
} from '@/lib/booking/backoffice-client'
import type { BookingData } from '@/lib/booking/client'
import { normalizeFieldValue, parseTshirtSizes, readBookingField, type FieldKey } from './fields'
import { recordEvent } from './history'
import { currentBookingId } from './scope'
import { reevaluateBookingActions } from './store'
import { canExecuteField, companionFields } from './view'

/** Klaim EXECUTING yang lebih tua dari ini dianggap proses mati di tengah. Tulis terlama ~10 s + segar. */
export const STALE_CLAIM_MS = 2 * 60 * 1000
export const BOOKING_CHANGED_ERROR = 'Booking di percakapan ini berubah sejak kartu dibuat. Periksa ulang.'
export const STALE_CLAIM_ERROR = 'Eksekusi terputus sebelum selesai. Periksa booking di backoffice sebelum menyetujui lagi.'
const MAX_ERROR = 500

export type ExecuteResult =
  | { status: 200; body: { ok: true; state: 'EXECUTED'; executed: string[]; written: WrittenPart[] } }
  | { status: 400 | 404 | 409 | 502 | 503; body: { error: string } }

type Included = { id: string; field: FieldKey; value: string; oldValue: string | null }
type StringPatchKey = Exclude<keyof BookingPatch, 'tshirt_sizes'>

const fail = (status: 400 | 404 | 409 | 502 | 503, error: string): ExecuteResult => ({ status, body: { error } })

function asBooking(raw: unknown): BookingData | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as BookingData) : null
}

const STATUS_BY_KIND: Record<WriteErrorKind, 400 | 409 | 502 | 503> = {
  invalid: 400,
  booking_changed: 409,
  unavailable: 503,
  backoffice: 502,
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
  now?: Date
}): Promise<ExecuteResult> {
  const { actionId, accountId } = input
  const now = input.now ?? new Date()

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

  // 2-4. Klaim aksi ini (+ koreksi) dan kartu pendamping sisi yang sama (R17) dalam satu transaksi.
  const included = await prisma.$transaction(async (tx) => {
    const claimed = await tx.bookingAction.updateMany({
      where: { id: actionId, state: 'OPEN' },
      data: { state: 'EXECUTING', updatedAt: now, lastError: null, ...(corrected ? { proposedValue: finalValue } : {}) },
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
        const res = await tx.bookingAction.updateMany({
          where: { id: row.id, state: 'OPEN' },
          data: { state: 'EXECUTING', updatedAt: now, lastError: null },
        })
        if (res.count === 1) list.push({ id: row.id, field: f, value: row.proposedValue, oldValue: readBookingField(booking, f) })
      }
    }
    return list
  })
  if (!included) return fail(409, 'Tindakan sudah ditutup atau sedang dijalankan')
  const ids = included.map((a) => a.id)

  // 5. Tulis.
  let result: WriteResult
  try {
    result = await writeBookingChange(bookingId, buildPatch(included), conversationId)
  } catch (error) {
    // Klien sendiri tidak melempar; ini sabuk pengaman (mis. DB gagal sebelum permintaan).
    console.error('executeBookingAction: writeBookingChange melempar', { actionIds: ids, error: error instanceof Error ? error.name : 'unknown' })
    result = { status: 'error', kind: 'backoffice', httpStatus: 0, error: 'Gagal menulis ke backoffice', written: [] }
  }

  // 6. Sukses.
  if (result.status === 'ok') {
    const written = result.written
    await prisma.$transaction(async (tx) => {
      for (const a of included) {
        // OPEN juga diterima: klaim yang (setelah 2 menit) dilepas tetap SUDAH tertulis di backoffice.
        await tx.bookingAction.updateMany({
          where: { id: a.id, state: { in: ['EXECUTING', 'OPEN'] } },
          data: { state: 'EXECUTED', closedReason: 'EXECUTED', closedById: accountId, closedAt: now, lastError: null },
        })
        await recordEvent(tx, {
          conversationId, bookingId, actionId: a.id, event: 'EXECUTED', actor: 'ACCOUNT', accountId,
          oldValue: a.oldValue, newValue: a.value, backoffice: { written, httpStatus: 200 },
        })
      }
    })
    await reevaluate(conversationId)
    broadcast({ type: 'booking-actions.changed', conversationId })
    return { status: 200, body: { ok: true, state: 'EXECUTED', executed: ids, written } }
  }

  // 7. Gagal: lepas klaim, catat, kembalikan kode yang sesuai.
  const partial = result.written.length > 0
  const reason = (partial ? `Sebagian sudah tertulis (${result.written.join(', ')}): ${result.error}` : result.error).slice(0, MAX_ERROR)
  console.error('executeBookingAction: gagal', { actionIds: ids, kind: result.kind, httpStatus: result.httpStatus, written: result.written })
  await prisma.$transaction(async (tx) => {
    for (const a of included) {
      await tx.bookingAction.updateMany({ where: { id: a.id, state: 'EXECUTING' }, data: { state: 'OPEN', lastError: reason } })
      await recordEvent(tx, {
        conversationId, bookingId, actionId: a.id, event: 'EXECUTE_FAILED', actor: 'ACCOUNT', accountId,
        oldValue: a.oldValue, newValue: a.value, reason,
        backoffice: { written: result.written, httpStatus: result.httpStatus, kind: result.kind, ...(partial ? { partial: true } : {}) },
      })
    }
  })
  if (partial) await reevaluate(conversationId)
  broadcast({ type: 'booking-actions.changed', conversationId })
  return fail(STATUS_BY_KIND[result.kind], result.kind === 'booking_changed' ? BOOKING_CHANGED_ERROR : reason)
}

async function reevaluate(conversationId: string): Promise<void> {
  try {
    await reevaluateBookingActions(conversationId)
  } catch (error) {
    console.error('executeBookingAction: reevaluate gagal', { conversationId, error: error instanceof Error ? error.name : 'unknown' })
  }
}

/**
 * Klaim EXECUTING yang lebih tua dari `STALE_CLAIM_MS` (proses mati di tengah panggilan) dikembalikan
 * ke OPEN dengan `lastError` dan event EXECUTE_FAILED oleh SYSTEM. Tulisannya MUNGKIN sudah masuk ke
 * backoffice; reevaluate berikutnya menutup kartu MATCHED_IN_BACKOFFICE bila memang sudah.
 * Bersyarat per baris (`updatedAt < cutoff` dan masih EXECUTING) supaya tidak mencuri klaim yang hidup.
 */
export async function releaseStaleExecuting(conversationId: string, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_CLAIM_MS)
  const rows = (await prisma.bookingAction.findMany({
    where: { conversationId, state: 'EXECUTING', updatedAt: { lt: cutoff } },
    select: { id: true, bookingId: true, proposedValue: true },
  })) ?? []
  let released = 0
  for (const r of rows) {
    const res = await prisma.bookingAction.updateMany({
      where: { id: r.id, state: 'EXECUTING', updatedAt: { lt: cutoff } },
      data: { state: 'OPEN', lastError: STALE_CLAIM_ERROR },
    })
    if (res?.count !== 1) continue
    released++
    await recordEvent(prisma, {
      conversationId, bookingId: r.bookingId, actionId: r.id, event: 'EXECUTE_FAILED', actor: 'SYSTEM',
      newValue: typeof r.proposedValue === 'string' ? r.proposedValue : null,
      reason: STALE_CLAIM_ERROR,
      backoffice: { interrupted: true },
    })
  }
  if (released > 0) console.error('releaseStaleExecuting: klaim basi dilepas', { conversationId, released })
  return released
}
