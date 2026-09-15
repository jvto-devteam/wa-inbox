// Nama dari data booking, ditampilkan di samping nama kontak WhatsApp -- operator sering
// mengenal pelanggan dari nama yang dipakainya saat booking (mis. nama lengkap di tiket),
// yang bisa berbeda dari nama kontak WhatsApp (mis. nama panggilan yang tersimpan di ponsel
// operator). `bookingData` di sini sengaja `unknown`, bukan `BookingData`: file ini dipakai
// dari komponen klien (ConversationListItem, ThreadView, ContactPanel), dan `BookingData`
// hidup di `src/lib/booking/client.ts` yang menyentuh prisma di runtime -- mengimpornya di
// sini (bahkan hanya sebagai tipe) akan mudah longgar menjadi impor nilai di kemudian hari.
// `unknown` + narrowing manual menjaga batas server/klien itu tanpa perlu diingat setiap kali.

/**
 * Nama tamu dari data booking (`bookingData.guest`), atau `null` kalau tidak ada -- baik
 * karena `bookingData` itu sendiri kosong, `guest` bukan string, atau `guest` kosong setelah
 * di-trim (mis. `"   "`).
 */
export function bookingGuestName(bookingData: unknown): string | null {
  if (typeof bookingData !== 'object' || bookingData === null) return null
  const guest = (bookingData as Record<string, unknown>).guest
  if (typeof guest !== 'string') return null
  const trimmed = guest.trim()
  return trimmed ? trimmed : null
}

/**
 * Nama yang ditampilkan: nama kontak (atau `fallback` -- biasanya nomor telepon -- kalau nama
 * kontak kosong), ditambah nama booking dalam kurung KALAU nama booking ada dan berbeda dari
 * nama dasarnya (dibandingkan tanpa peduli besar/kecil huruf). Kalau sama, cukup sekali saja --
 * mengulang nama yang identik dalam kurung tidak menambah informasi apa pun.
 */
export function contactDisplayName(
  contactName: string | null,
  guestName: string | null,
  fallback: string
): string {
  const base = contactName?.trim() || fallback
  if (guestName && guestName.trim().toLowerCase() !== base.toLowerCase()) {
    return `${base} (${guestName.trim()})`
  }
  return base
}
