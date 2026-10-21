import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bookingShortCandidate, verifiedBookingShortCode } from './short-link'

// Vektor yang sama dengan new-backoffice tests/Unit/BookingShortUrlTest.php (dan salinannya di javavolcano-touroperator).
const URL = '0982800e9edfa44720c745377596e6ce'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('bookingShortCandidate', () => {
  it('sama persis dengan BookingShortUrl::candidate (PHP)', () => {
    expect(bookingShortCandidate(URL, 0)).toBe('4ta1AJle9t')
    expect(bookingShortCandidate(URL, 1)).toBe('1n7QpZ0UPy')
  })

  it('selalu 10 karakter base62', () => {
    for (let i = 0; i < 50; i++) expect(bookingShortCandidate(`booking-${i}`, 0)).toMatch(/^[0-9A-Za-z]{10}$/)
  })

  it('url kosong ditolak', () => {
    expect(() => bookingShortCandidate('', 0)).toThrow()
  })
})

describe('verifiedBookingShortCode', () => {
  beforeEach(() => {
    vi.stubEnv('LEGACY_BASE_URL', 'https://legacy.example.test/')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('kandidat pertama milik booking ini -> dipakai, ditanyakan ke legacy /bookings/short/{code}', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { url: URL }))
    expect(await verifiedBookingShortCode(URL, fetchImpl as unknown as typeof fetch)).toBe('4ta1AJle9t')
    expect(fetchImpl).toHaveBeenCalledWith('https://legacy.example.test/bookings/short/4ta1AJle9t', expect.anything())
  })

  it('kandidat pertama milik booking LAIN -> percobaan berikutnya, tidak pernah memakai kode orang lain', async () => {
    const fetchImpl = vi.fn(async (input: string) =>
      input.endsWith('/4ta1AJle9t') ? jsonResponse(200, { url: 'ffffffffffffffffffffffffffffffff' }) : jsonResponse(200, { url: URL })
    )
    expect(await verifiedBookingShortCode(URL, fetchImpl as unknown as typeof fetch)).toBe('1n7QpZ0UPy')
  })

  it('404 (url_short belum terisi), error HTTP, dan gagal jaringan -> null', async () => {
    expect(await verifiedBookingShortCode(URL, (async () => jsonResponse(404, { error: 'not found' })) as unknown as typeof fetch)).toBeNull()
    expect(await verifiedBookingShortCode(URL, (async () => jsonResponse(500, {})) as unknown as typeof fetch)).toBeNull()
    expect(
      await verifiedBookingShortCode(URL, (async () => {
        throw new Error('down')
      }) as unknown as typeof fetch)
    ).toBeNull()
  })

  it('semua kandidat milik booking lain -> null', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { url: 'ffffffffffffffffffffffffffffffff' }))
    expect(await verifiedBookingShortCode(URL, fetchImpl as unknown as typeof fetch)).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('tanpa LEGACY_BASE_URL atau token aneh -> null tanpa memanggil jaringan', async () => {
    const fetchImpl = vi.fn()
    expect(await verifiedBookingShortCode('a/b', fetchImpl as unknown as typeof fetch)).toBeNull()
    vi.stubEnv('LEGACY_BASE_URL', '')
    expect(await verifiedBookingShortCode(URL, fetchImpl as unknown as typeof fetch)).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
