import { describe, it, expect, vi, beforeEach } from 'vitest'
import { lookupBooking } from './client'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  process.env.BOOKING_API_URL = 'https://booking.jvto.example/bookings'
  process.env.BOOKING_API_KEY = 'booking-key'
})

describe('lookupBooking', () => {
  it('returns null when BOOKING_API_URL is not configured, without calling fetch', async () => {
    delete process.env.BOOKING_API_URL
    expect(await lookupBooking('6281234567890')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('builds the request URL with filter_type=range, a date_range from the 1st of last month, and phone_no; sends a Bearer Authorization header', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ id: 'B1' }) })

    await lookupBooking('+62 812-3456-7890')

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = (fetch as any).mock.calls[0]
    // Phone is normalized (spaces/dashes stripped) and the '+' is kept as a
    // literal character in the query string (not percent-encoded to %2B).
    expect(url).toMatch(
      /^https:\/\/booking\.jvto\.example\/bookings\?filter_type=range&date_range=\d{4}-\d{2}-01_2099-12-31&phone_no=\+6281234567890$/
    )
    expect(options.headers.Authorization).toBe('Bearer booking-key')
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('omits the Authorization header when BOOKING_API_KEY is not set', async () => {
    delete process.env.BOOKING_API_KEY
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ id: 'B1' }) })

    await lookupBooking('6281234567890')

    const [, options] = (fetch as any).mock.calls[0]
    expect(options.headers.Authorization).toBeUndefined()
  })

  it('returns the raw booking object as-is when the API returns a single object (no field remapping)', async () => {
    const raw = {
      id: 'B1',
      guest: 'Jane Doe',
      package: 'Ijen Blue Fire Trekking',
      date: { start: '01 Aug 2026', end: '02 Aug 2026', start_ymd: '2026-08-01', end_ymd: '2026-08-02' },
      orderChannel: 'JVTO',
      financial: { payment: 500000, balance: 350000 },
    }
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => raw })

    const result = await lookupBooking('6281234567890')

    expect(result).toEqual(raw)
  })

  it('picks the booking with the latest date.start_ymd when the API returns an array', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 'B1', date: { start_ymd: '2026-08-01' } },
        { id: 'B2', date: { start_ymd: '2026-09-01' } },
        { id: 'B3', date: { start_ymd: '2026-07-15' } },
      ],
    })

    const result = await lookupBooking('6281234567890')

    expect(result?.id).toBe('B2')
  })

  it('returns null when the API returns an empty array', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => [] })
    expect(await lookupBooking('6281234567890')).toBeNull()
  })

  it('returns null when the API returns an empty object', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) })
    expect(await lookupBooking('6281234567890')).toBeNull()
  })

  it('handles array items with a missing date gracefully instead of throwing', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'B1' }, { id: 'B2', date: { start_ymd: '2026-09-01' } }],
    })

    const result = await lookupBooking('6281234567890')

    expect(result?.id).toBe('B2')
  })

  it('returns null when the response is not ok (e.g. 404 or 500)', async () => {
    ;(fetch as any).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    expect(await lookupBooking('6281234567890')).toBeNull()
  })

  it('returns null instead of throwing when the request fails outright', async () => {
    ;(fetch as any).mockRejectedValue(new Error('timeout'))
    expect(await lookupBooking('6281234567890')).toBeNull()
  })

  it('returns null instead of throwing when the response body is not valid JSON', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('invalid JSON')
      },
    })
    expect(await lookupBooking('6281234567890')).toBeNull()
  })
})
