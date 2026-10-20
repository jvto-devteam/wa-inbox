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
 * - DATA SEGAR SEBELUM MENULIS (final review Critical 1): `bookingData` tersimpan bisa ~24 jam basi, padahal
 *   update-pickup/update-drop mengirim ulang titik + detail + jam -- nilai yang tidak disentuh diambil dari data
 *   itu, jadi data basi diam-diam membalik suntingan ops/tamu (mis. jam). Maka sebelum klaim, Setujui dan
 *   Batalkan selalu mencari booking ke API (`lookupBookingResult`, pola `sendDataRequest`): gagal/timeout = 503
 *   tanpa menulis apa pun; booking_id lain atau booking hilang = 409; data segar disimpan lalu
 *   `reevaluateBookingActions`; nilainya sudah ada di backoffice = kartu ditutup RESOLVED/MATCHED_IN_BACKOFFICE
 *   tanpa menulis (409). Form tulis dirakit dari data segar itu (`writeBookingChange(..., baseBooking)`), dan cek
 *   "nilai masih milik kita" pada Batalkan juga memakainya. Percakapan sandbox `isTest` tidak dicari (tidak
 *   punya booking, sama dengan data-requests); nomor uji R25 punya booking dan tetap dicari.
 * - Sesudah eksekusi, fakta aktif field itu yang lebih tua dari pesan sumber kartu diberi `supersededAt`
 *   (`supersedeOlderFacts`, final review Important 5).
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
 *   tanpa menunggu dan tanpa mengubah respons; gagal kirim = event VENDOR_NOTICE_FAILED + push admin. Kabar
 *   hanya dikirim bila booking hasil penyegaran pasca-tulis BENAR-BENAR memuat nilai yang ditulis (`expected`);
 *   penyegaran gagal = kabar tidak dikirim, VENDOR_NOTICE_FAILED + push (final review Important 6).
 * - Task 11b: `executeBookingAction` dipakai bersama oleh `autoApplyIfAllowed` (actor SYSTEM, closedReason AUTO_APPLIED);
 *   `revertBookingAction` membalik aksi EXECUTED ("Batalkan"). Event EXECUTED memuat `backoffice.batch` (kartu yang ditulis
 *   bersama) agar pembatalan membalik semuanya.
 * - Kabar ke tamu (owner 2026-10-20, `guest-notice.ts`): setiap eksekusi yang berhasil (Setujui manual DAN otomatis)
 *   memicu SATU WhatsApp "Noted ... sudah diperbarui" berisi field yang benar-benar ditulis + tautan portal, sesudah
 *   transaksi, tanpa menunggu dan tanpa mengubah respons. "Batalkan" tidak mengabari tamu.
 * - Kabar vendor kaos (`tshirt-vendor.ts`): eksekusi yang menulis `tshirt_sizes` -> satu kabar `tshirt_update:<id>`;
 *   pembatalannya -> `tshirt_revert:<id>`. Jalur legacy `updateTshirt` sendiri tidak mengabari vendor.
 * - Log hanya id/kind/status: tanpa teks pelanggan dan tanpa token url booking.
 *
 * Pelepasan klaim basi dipanggil dari GET panel kartu (`/api/conversations/[id]/booking-actions`) dan
 * dari `POST /api/summary-items/tick` (tiap 5 menit, semua percakapan, satu kueri).
 */
import type { Prisma } from '@prisma/client'
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
import { lookupBookingResult, type BookingData, type BookingLookup } from '@/lib/booking/client'
import { changeAlreadyApplied } from './compare'
import { supersedeOlderFacts } from './fact-supersede'
import { normalizeFieldValue, parseTshirtSizes, readBookingField, type FieldKey } from './fields'
import { recordEvent, type BookingEventActor } from './history'
import { notifyBaliVendor } from './bali-vendor'
import { notifyBookingAction } from '@/lib/push/send'
import { notifyGuestOfUpdate, type GuestNoticeItem } from './guest-notice'
import { notifyTshirtVendor } from './tshirt-vendor'
import { currentBookingId } from './scope'
import { reevaluateBookingActions } from './store'
import { canExecuteField, canRevertBatch, canRevertValue, companionFields, detailFieldOf } from './view'

