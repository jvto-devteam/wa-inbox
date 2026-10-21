/**
 * Short link portal booking `https://jvto.me/b/<url_short>` untuk kabar ke tamu (owner 2026-10-21: kabar
 * "sudah diperbarui" masih memakai tautan my-booking panjang). API booking-overview new-backoffice belum memuat
 * `url_short`, jadi kodenya DIHITUNG ULANG dari `bookings.url` -- rumus yang sama dengan
 * `App\Support\BookingShortUrl::candidate` (new-backoffice dan javavolcano-touroperator, disalin identik):
 *   percobaan 0 = md5(url), percobaan n = md5(url + '#' + n); 14 hex pertama -> base62 -> pad kiri '0' jadi 10.
 *
 * Percobaan berikutnya hanya dipakai PHP bila kodenya sudah dimiliki booking lain, jadi kode hasil hitungan bisa
 * milik tamu LAIN. Karena itu setiap kandidat DIVERIFIKASI ke legacy `GET /bookings/short/{code}` (-> `{ url }`)
 * dan hanya dipakai bila url-nya sama persis dengan url booking ini. 404 pada kandidat = kode itu belum dimiliki
 * siapa pun, artinya url_short booking ini belum terisi -> null (pemanggil memakai tautan panjang). Gagal jaringan
 * / timeout = null. Tidak pernah melempar.
 */
import { createHash } from 'crypto'

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const LENGTH = 10
const MAX_VERIFY_ATTEMPTS = 3
const VERIFY_TIMEOUT_MS = 4_000

export const SHORT_LINK_BASE = 'https://jvto.me/b/'

/** Kandidat url_short ke-`attempt` untuk `url` (sama dengan BookingShortUrl::candidate). Murni. */
export function bookingShortCandidate(url: string, attempt: number): string {
  if (url === '') throw new Error('url kosong tidak punya url_short')
  const source = createHash('md5').update(attempt === 0 ? url : `${url}#${attempt}`).digest('hex')
  let n = BigInt(`0x${source.slice(0, 14)}`)
  let code = ''
  while (n > BigInt(0)) {
    code = ALPHABET[Number(n % BigInt(62))] + code
    n /= BigInt(62)
  }
  return code.padStart(LENGTH, '0')
}

/** url_short booking ber-`url` ini yang sudah DIPASTIKAN milik booking ini, atau null. */
export async function verifiedBookingShortCode(url: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const base = process.env.LEGACY_BASE_URL?.trim().replace(/\/+$/, '')
  if (!base || !/^[A-Za-z0-9]+$/.test(url)) return null
  try {
    for (let attempt = 0; attempt < MAX_VERIFY_ATTEMPTS; attempt++) {
      const code = bookingShortCandidate(url, attempt)
      const res = await fetchImpl(`${base}/bookings/short/${code}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      })
      if (res.status === 404) return null
      if (!res.ok) return null
      const body: unknown = await res.json()
      const owner = typeof body === 'object' && body !== null ? (body as { url?: unknown }).url : undefined
      if (owner === url) return code
      // Kode ini milik booking lain: coba percobaan berikutnya.
    }
    return null
  } catch {
    return null
  }
}
