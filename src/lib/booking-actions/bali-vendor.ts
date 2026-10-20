/**
 * Kabar "perubahan" ke vendor transport Bali sesudah CHANGE kelompok `BALI` berhasil ditulis (Task 11a).
 *
 * Tujuan dan saluran mengikuti legacy: `XenditController::sendBaliNotif` (origin/main:app/Http/Controllers/
 * thirdParty/XenditController.php:499) mengirim template `internal_bali_transport` lewat WaInboxClient ke
 * nomor vendor yang ditulis TETAP di kode (628155703072) -- bukan env, bukan baris DB. Di sini nomor yang sama
 * jadi default; `BALI_VENDOR_PHONE` boleh menimpanya tanpa deploy ulang. Nomor vendor tidak pernah dicatat.
 *
 * Pengiriman memakai `enqueueSystemTemplateSend` langsung (in-process, bukan HTTP ke API sendiri) dengan
 * template baru `internal_bali_transport_update` (perlu `scripts/seed-system-templates.ts --apply` di VPS).
 * Template tidak ada / dinonaktifkan / antrean gagal = kegagalan kirim, bukan galat.
 *
 * "Terkirim" berarti masuk antrean; kegagalan penyedia sesudahnya dipegang retry ladder outbound dan tidak
 * memicu push manual.
 *
 * Fire-and-forget dan TIDAK PERNAH melempar: perubahan booking sudah berlaku di backoffice. Gagal = event
 * `VENDOR_NOTICE_FAILED` + push ke admin supaya vendor dikabari manual. Isi pesan: kode booking, tanggal, pax,
 * titik+jam terbaru. Tanpa nama/HP/email pelanggan.
 *
 * Final review Important 6: kabar hanya dikirim bila booking yang diterima BENAR-BENAR memuat nilai yang baru
 * ditulis (`expected`, dicek `changeAlreadyApplied` per field). Penyegaran pasca-tulis yang gagal mengembalikan
 * data sebelum tulis -- vendor tidak boleh menerima titik/jam lama; itu jadi VENDOR_NOTICE_FAILED + push manual.
 * Jam yang tidak diketahui (null/''/'07:00', R2) ditulis "jam belum ada", bukan jam palsu -- kecuali jam itu
 * sendiri yang baru ditulis (mis. 07:00 sungguhan).
 */
import { prisma } from '@/lib/db'
import type { BookingData } from '@/lib/booking/client'
import { enqueueSystemTemplateSend } from '@/lib/system-templates/send'
import { notifyBookingAction } from '@/lib/push/send'
import { recordEvent } from './history'
import { bookingTimeKnown, changeAlreadyApplied } from './compare'
import { normalizeFieldValue, type FieldKey } from './fields'

export const BALI_UPDATE_TEMPLATE_KEY = 'internal_bali_transport_update'
/** Sama dengan nomor yang ditulis tetap di XenditController::sendBaliNotif (legacy). */
const LEGACY_VENDOR_PHONE = '628155703072'
export const VENDOR_FAILED_SUMMARY = 'Kabar ke vendor Bali gagal — kabari manual'

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  return t ? t : null
}

export const UNKNOWN_TIME_TEXT = 'jam belum ada'

export type WrittenValue = { field: FieldKey; value: string }

function describePoint(point: unknown, detail: unknown, time: unknown, timeKnown: boolean): string {
  const parts = [text(point), text(detail)].filter((p): p is string => p !== null)
  const base = parts.join(' - ')
  const at = timeKnown ? text(time) : null
  if (!base) return at ?? '-'
  return `${base} (${at ?? UNKNOWN_TIME_TEXT})`
}

/** Jam booking boleh ditampilkan bila diketahui (R2), atau bila nilai itu yang baru saja ditulis. */
function timeShown(field: 'pickup_time' | 'drop_time', raw: unknown, written: readonly WrittenValue[]): boolean {
  const value = typeof raw === 'string' ? raw : null
  if (bookingTimeKnown(value)) return true
  if (value === null) return false
  const norm = normalizeFieldValue(field, value)
  return written.some((w) => w.field === field && norm !== null && normalizeFieldValue(field, w.value) === norm)
}

