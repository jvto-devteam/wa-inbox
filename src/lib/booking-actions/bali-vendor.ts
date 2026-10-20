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
 */
import { prisma } from '@/lib/db'
import type { BookingData } from '@/lib/booking/client'
import { enqueueSystemTemplateSend } from '@/lib/system-templates/send'
import { notifyBookingAction } from '@/lib/push/send'
import { recordEvent } from './history'

export const BALI_UPDATE_TEMPLATE_KEY = 'internal_bali_transport_update'
/** Sama dengan nomor yang ditulis tetap di XenditController::sendBaliNotif (legacy). */
const LEGACY_VENDOR_PHONE = '628155703072'
export const VENDOR_FAILED_SUMMARY = 'Kabar ke vendor Bali gagal — kabari manual'

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  return t ? t : null
}

function describePoint(point: unknown, detail: unknown, time: unknown): string {
  const parts = [text(point), text(detail)].filter((p): p is string => p !== null)
  const base = parts.join(' - ')
  const at = text(time)
  if (!base) return at ?? '-'
  return at ? `${base} (${at})` : base
}

export function buildVendorVariables(b: BookingData): Record<string, string> {
  const start = text(b.date?.start) ?? text(b.date?.start_ymd)
  const end = text(b.date?.end) ?? text(b.date?.end_ymd)
  const dates = start && end && start !== end ? `${start} - ${end}` : (start ?? end ?? '-')
  return {
    booking_code: text(b.id) ?? '-',
    travel_dates: dates,
    total_pax: typeof b.total_pax === 'number' && Number.isFinite(b.total_pax) ? String(b.total_pax) : '-',
    pickup: describePoint(b.pickup?.meeting_point, b.pickup?.meeting_point_value, b.pickup?.pickup_time),
    drop: describePoint(b.dropoff?.drop_point, b.dropoff?.drop_point_value, b.dropoff?.drop_time),
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
}): Promise<void> {
  const { actionId, conversationId, bookingId, booking } = input
  let sent = false
  let reason = 'unknown'
  try {
    const result = await enqueueSystemTemplateSend({
      templateKey: BALI_UPDATE_TEMPLATE_KEY,
      to: { phone: vendorPhone() },
      variables: buildVendorVariables(booking),
      // Satu eksekusi = satu kabar; kartu yang sama tidak pernah dieksekusi dua kali.
      idempotencyKey: `bali_update:${actionId}`,
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