/** Klaim EXECUTING yang lebih tua dari ini dianggap proses mati di tengah. Tulis terlama ~10 s + segar. */
export const STALE_CLAIM_MS = 2 * 60 * 1000
export const BOOKING_CHANGED_ERROR = 'Booking di percakapan ini berubah sejak kartu dibuat. Periksa ulang.'
export const STALE_CLAIM_ERROR = 'Eksekusi terputus sebelum selesai. Periksa booking di backoffice sebelum menyetujui lagi.'
export const BOOKING_LOOKUP_ERROR = 'Data booking belum bisa diperiksa ke backoffice. Tidak ada yang ditulis; coba lagi sebentar lagi.'
export const ALREADY_APPLIED_ERROR = 'Booking di backoffice sudah memuat nilai ini. Kartu ditutup tanpa menulis.'
const UNEXPECTED_ERROR = 'Eksekusi berhenti karena galat tak terduga. Coba lagi.'
const MAX_ERROR = 500
const TRANSPORT_FIELDS: ReadonlySet<FieldKey> = new Set<FieldKey>([
  'pickup_point', 'pickup_detail', 'pickup_time', 'drop_point', 'drop_detail', 'drop_time',
])

export type ExecuteResult =
  | { status: 200; body: { ok: true; state: 'EXECUTED'; executed: string[]; written: WrittenPart[] } }
  | { status: 400 | 404 | 409 | 502 | 503; body: { error: string } }

type Included = { id: string; field: FieldKey; value: string; oldValue: string | null; sourceMessageId?: string | null }
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

type Fresh = { ok: true; booking: BookingData } | { ok: false; status: 409 | 503; error: string }

/**
 * Booking SEGAR untuk menulis (Critical 1). Tidak pernah melempar ke pemanggil untuk galat API: lookup
 * gagal = 503 dan tidak ada yang ditulis. Data yang ditemukan selalu disimpan (lalu `reevaluate`), juga bila
 * booking_id-nya berbeda -- itu hanya cache kita yang menyusul, bukan tulisan ke backoffice.
 */
async function freshBookingForWrite(conversationId: string, bookingId: string | null, now: Date): Promise<Fresh> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { bookingData: true, isTest: true, contact: { select: { phone: true } } },
  })
  const cached = asBooking(conv?.bookingData)
  if (!conv || !cached || bookingId === null || currentBookingId(cached) !== bookingId) {
    return { ok: false, status: 409, error: BOOKING_CHANGED_ERROR }
  }
  // Sandbox `isTest` tidak punya booking untuk dicari (nomor sentinel; lihat ensureFreshBookingData).
  if (conv.isTest) return { ok: true, booking: cached }
  const phone = conv.contact?.phone ?? null
  if (!phone) return { ok: false, status: 503, error: BOOKING_LOOKUP_ERROR }
  let lookup: BookingLookup
  try {
    lookup = await lookupBookingResult(phone)
  } catch {
    lookup = { status: 'error' }
  }
  if (lookup.status === 'error') return { ok: false, status: 503, error: BOOKING_LOOKUP_ERROR }
  // Jawaban sah "tidak ada booking": jangan menulis; penyegaran berkala yang mengurus cache-nya.
  if (lookup.status === 'not_found') return { ok: false, status: 409, error: BOOKING_CHANGED_ERROR }
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { bookingData: lookup.data as Prisma.InputJsonValue, bookingCheckedAt: now },
  })
  await reevaluate(conversationId)
  if (currentBookingId(lookup.data) !== bookingId) return { ok: false, status: 409, error: BOOKING_CHANGED_ERROR }
  return { ok: true, booking: lookup.data }
}

