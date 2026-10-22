/**
 * Data booking ringkas untuk prompt ringkasan chat (owner 2026-10-22): supaya "poin penting" tamu yang sudah booking
 * tidak mengulang data yang sudah tercatat, dan hanya menulis perbedaan/tambahan ("jemput 10.00 (booking: 07.00)").
 *
 * Daftar putih, seperti `bookingContextForLLM` di ekstraksi aksi booking: kode, paket, durasi, tanggal, pax, jemput,
 * antar, ukuran kaos. TIDAK PERNAH keuangan, riwayat bayar, kontak, email, atau detail tamu. Jam `07:00` adalah jam
 * kosong dari backoffice (R2), jadi ditulis "jam belum ada". Murni.
 */
import type { BookingData } from '@/lib/booking/client'
import { readBookingField } from '@/lib/booking-actions/fields'

function time(value: string | null): string {
  return value === null || value === '' || value === '07:00' ? 'jam belum ada' : value
}

function side(point: string | null, detail: string | null, at: string | null): string | null {
  if (point === null && detail === null) return null
  return [point, detail, time(at)].filter((p): p is string => p !== null && p !== '').join(' · ')
}

export function bookingContextForReview(booking: BookingData | null | undefined): string | null {
  if (!booking || typeof booking !== 'object') return null
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const start = text(booking.date?.start_ymd)
  const end = text(booking.date?.end_ymd)
  const lines = [
    ['Kode', text(booking.id)],
    ['Paket', text(booking.package)],
    ['Durasi', text(booking.duration)],
    ['Tanggal', start ? (end && end !== start ? `${start} s/d ${end}` : start) : null],
    ['Pax', readBookingField(booking, 'total_pax')],
    ['Jemput', side(readBookingField(booking, 'pickup_point'), readBookingField(booking, 'pickup_detail'), readBookingField(booking, 'pickup_time'))],
    ['Antar', side(readBookingField(booking, 'drop_point'), readBookingField(booking, 'drop_detail'), readBookingField(booking, 'drop_time'))],
    ['Kaos', readBookingField(booking, 'tshirt_sizes')],
  ].filter((l): l is [string, string] => l[1] !== null)
  return lines.length > 0 ? lines.map(([k, v]) => `- ${k}: ${v}`).join('\n') : null
}