export function buildVendorVariables(b: BookingData, written: readonly WrittenValue[] = []): Record<string, string> {
  const start = text(b.date?.start) ?? text(b.date?.start_ymd)
  const end = text(b.date?.end) ?? text(b.date?.end_ymd)
  const dates = start && end && start !== end ? `${start} - ${end}` : (start ?? end ?? '-')
  return {
    booking_code: text(b.id) ?? '-',
    travel_dates: dates,
    total_pax: typeof b.total_pax === 'number' && Number.isFinite(b.total_pax) ? String(b.total_pax) : '-',
    pickup: describePoint(b.pickup?.meeting_point, b.pickup?.meeting_point_value, b.pickup?.pickup_time, timeShown('pickup_time', b.pickup?.pickup_time, written)),
    drop: describePoint(b.dropoff?.drop_point, b.dropoff?.drop_point_value, b.dropoff?.drop_time, timeShown('drop_time', b.dropoff?.drop_time, written)),
  }
}

function vendorPhone(): string {
  const fromEnv = process.env.BALI_VENDOR_PHONE?.replace(/\D/g, '')
  return fromEnv ? fromEnv : LEGACY_VENDOR_PHONE
}

export async function notifyBaliVendor(input: {
  actionId: string
  conversationId: string
  bookingId: string | null
  /** bookingData sesudah penyegaran pasca-tulis. */
  booking: BookingData
  /** Default `bali_update:<actionId>`; pembatalan memakai `bali_revert:<actionId>` agar tidak dianggap duplikat. */
  idempotencyKey?: string
  /** Nilai transport yang baru ditulis; `booking` wajib sudah memuat semuanya, kalau tidak kabar tidak dikirim. */
  expected?: readonly WrittenValue[]
}): Promise<void> {
  const { actionId, conversationId, bookingId, booking } = input
  const expected = input.expected ?? []
  let sent = false
  let reason = 'unknown'
  if (!expected.every((e) => changeAlreadyApplied(e, booking))) {
    // Booking yang diterima belum memuat tulisan ini (penyegaran gagal/basi): jangan kabari data lama.
    reason = 'BOOKING_NOT_REFRESHED'
  } else {
    try {
      const result = await enqueueSystemTemplateSend({
        templateKey: BALI_UPDATE_TEMPLATE_KEY,
        to: { phone: vendorPhone() },
        variables: buildVendorVariables(booking, expected),
        // Satu eksekusi = satu kabar; kartu yang sama tidak pernah dieksekusi dua kali.
        idempotencyKey: input.idempotencyKey ?? `bali_update:${actionId}`,
      })
      if (result.ok) {
        sent = result.status !== 'CANCELLED'
        if (!sent) reason = 'CANCELLED'
      } else {
        reason = result.code
      }
    } catch (error) {
      reason = error instanceof Error ? error.name : 'unknown'
    }
  }
  if (sent) return

  console.error('notifyBaliVendor: kabar ke vendor gagal', { actionId, reason })
  try {
    await recordEvent(prisma, {
      conversationId, bookingId, actionId, event: 'VENDOR_NOTICE_FAILED', actor: 'SYSTEM', reason: `Kabar ke vendor Bali gagal (${reason})`,
    })
  } catch (error) {
    console.error('notifyBaliVendor: mencatat event gagal', { actionId, error: error instanceof Error ? error.name : 'unknown' })
  }
  try {
    const code = text(booking.id)
    await notifyBookingAction({ kind: 'EXECUTE_FAILED', conversationId, bookingCode: code, summary: VENDOR_FAILED_SUMMARY, actionId })
  } catch {
    console.error('notifyBaliVendor: push gagal', { actionId })
  }
}