/** OPEN -> RESOLVED/MATCHED_IN_BACKOFFICE tanpa menulis (bersyarat OPEN; `reevaluate` mungkin sudah menutupnya). */
async function closeMatched(action: { id: string; conversationId: string; bookingId: string | null }, value: string, now: Date): Promise<void> {
  const res = await prisma.bookingAction.updateMany({
    where: { id: action.id, state: 'OPEN' },
    data: { state: 'RESOLVED', closedReason: 'MATCHED_IN_BACKOFFICE', closedAt: now, lastError: null },
  })
  if (res?.count === 1) {
    await recordEvent(prisma, {
      conversationId: action.conversationId, bookingId: action.bookingId, actionId: action.id,
      event: 'RESOLVED', actor: 'SYSTEM', newValue: value, reason: 'MATCHED_IN_BACKOFFICE',
    })
  }
  broadcast({ type: 'booking-actions.changed', conversationId: action.conversationId })
}

/** Nilai transport yang ditulis patch ini (untuk cek kabar vendor Bali). */
function writtenTransport(patch: BookingPatch): Array<{ field: FieldKey; value: string }> {
  const out: Array<{ field: FieldKey; value: string }> = []
  for (const f of TRANSPORT_FIELDS) {
    const v = patch[f as StringPatchKey]
    if (typeof v === 'string') out.push({ field: f, value: v })
  }
  return out
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

/**
 * Inti "Setujui". Dua pemanggil, SATU jalur: PATCH `op: execute` (aktor ACCOUNT, `closedReason` EXECUTED) dan
 * `autoApplyIfAllowed` (aktor SYSTEM tanpa akun, `closedReason` AUTO_APPLIED; Task 11b). Perbedaannya hanya
 * siapa yang tercatat -- klaim, penggabungan titik<->detail, penulisan, event, dan pelepasan klaim identik.
 */
export async function executeBookingAction(input: {
  actionId: string
  accountId: string | null
  actor?: BookingEventActor
  closedReason?: 'EXECUTED' | 'AUTO_APPLIED'
  /** true = kabar ke tamu diserahkan ke pemanggil (terapkan-otomatis menggabungkan satu kabar per ekstraksi). */
  deferGuestNotice?: boolean
  value?: string
  detail?: string
  now?: Date
}): Promise<ExecuteResult> {
  const { actionId, accountId } = input
  const actor: BookingEventActor = input.actor ?? 'ACCOUNT'
  const closedReason = input.closedReason ?? 'EXECUTED'
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
  const bookingId = action.bookingId
  if (bookingId === null) return fail(409, BOOKING_CHANGED_ERROR)

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

  // Data booking segar sebelum klaim (Critical 1): form tulis dan nilai lama dirakit dari sini, bukan dari cache.
  const fresh = await freshBookingForWrite(conversationId, bookingId, claimAt)
  if (!fresh.ok) return fail(fresh.status, fresh.error)
  const booking = fresh.booking
  const alreadyApplied = changeAlreadyApplied({ field, value: finalValue }, booking) &&
    (detail === null || detailField === null || changeAlreadyApplied({ field: detailField, value: detail }, booking))
  if (alreadyApplied) {
    await closeMatched(action, finalValue, claimAt)
    return fail(409, ALREADY_APPLIED_ERROR)
  }

  // 2-4. Klaim aksi ini (+ koreksi) dan kartu pendamping sisi yang sama (R17/R20) dalam satu transaksi.
  const included = await prisma.$transaction(async (tx) => {
    const claimed = await tx.bookingAction.updateMany({
      where: { id: actionId, state: 'OPEN' },
      data: { state: 'EXECUTING', claimedAt: claimAt, lastError: null, ...(corrected ? { proposedValue: finalValue } : {}) },
    })
    if (claimed.count === 0) return null
    if (corrected) {
      await recordEvent(tx, {
        conversationId, bookingId, actionId, event: 'CORRECTED', actor, accountId,
        oldValue: proposed, newValue: finalValue,
      })
    }
    const list: Included[] = [{ id: actionId, field, value: finalValue, oldValue: readBookingField(booking, field), sourceMessageId: action.sourceMessageId }]
    const others = companionFields(field)
    if (others.length > 0) {
      const rows = (await tx.bookingAction.findMany({
        where: { conversationId, bookingId, type: 'CHANGE', state: 'OPEN', field: { in: others } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, field: true, proposedValue: true, sourceMessageId: true },
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
            conversationId, bookingId, actionId: row.id, event: 'CORRECTED', actor, accountId,
            oldValue: row.proposedValue, newValue: override,
          })
        }
        list.push({ id: row.id, field: f, value: override ?? row.proposedValue, oldValue: readBookingField(booking, f), sourceMessageId: row.sourceMessageId })
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
      result = await writeBookingChange(bookingId, patch, conversationId, booking)
    } catch (error) {
      // Klien sendiri tidak melempar; ini sabuk pengaman (mis. DB gagal sebelum permintaan).
      console.error('executeBookingAction: writeBookingChange melempar', { actionIds: ids, error: error instanceof Error ? error.name : 'unknown' })
      result = { status: 'error', kind: 'backoffice', httpStatus: 0, error: 'Gagal menulis ke backoffice', written: [] }
    }

    // 6. Sukses.
    if (result.status === 'ok') {
      writeSucceeded = true
      const written = result.written
      // Task 11b: "Batalkan" menulis balik `oldValue` event ini. `batch` = kartu yang ditulis bersama (R17), dan
      // `previousDetail` = detail lama yang ditimpa lewat isian detail tanpa kartu pendamping.
      const previousDetail = detail !== null && detailField !== null && !included.some((a) => a.field === detailField)
        ? { [detailField]: readBookingField(booking, detailField) }
        : null
      await prisma.$transaction(async (tx) => {
        for (const a of included) {
          await tx.bookingAction.updateMany({
            where: { id: a.id, state: 'EXECUTING', claimedAt: claimAt },
            data: { state: 'EXECUTED', closedReason, closedById: accountId, closedAt: new Date(), claimedAt: null, lastError: null },
          })
          // Event selalu ditulis: perubahan SUDAH ada di backoffice, apa pun hasil update di atas.
          await recordEvent(tx, {
            conversationId, bookingId, actionId: a.id, event: 'EXECUTED', actor, accountId,
            oldValue: a.oldValue, newValue: a.value,
            backoffice: { written, httpStatus: 200, batch: ids, ...(previousDetail ? { previousDetail } : {}) },
          })
        }
      })
      settled = true
      // Important 5: fakta lama field yang baru ditulis tidak boleh jadi MISMATCH palsu. Di luar transaksi di atas:
      // kegagalannya tidak boleh membatalkan catatan EXECUTED (tulisan sudah masuk backoffice).
      await supersedeFactsAfterWrite(conversationId, bookingId, included, new Date())
      await reevaluate(conversationId)
      broadcast({ type: 'booking-actions.changed', conversationId })
      // Task 11a: kelompok BALI -> kabari vendor transport Bali sekali. Fire-and-forget; tidak mengubah respons.
      // Gate ganda: tier BALI DAN minimal satu field transport benar-benar ditulis (kartu + pendamping).
      // Tier saja tidak cukup: changeGroup memberi BALI pada semua field non-HEAVY, termasuk kaos/catatan.
      // `expected`: kabar hanya dikirim bila booking segar pasca-tulis memuat nilai-nilai ini (Important 6).
      if (action.tier === 'BALI' && included.some((a) => TRANSPORT_FIELDS.has(a.field))) {
        void notifyBaliVendor({ actionId, conversationId, bookingId, booking: result.booking, expected: writtenTransport(patch) }).catch(() => undefined)
      }
      // Ukuran kaos berubah -> vendor kaos dikabari sekali (legacy updateTshirt tidak mengabari vendor).
      const tshirt = included.find((a) => a.field === 'tshirt_sizes')
      if (tshirt) {
        void notifyTshirtVendor({ actionId, conversationId, bookingId, booking: result.booking, sizes: tshirt.value }).catch(() => undefined)
      }
      // Tamu dikabari sekali per eksekusi (gerbang: sumber INBOUND, rollout, jendela 24 jam -- di guest-notice.ts).
      // Terapkan-otomatis menunda: `autoApplyCreated` mengirim SATU kabar untuk semua kartu dari satu ekstraksi.
      if (!input.deferGuestNotice) {
        const items: GuestNoticeItem[] = included.map((a) => ({
          actionId: a.id, sourceMessageId: a.sourceMessageId ?? null, written: [{ field: a.field, value: a.value }],
        }))
        if (detail !== null && detailField !== null && !included.some((a) => a.field === detailField)) {
          items[0] = { ...items[0], written: [...items[0].written, { field: detailField, value: detail }] }
        }
        void notifyGuestOfUpdate({ conversationId, bookingId, accountId, booking, items }).catch(() => undefined)
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
          conversationId, bookingId, actionId: a.id, event: 'EXECUTE_FAILED', actor, accountId,
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

export type RevertResult =
  | { status: 200; body: { ok: true; state: 'REVERTED'; reverted: string[]; hint?: string } }
  | { status: 400 | 404 | 409 | 502 | 503; body: { error: string } }

export const REVERT_CHANGED_ERROR = 'Nilai di booking sudah berubah sejak diterapkan. Periksa di backoffice.'
const REVERT_NO_OLD_ERROR = 'Nilai sebelumnya kosong atau tidak diketahui. Ubah di backoffice.'
const failRevert = (status: 400 | 404 | 409 | 502 | 503, error: string): RevertResult => ({ status, body: { error } })

function plainText(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

function batchOf(backoffice: unknown, fallback: string): string[] {
  const batch = typeof backoffice === 'object' && backoffice !== null && !Array.isArray(backoffice)
    ? (backoffice as Record<string, unknown>).batch
    : undefined
  const ids = Array.isArray(batch) ? batch.filter((x): x is string => typeof x === 'string') : []
  return ids.includes(fallback) ? ids : [fallback, ...ids]
}

/**
 * "Batalkan" (Task 11b): menulis balik `oldValue` event EXECUTED sebuah aksi (dan kartu yang ditulis
 * bersamanya, `backoffice.batch`) lewat `writeBookingChange` -- jalur tulis yang sama dengan "Setujui".
 *
 * Konservatif: hanya aksi EXECUTED; booking yang dituju harus masih sama; nilai booking SEKARANG harus masih
 * nilai yang kita tulis (kalau orang lain sudah mengubahnya, membalik akan menimpa pekerjaan mereka -> 409);
 * nilai lama kosong/jam palsu tidak ditulis. Gagal = tetap EXECUTED + event EXECUTE_FAILED. Sukses =
 * state/closedReason REVERTED lewat update bersyarat `state: 'EXECUTED'` (klik ganda: hanya satu yang
 * mencatat event; tulisan ganda bernilai sama, jadi tidak berbahaya). `store.ts#loadBlocked` memblokir nilai
 * yang dibatalkan supaya ekstraksi berikutnya tidak mengusulkannya lagi. Vendor (Bali: `bali_revert:<id>`, kaos:
 * `tshirt_revert:<id>`) dikabari nilai yang dikembalikan; TAMU tidak dikabari -- admin yang mengurus komunikasinya.
 */
export async function revertBookingAction(input: { actionId: string; accountId: string; now?: Date }): Promise<RevertResult> {
  const { actionId, accountId } = input
  const action = await prisma.bookingAction.findUnique({ where: { id: actionId } })
  if (!action) return failRevert(404, 'Tindakan tidak ditemukan')
  if (action.type !== 'CHANGE') return failRevert(400, 'Operasi tidak cocok dengan jenis tindakan')
  if (action.state !== 'EXECUTED') return failRevert(409, 'Hanya perubahan yang sudah diterapkan yang bisa dibatalkan')
  if (!writeConfigured()) return failRevert(503, 'Jalur tulis backoffice belum dikonfigurasi')

  const conversationId = action.conversationId
  const bookingId = action.bookingId
  if (bookingId === null) return failRevert(409, BOOKING_CHANGED_ERROR)

  const mainEvents = (await prisma.bookingActionEvent.findMany({
    where: { actionId, event: 'EXECUTED' },
    orderBy: { createdAt: 'desc' },
    take: 1,
  })) ?? []
  const mainEvent = mainEvents[0]
  if (!mainEvent) return failRevert(409, 'Riwayat penerapan tidak ditemukan')
  const batchIds = batchOf(mainEvent.backoffice, actionId)

  const members = (await prisma.bookingAction.findMany({
    where: { id: { in: batchIds }, state: 'EXECUTED', type: 'CHANGE' },
    select: { id: true, field: true },
  })) ?? []
  const events = (await prisma.bookingActionEvent.findMany({
    where: { actionId: { in: batchIds }, event: 'EXECUTED' },
    orderBy: { createdAt: 'desc' },
  })) ?? []

  const included: Included[] = []
  for (const m of members) {
    const field = m.field as FieldKey
    const ev = events.find((e) => e.actionId === m.id)
    if (!ev || !canExecuteField(field)) return failRevert(409, 'Riwayat penerapan tidak ditemukan')
    const wasValue = plainText(ev.newValue)
    const oldValue = plainText(ev.oldValue)
    if (wasValue === null || oldValue === null) return failRevert(400, REVERT_NO_OLD_ERROR)
    if (!canRevertValue(field, oldValue)) return failRevert(400, REVERT_NO_OLD_ERROR)
    // `value` = yang akan ditulis (nilai lama); `oldValue` = yang sekarang di booking (untuk catatan event).
    included.push({ id: m.id, field, value: oldValue, oldValue: wasValue })
  }
  if (!included.some((a) => a.id === actionId)) return failRevert(409, 'Tindakan sudah ditutup')

  const prevRaw = typeof mainEvent.backoffice === 'object' && mainEvent.backoffice !== null && !Array.isArray(mainEvent.backoffice)
    ? (mainEvent.backoffice as Record<string, unknown>).previousDetail
    : undefined
  if (!canRevertBatch(included.map((a) => ({ field: a.field, oldValue: a.value })), prevRaw)) {
    return failRevert(400, REVERT_NO_OLD_ERROR)
  }

  // Critical 1: "nilai masih milik kita" dan form tulis dari data SEGAR, bukan cache. Sesudah validasi murni
  // di atas supaya permintaan yang pasti ditolak tidak memanggil API booking.
  const fresh = await freshBookingForWrite(conversationId, bookingId, input.now ?? new Date())
  if (!fresh.ok) return failRevert(fresh.status, fresh.error)
  const booking = fresh.booking
  for (const a of included) {
    if (!changeAlreadyApplied({ field: a.field, value: a.oldValue ?? '' }, booking)) return failRevert(409, REVERT_CHANGED_ERROR)
  }
  const patch = buildPatch(included)
  const prev = typeof mainEvent.backoffice === 'object' && mainEvent.backoffice !== null && !Array.isArray(mainEvent.backoffice)
    ? (mainEvent.backoffice as Record<string, unknown>).previousDetail
    : undefined
  if (typeof prev === 'object' && prev !== null && !Array.isArray(prev)) {
    for (const key of ['pickup_detail', 'drop_detail'] as const) {
      const v = plainText((prev as Record<string, unknown>)[key])
      if (v !== null && patch[key] === undefined) patch[key] = v
    }
  }
  const ids = included.map((a) => a.id)

  let result: WriteResult
  try {
    result = await writeBookingChange(bookingId, patch, conversationId, booking)
  } catch (error) {
    console.error('revertBookingAction: writeBookingChange melempar', { actionIds: ids, error: error instanceof Error ? error.name : 'unknown' })
    result = { status: 'error', kind: 'backoffice', httpStatus: 0, error: 'Gagal menulis ke backoffice', written: [] }
  }

  if (result.status !== 'ok') {
    const partial = result.written.length > 0
    const reason = clean(`Batalkan gagal${partial ? ` (sebagian tertulis: ${result.written.join(', ')})` : ''}: ${result.error}`)
    console.error('revertBookingAction: gagal', { actionIds: ids, kind: result.kind, httpStatus: result.httpStatus, written: result.written })
    await prisma.$transaction(async (tx) => {
      for (const a of included) {
        await recordEvent(tx, {
          conversationId, bookingId, actionId: a.id, event: 'EXECUTE_FAILED', actor: 'ACCOUNT', accountId,
          oldValue: a.oldValue, newValue: a.value, reason,
          backoffice: { written: result.written, httpStatus: result.httpStatus, kind: result.kind, revert: true, ...(partial ? { partial: true } : {}) },
        })
      }
    })
    if (partial) await reevaluate(conversationId)
    broadcast({ type: 'booking-actions.changed', conversationId })
    return failRevert(STATUS_BY_KIND[result.kind], responseError(result))
  }

  const reverted = await prisma.$transaction(async (tx) => {
    const done: string[] = []
    for (const a of included) {
      const res = await tx.bookingAction.updateMany({
        where: { id: a.id, state: 'EXECUTED' },
        data: { state: 'REVERTED', closedReason: 'REVERTED', closedById: accountId, closedAt: new Date() },
      })
      if (res.count !== 1) continue
      await recordEvent(tx, {
        conversationId, bookingId, actionId: a.id, event: 'REVERTED', actor: 'ACCOUNT', accountId,
        oldValue: a.oldValue, newValue: a.value, backoffice: { written: result.written, httpStatus: 200, batch: ids },
      })
      done.push(a.id)
    }
    return done
  })
  await reevaluate(conversationId)
  broadcast({ type: 'booking-actions.changed', conversationId })
  // Klik ganda: yang kalah balapan tidak mencatat apa pun (tulisan nilai-sama sudah terjadi, idempoten).
  if (!reverted.includes(actionId)) return failRevert(409, 'Tindakan sudah dibatalkan')
  // Vendor Bali sudah dikabari nilai baru saat diterapkan: kabari lagi bahwa dibalik. Kunci idempotensi sendiri.
  if (action.tier === 'BALI' && included.some((a) => TRANSPORT_FIELDS.has(a.field))) {
    void notifyBaliVendor({
      actionId, conversationId, bookingId, booking: result.booking, idempotencyKey: `bali_revert:${actionId}`, expected: writtenTransport(patch),
    }).catch(() => undefined)
  }
  // Vendor kaos sudah dikabari ukuran baru: kabari ukuran yang dikembalikan. Tamu TIDAK dikabari (admin yang mengurus).
  const tshirt = included.find((a) => a.field === 'tshirt_sizes')
  if (tshirt) {
    void notifyTshirtVendor({
      actionId, conversationId, bookingId, booking: result.booking, sizes: tshirt.value, idempotencyKey: `tshirt_revert:${actionId}`,
    }).catch(() => undefined)
  }
  // Tamu sudah menerima "booking sudah diperbarui" untuk perubahan ini: admin harus mengabarinya bahwa dibatalkan.
  if (await guestWasNotified(ids)) {
    void Promise.resolve(notifyBookingAction({
      kind: 'GUEST_NOTICE_FAILED', conversationId, bookingCode: bookingCodeOf(result.booking), summary: GUEST_REVERT_SUMMARY, actionId, tagSuffix: 'guest-revert',
    })).catch(() => undefined)
    return { status: 200, body: { ok: true, state: 'REVERTED', reverted, hint: GUEST_REVERT_HINT } }
  }
  return { status: 200, body: { ok: true, state: 'REVERTED', reverted } }
}

export const GUEST_REVERT_SUMMARY = 'Kabari tamu manual — perubahan dibatalkan'
export const GUEST_REVERT_HINT = 'Tamu sudah dikabari perubahan ini lewat WhatsApp. Kabari tamu bahwa perubahan dibatalkan.'

async function guestWasNotified(ids: string[]): Promise<boolean> {
  try {
    const row = await prisma.bookingActionEvent.findFirst({ where: { actionId: { in: ids }, event: 'GUEST_NOTICE_SENT' }, select: { id: true } })
    return Boolean(row)
  } catch {
    return false
  }
}

function bookingCodeOf(b: BookingData): string | null {
  return typeof b.id === 'string' && b.id.trim() ? b.id.trim() : null
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

async function supersedeFactsAfterWrite(conversationId: string, bookingId: string, included: Included[], now: Date): Promise<void> {
  for (const a of included) {
    try {
      await supersedeOlderFacts(prisma, { conversationId, bookingId, field: a.field, sourceMessageId: a.sourceMessageId ?? null, now })
    } catch (error) {
      console.error('executeBookingAction: menandai fakta lama gagal', { actionId: a.id, error: error instanceof Error ? error.name : 'unknown' })
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
