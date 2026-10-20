/**
 * Gerbang uji + rollout aksi booking (Ruling R25). CLAUDE.md §5: uji hanya ke nomor whitelist, tidak ke tamu
 * sungguhan -- padahal satu-satunya nomor uji (6282143403501) berawalan 62 dan, tidak seperti sandbox `isTest`,
 * PUNYA booking sungguhan. Satu modul ini dipakai SEMUA gerbang supaya aturannya tidak terpecah:
 *
 * - `BOOKING_ACTIONS_TEST_PHONES`: daftar nomor dipisah koma (bentuk bebas, dinormalisasi ke digit E.164 seperti
 *   `Contact.phone`). Percakapan dengan nomor ini diperlakukan seperti `isTest` di setiap gerbang: lolos gerbang
 *   nomor Indonesia. Lookup booking TETAP jalan untuk nomor ini (beda dengan sandbox, yang tidak punya booking).
 * - `BOOKING_ACTIONS_ROLLOUT`: `test` (bawaan bila kosong/tak dikenal) | `all`. Selama `test`, ekstraksi,
 *   terapkan-otomatis, dan pembuatan/pengiriman permintaan data HANYA untuk percakapan `isTest` atau nomor uji.
 *   Owner membuka `all` sesudah uji whitelist.
 *
 * Tombol manusia (Setujui/Tolak/Batalkan di kartu yang sudah ada) tidak digerbang di sini.
 */
import { isIndonesianNumber, normalizePhoneNumber } from '@/lib/phone'

export type BookingActionsRollout = 'test' | 'all'

export type GateConversation = { isTest?: boolean | null; phone: string | null | undefined }

export function bookingActionsRollout(): BookingActionsRollout {
  return process.env.BOOKING_ACTIONS_ROLLOUT?.trim().toLowerCase() === 'all' ? 'all' : 'test'
}

/** Nomor uji dari env, sudah dinormalisasi (digit, awalan 0 -> 62). Dibaca tiap panggilan: env bisa diubah tanpa build. */
export function bookingActionsTestPhones(): Set<string> {
  const raw = process.env.BOOKING_ACTIONS_TEST_PHONES ?? ''
  const out = new Set<string>()
  for (const part of raw.split(',')) {
    const phone = normalizePhoneNumber(part)
    if (phone) out.add(phone)
  }
  return out
}

/** Percakapan uji: sandbox `isTest` ATAU nomor di `BOOKING_ACTIONS_TEST_PHONES`. */
export function isBookingTestConversation(conv: GateConversation): boolean {
  if (conv.isTest) return true
  const phone = conv.phone ? normalizePhoneNumber(conv.phone) : null
  return phone !== null && bookingActionsTestPhones().has(phone)
}

/** Gerbang nomor Indonesia: true = dilewati (nomor 62), kecuali percakapan uji (R13 + R25). */
export function blockedByIndonesianGate(conv: GateConversation): boolean {
  return !isBookingTestConversation(conv) && isIndonesianNumber(conv.phone ?? null)
}

/** Rollout: otomatisasi (ekstraksi, terapkan-otomatis, permintaan data) boleh jalan untuk percakapan ini? */
export function bookingAutomationAllowed(conv: GateConversation): boolean {
  return bookingActionsRollout() === 'all' || isBookingTestConversation(conv)
}

/** Nomor uji PERTAMA di `BOOKING_ACTIONS_TEST_PHONES` (urutan env), atau null. */
export function firstBookingTestPhone(): string | null {
  return bookingActionsTestPhones().values().next().value ?? null
}
