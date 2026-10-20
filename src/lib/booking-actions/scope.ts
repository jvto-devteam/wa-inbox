/**
 * Lingkup booking sebuah aksi: aksi yang `bookingId`-nya null atau sama dengan booking percakapan
 * SAAT INI yang dihitung (label "Permintaan perubahan", daftar kartu). Aksi booking lama tidak
 * pernah ditutup saat booking berganti, jadi tidak boleh ikut dihitung.
 */
export function currentBookingId(bookingData: unknown): string | null {
  if (typeof bookingData !== 'object' || bookingData === null || Array.isArray(bookingData)) return null
  const id = (bookingData as Record<string, unknown>).booking_id
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null
}

export function inCurrentBooking(row: { bookingId: string | null }, bookingId: string | null): boolean {
  return row.bookingId === null || row.bookingId === bookingId
}
