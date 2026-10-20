/**
 * Kabar ke VENDOR KAOS sesudah ukuran kaos sebuah booking berubah lewat chat (permintaan owner 2026-10-20).
 *
 * Kenapa wa-inbox yang mengirim: jalur tulis yang kita pakai, legacy `UserBookingsController::updateTshirt`
 * (javavolcano-touroperator origin/main, app/Http/Controllers/UserBookingsController.php:711-750), hanya menyimpan
 * ukuran lalu `EcosystemSync::notify` (dispatch GitHub ke jvto-ekosistem) -- TIDAK mengabari vendor. Yang mengabari
 * vendor hanya new-backoffice saat admin menyunting booking di sana (`BookingController::notifyTshirtVendor`,
 * app/Http/Controllers/BookingController.php:2768), jadi tanpa modul ini vendor tidak pernah tahu.
 *
 * Tujuan mengikuti new-backoffice: `config('wa.tshirt_vendor_number')` = env `WA_TSHIRT_VENDOR_NUMBER`, default
 * 6281337844825 (new-backoffice config/wa.php:8). Di sini nomor yang sama jadi default; `TSHIRT_VENDOR_PHONE` boleh
 * menimpanya tanpa deploy ulang. Nomor vendor tidak pernah dicatat.
 *
 * Template BARU `internal_tshirt_update` (perlu `scripts/seed-system-templates.ts --apply` di VPS), bukan
 * `vendor_tshirt_size_update` milik new-backoffice: template itu memuat NAMA tamu, sedangkan kabar vendor dari
 * aksi booking tidak membawa data pribadi tamu (sama dengan vendor Bali). Isi: kode booking, tanggal, pax, ukuran.
 *
 * Pola dan aturan sama dengan `bali-vendor.ts`: in-process `enqueueSystemTemplateSend`, kunci idempotensi
 * `tshirt_update:<actionId>` (pembatalan `tshirt_revert:<actionId>`), kabar hanya bila booking segar pasca-tulis
 * BENAR-BENAR memuat ukuran yang ditulis, gagal = event VENDOR_NOTICE_FAILED + push EXECUTE_FAILED "kabari vendor kaos
 * manual". Fire-and-forget, tidak pernah melempar.
 */
import { prisma } from '@/lib/db'
import type { BookingData } from '@/lib/booking/client'
import { enqueueSystemTemplateSend } from '@/lib/system-templates/send'
import { notifyBookingAction } from '@/lib/push/send'
import { recordEvent } from './history'
import { changeAlreadyApplied } from './compare'
import { canonicalTshirtSizes } from './fields'

export const TSHIRT_UPDATE_TEMPLATE_KEY = 'internal_tshirt_update'
/** Sama dengan default `WA_TSHIRT_VENDOR_NUMBER` di new-backoffice (config/wa.php:8). */
const NEW_BACKOFFICE_VENDOR_PHONE = '6281337844825'
export const TSHIRT_VENDOR_FAILED_SUMMARY = 'Kabar ke vendor kaos gagal — kabari vendor kaos manual'

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  return t ? t : null
}

export function buildTshirtVendorVariables(b: BookingData, sizes: string): Record<string, string> {
  const start = text(b.date?.start) ?? text(b.date?.start_ymd)
  const end = text(b.date?.end) ?? text(b.date?.end_ymd)
  return {
    booking_code: text(b.id) ?? '-',
    travel_dates: start && end && start !== end ? `${start} - ${end}` : (start ?? end ?? '-'),
    total_pax: typeof b.total_pax === 'number' && Number.isFinite(b.total_pax) ? String(b.total_pax) : '-',
    sizes: canonicalTshirtSizes(sizes) ?? '-',
  }
}

function vendorPhone(): string {
  const fromEnv = process.env.TSHIRT_VENDOR_PHONE?.replace(/\D/g, '')
  return fromEnv ? fromEnv : NEW_BACKOFFICE_VENDOR_PHONE
}

export async function notifyTshirtVendor(input: {
  actionId: string
  conversationId: string
  bookingId: string | null
  /** bookingData sesudah penyegaran pasca-tulis. */
  booking: BookingData
  /** Ukuran yang baru ditulis; `booking` wajib sudah memuatnya. */
  sizes: string
  /** Default `tshirt_update:<actionId>`; pembatalan memakai `tshirt_revert:<actionId>`. */
  idempotencyKey?: string
}): Promise<void> {
  const { actionId, conversationId, bookingId, booking } = input
  let sent = false
  let reason = 'unknown'
  if (!changeAlreadyApplied({ field: 'tshirt_sizes', value: input.sizes }, booking)) {
    reason = 'BOOKING_NOT_REFRESHED'
  } else {
    try {
      const result = await enqueueSystemTemplateSend({
        templateKey: TSHIRT_UPDATE_TEMPLATE_KEY,
        to: { phone: vendorPhone() },
        variables: buildTshirtVendorVariables(booking, input.sizes),
        idempotencyKey: input.idempotencyKey ?? `tshirt_update:${actionId}`,
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

  console.error('notifyTshirtVendor: kabar ke vendor kaos gagal', { actionId, reason })
  try {
    await recordEvent(prisma, {
      conversationId, bookingId, actionId, event: 'VENDOR_NOTICE_FAILED', actor: 'SYSTEM', reason: `Kabar ke vendor kaos gagal (${reason})`,
    })
  } catch (error) {
    console.error('notifyTshirtVendor: mencatat event gagal', { actionId, error: error instanceof Error ? error.name : 'unknown' })
  }
  try {
    await notifyBookingAction({ kind: 'EXECUTE_FAILED', conversationId, bookingCode: text(booking.id), summary: TSHIRT_VENDOR_FAILED_SUMMARY, actionId })
  } catch {
    console.error('notifyTshirtVendor: push gagal', { actionId })
  }
}
