import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeImpact } from './impact'

const BOOKING = {
  booking_id: 3800,
  booking_code: 'JVTO-3800',
  travel_date_start: '2026-10-22',
  travel_date_end: '2026-10-24',
  at_ijen: '2026-10-23',
  total_pax: 2,
  crew: [{ crew_id: 7, name: 'Fredi', assignment: 'guide', start_date: '2026-10-22', end_date: '2026-10-24' }],
  hotels: [{ day: 1, date: '2026-10-22', hotel_name: 'Hotel X' }],
}
const OTHER = { booking_id: 3910, booking_code: 'JVTO-3910', travel_date_start: '2026-10-25', travel_date_end: '2026-10-27' }

function json(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

describe('computeImpact', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    vi.stubEnv('BACKOFFICE_INTERNAL_API_URL', 'https://bo.test')
    vi.stubEnv('BACKOFFICE_INTERNAL_API_TOKEN', 'secret-token')
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('date shift reports crew clash', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/internal-api/bookings/3800')) return json(BOOKING)
      if (url.includes('/internal-api/bookings?')) return json({ bookings: [BOOKING, OTHER] })
      return json({}, false, 404)
    })
    const r = await computeImpact({ field: 'travel_date', proposedValue: '2026-10-25', bookingId: '3800' })
    expect(r.unavailable).toBeUndefined()
    expect(r.crewClashes).toEqual(['Fredi bentrok dengan JVTO-3910 (25–27 Okt)'])
    expect(r.hotelNights).toEqual(['Hotel X: 22 Okt → 25 Okt'])
    expect(r.medicalCheckupDate).toEqual({ from: '2026-10-22', to: '2026-10-25' })
    const clashCall = fetchMock.mock.calls.map(c => String(c[0])).find(u => u.includes('crew='))
    expect(clashCall).toContain('from=2026-10-25')
    expect(clashCall).toContain('to=2026-10-27')
    expect(clashCall).toContain('crew=7')
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
    expect(init.headers.Authorization).toBe('Bearer secret-token')
  })

  it('total_pax lists hotel nights without crew calls', async () => {
    fetchMock.mockResolvedValue(json(BOOKING))
    const r = await computeImpact({ field: 'total_pax', proposedValue: '4', bookingId: '3800' })
    expect(r).toEqual({ crewClashes: [], hotelNights: ['Hotel X: 22 Okt'], medicalCheckupDate: null })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('api down → unavailable', async () => {
    fetchMock.mockResolvedValue(json({}, false, 500))
    const r = await computeImpact({ field: 'travel_date', proposedValue: '2026-10-25', bookingId: '3800' })
    expect(r).toEqual({ crewClashes: [], hotelNights: [], medicalCheckupDate: null, unavailable: true })
  })

  it('network error, bad shape, and empty env → unavailable, never throws', async () => {
    fetchMock.mockRejectedValue(new Error('boom'))
    expect((await computeImpact({ field: 'hotel', proposedValue: 'x', bookingId: '1' })).unavailable).toBe(true)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(json({ nope: 1 }))
    expect((await computeImpact({ field: 'hotel', proposedValue: 'x', bookingId: '1' })).unavailable).toBe(true)
    vi.stubEnv('BACKOFFICE_INTERNAL_API_URL', '')
    fetchMock.mockClear()
    expect((await computeImpact({ field: 'hotel', proposedValue: 'x', bookingId: '1' })).unavailable).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
