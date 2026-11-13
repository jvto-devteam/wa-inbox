/**
 * Gerbang rollout KHUSUS note Schedule (owner 2026-11-13). Sengaja terpisah dari `BOOKING_ACTIONS_ROLLOUT`: env itu
 * juga membuka ekstraksi aksi booking, terapkan-otomatis, dan permintaan data ke tamu, yang tidak ikut dibuka hanya
 * demi note.
 *
 * - `SCHEDULE_NOTE_ROLLOUT=all`: note ikut ke `bookings.note` untuk SEMUA percakapan ber-booking.
 * - selain itu: hanya percakapan uji/whitelist (`bookingAutomationAllowed`; bila `BOOKING_ACTIONS_ROLLOUT=all` ikut terbuka).
 * Sakelar utama `SCHEDULE_NOTE_SYNC_ENABLED` tetap berlaku di `sync.ts`.
 */
import { bookingAutomationAllowed, type GateConversation } from '@/lib/booking-actions/rollout'

export function scheduleNoteRolloutAll(): boolean {
  return process.env.SCHEDULE_NOTE_ROLLOUT?.trim().toLowerCase() === 'all'
}

export function scheduleNoteAllowed(conv: GateConversation): boolean {
  return scheduleNoteRolloutAll() || bookingAutomationAllowed(conv)
}
