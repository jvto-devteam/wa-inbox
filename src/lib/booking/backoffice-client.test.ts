import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { ensureFreshBookingData, type BookingData } from '@/lib/booking/client'
import { writeBookingChange, writeConfigured, bookingUrlToken } from './backoffice-client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/booking/client', () => ({ ensureFreshBookingData: vi.fn() }))
const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

type Call = [string, { method: string; body: string; signal: AbortSignal; headers: Record<string, string> }]
const calls = (): Call[] => (fetch as unknown as { mock: { calls: Call[] } }).mock.calls
const sent = (i = 0) => Object.fromEntries(new URLSearchParams(calls()[i][1].body))
const okJson = (data: unknown = {}, status = 200) => ({ ok: status < 400, status, json: async () => data })

function booking(over: Partial<BookingData> = {}): BookingData {
  return {
    booking_id: 77,
    customer_portal: 'https://javavolcano-touroperator.com/my-booking/tok123',
    total_pax: 2,
    pickup: { meeting_point: 'Surabaya Airport', meeting_point_value: 'GA 300', pickup_time: '10:30' },
    dropoff: { drop_point: 'Surabaya Hotel', drop_point_value: 'Hotel Majapahit', drop_time: '07:00' },
    ...over,
  }
}

function load(data: BookingData | null) {
  mockPrisma.conversation.findUnique.mockResolvedValue({
    id: 'c1', bookingData: data, bookingCheckedAt: new Date(), pipelineStage: 'booked',
    orderChannel: null, isTest: false, contact: { phone: '62811' },
  } as never)
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  process.env.LEGACY_BASE_URL = 'https://javavolcano-touroperator.com/'
  mockReset(mockPrisma)
  vi.mocked(ensureFreshBookingData).mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('writeConfigured', () => {
  it('false when env empty, true when set', () => {
    delete process.env.LEGACY_BASE_URL
    expect(writeConfigured()).toBe(false)
    process.env.LEGACY_BASE_URL = '  '
    expect(writeConfigured()).toBe(false)
    process.env.LEGACY_BASE_URL = 'https://x.example'
    expect(writeConfigured()).toBe(true)
  })
})

describe('bookingUrlToken', () => {
  it('takes the last path segment of customer_portal', () => {
    expect(bookingUrlToken(booking())).toBe('tok123')
    expect(bookingUrlToken(booking({ customer_portal: 'https://x.example/my-booking/abc-9/?a=1' }))).toBe('abc-9')
  })
  it('returns null when missing or unparseable', () => {
    expect(bookingUrlToken(booking({ customer_portal: undefined }))).toBeNull()
    expect(bookingUrlToken(booking({ customer_portal: '' }))).toBeNull()
  })
})

describe('writeBookingChange', () => {
  it('url taken from customer_portal; missing url -> error, no request', async () => {
    load(booking({ customer_portal: undefined }))
    const r = await writeBookingChange('77', { pickup_time: '09:00' }, 'c1')
    expect(r).toMatchObject({ status: 'error', httpStatus: 0 })
    expect(fetch).not.toHaveBeenCalled()

    load(booking())
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(okJson({ success: true }))
    vi.mocked(ensureFreshBookingData).mockResolvedValue(booking())
    await writeBookingChange('77', { pickup_time: '09:00' }, 'c1')
    expect(calls()[0][0]).toBe('https://javavolcano-touroperator.com/bookings/update-pickup/tok123')
    expect(calls()[0][1].method).toBe('POST')
  })

  it('pickup change sends full point + detail merged from bookingData', async () => {
    load(booking())
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(okJson({ success: true }))
    vi.mocked(ensureFreshBookingData).mockResolvedValue(booking())
    await writeBookingChange('77', { pickup_time: '09:15' }, 'c1')
    expect(sent()).toEqual({ meeting_point: 'Surabaya Airport', flight_ticket_type_number: 'GA 300', pickup_time1: '09', pickup_time2: '15' })
  })

  it('point change drops the old detail; Bali Hotel is sent as Denpasar Hotel; Others needs detail', async () => {
    load(booking())
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(okJson({ success: true }))
    vi.mocked(ensureFreshBookingData).mockResolvedValue(booking())
    await writeBookingChange('77', { pickup_point: 'Surabaya Hotel', pickup_detail: 'Hotel Tunjungan' }, 'c1')
    expect(sent(0)).toMatchObject({ meeting_point: 'Surabaya Hotel', hotel: 'Hotel Tunjungan' })
    await writeBookingChange('77', { pickup_point: 'Bali Hotel', pickup_detail: 'Hotel Kuta' }, 'c1')
    expect(sent(1)).toMatchObject({ meeting_point: 'Denpasar Hotel', hotel: 'Hotel Kuta' })
    const r = await writeBookingChange('77', { pickup_point: 'Others', pickup_detail: ' ' }, 'c1')
    expect(r).toMatchObject({ status: 'error', httpStatus: 0 })
    expect(calls()).toHaveLength(2)
  })

  it('unknown booking time (07:00) is not sent unless the patch sets it', async () => {
    load(booking())
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(okJson({ success: true }))
    vi.mocked(ensureFreshBookingData).mockResolvedValue(booking())
    await writeBookingChange('77', { drop_point: 'Surabaya Airport', drop_detail: 'JT 20' }, 'c1')
    expect(sent(0).drop_time1).toBe('')
    expect(sent(0)).toEqual({ drop: 'Surabaya Airport', drop_other_flight: 'JT 20', drop_time1: '', drop_time2: '' })
    await writeBookingChange('77', { drop_time: '07:00' }, 'c1')
    expect(sent(1)).toMatchObject({ drop: 'Surabaya Hotel', drop_other_hotel: 'Hotel Majapahit', drop_time1: '07', drop_time2: '00' })
  })

  it('tshirt sizes are posted as six fields, missing ones 0', async () => {
    load(booking())
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(okJson({ success: true }))
    vi.mocked(ensureFreshBookingData).mockResolvedValue(booking())
    await writeBookingChange('77', { tshirt_sizes: { M: 1, l: 1 } }, 'c1')
    expect(calls()[0][0]).toMatch(/update-tshirt\/tok123$/)
    expect(sent()).toEqual({ xs: '0', s: '0', m: '1', l: '1', xl: '0', xxl: '0' })
  })

  it('note has no path -> error, no request', async () => {
    load(booking())
    const r = await writeBookingChange('77', { note: 'vegetarian' }, 'c1')
    expect(r).toEqual({ status: 'error', httpStatus: 0, error: 'Catatan belum punya jalur tulis', written: [] })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('booking switched since the card was made -> error, no request', async () => {
    load(booking({ booking_id: 78 }))
    const r = await writeBookingChange('77', { pickup_time: '09:00' }, 'c1')
    expect(r.status).toBe('error')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('not configured -> error, no request, no DB read', async () => {
    delete process.env.LEGACY_BASE_URL
    const r = await writeBookingChange('77', { pickup_time: '09:00' }, 'c1')
    expect(r.status).toBe('error')
    expect(fetch).not.toHaveBeenCalled()
    expect(mockPrisma.conversation.findUnique).not.toHaveBeenCalled()
  })

  it('timeout -> error, bookingData untouched', async () => {
    vi.useFakeTimers()
    load(booking())
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_u: string, init: { signal: AbortSignal }) =>
        new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    )
    const p = writeBookingChange('77', { pickup_time: '09:00' }, 'c1')
    await vi.advanceTimersByTimeAsync(10_001)
    const r = await p
    expect(r).toMatchObject({ status: 'error', httpStatus: 0 })
    expect(mockPrisma.conversation.update).not.toHaveBeenCalled()
    expect(ensureFreshBookingData).not.toHaveBeenCalled()
  })

  it('API rejection (422) -> error with status; no refresh, no bookingData write; logs carry no token', async () => {
    load(booking({ total_pax: undefined }))
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(okJson({ success: false, message: 'Total T-shirts cannot exceed the number of participants (2 pax)' }, 422))
    const r = await writeBookingChange('77', { tshirt_sizes: { m: 5 } }, 'c1') // tanpa total_pax: lolos cek lokal
    expect(r).toMatchObject({ status: 'error', httpStatus: 422 })
    expect(ensureFreshBookingData).not.toHaveBeenCalled()
    expect(mockPrisma.conversation.update).not.toHaveBeenCalled()
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('tok123')
  })

  it('success refreshes via ensureFreshBookingData (forced) and returns the fresh booking; refresh failure still ok', async () => {
    load(booking())
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(okJson({ success: true }))
    const fresh = booking({ pickup: { meeting_point: 'Surabaya Airport', meeting_point_value: 'GA 300', pickup_time: '09:15' } })
    vi.mocked(ensureFreshBookingData).mockResolvedValueOnce(fresh)
    const r = await writeBookingChange('77', { pickup_time: '09:15' }, 'c1')
    expect(r).toEqual({ status: 'ok', booking: fresh, written: ['pickup'] })
    expect(vi.mocked(ensureFreshBookingData).mock.calls[0][0].bookingCheckedAt).toBeNull()

    vi.mocked(ensureFreshBookingData).mockRejectedValueOnce(new Error('db down'))
    const r2 = await writeBookingChange('77', { pickup_time: '09:15' }, 'c1')
    expect(r2.status).toBe('ok')
  })

  it('point change without new detail while booking has a detail -> error, no request (pickup and drop)', async () => {
    load(booking())
    const a = await writeBookingChange('77', { pickup_point: 'Surabaya Hotel' }, 'c1')
    expect(a).toEqual({ status: 'error', httpStatus: 0, error: 'Isi detail titik baru dulu', written: [] })
    const b = await writeBookingChange('77', { drop_point: 'Surabaya Airport' }, 'c1')
    expect(b).toMatchObject({ status: 'error', httpStatus: 0, error: 'Isi detail titik baru dulu' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('point change without detail is allowed when the booking has no detail', async () => {
    load(booking({ pickup: { meeting_point: 'Surabaya Airport', meeting_point_value: null, pickup_time: '10:30' } }))
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(okJson({ success: true }))
    vi.mocked(ensureFreshBookingData).mockResolvedValue(booking())
    await writeBookingChange('77', { pickup_point: 'Surabaya Hotel' }, 'c1')
    expect(sent()).toMatchObject({ meeting_point: 'Surabaya Hotel', hotel: '' })
  })

  it('drop mapping for hotel, train and others', async () => {
    load(booking())
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(okJson({ success: true }))
    vi.mocked(ensureFreshBookingData).mockResolvedValue(booking())
    await writeBookingChange('77', { drop_point: 'Bali Hotel', drop_detail: 'Hotel Kuta', drop_time: '14:05' }, 'c1')
    expect(sent(0)).toEqual({ drop: 'Denpasar Hotel', drop_other_hotel: 'Hotel Kuta', drop_time1: '14', drop_time2: '05' })
    await writeBookingChange('77', { drop_point: 'Surabaya Train Station', drop_detail: 'KA 12' }, 'c1')
    expect(sent(1)).toMatchObject({ drop: 'Surabaya Train Station', drop_other_train: 'KA 12' })
    await writeBookingChange('77', { drop_point: 'Others', drop_detail: 'Pelabuhan' }, 'c1')
    expect(sent(2)).toMatchObject({ drop: 'Others', drop_other_others: 'Pelabuhan' })
  })

  it('booking already at Denpasar Hotel patched with Bali Hotel keeps its detail', async () => {
    load(booking({ pickup: { meeting_point: 'Denpasar Hotel', meeting_point_value: 'Hotel Kuta', pickup_time: '10:30' } }))
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(okJson({ success: true }))
    vi.mocked(ensureFreshBookingData).mockResolvedValue(booking())
    await writeBookingChange('77', { pickup_point: 'Bali Hotel' }, 'c1')
    expect(sent()).toMatchObject({ meeting_point: 'Denpasar Hotel', hotel: 'Hotel Kuta' })
  })

  it('success:false with HTTP 200, or non-JSON 200 -> httpStatus 502', async () => {
    load(booking())
    const f = fetch as unknown as ReturnType<typeof vi.fn>
    f.mockResolvedValueOnce(okJson({ success: false, message: 'Failed to update Pickup' }))
    expect(await writeBookingChange('77', { pickup_time: '09:00' }, 'c1')).toMatchObject({ status: 'error', httpStatus: 502 })
    f.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error('html') } })
    expect(await writeBookingChange('77', { pickup_time: '09:00' }, 'c1')).toMatchObject({ status: 'error', httpStatus: 502 })
  })

  it('partial order: pickup ok, drop fails -> written=[pickup], bookingData refreshed', async () => {
    load(booking())
    ;(fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({ success: false, message: 'Failed' }, 500))
    vi.mocked(ensureFreshBookingData).mockResolvedValue(booking())
    const r = await writeBookingChange('77', { pickup_time: '09:00', drop_time: '15:00' }, 'c1')
    expect(r).toMatchObject({ status: 'error', httpStatus: 500, written: ['pickup'] })
    expect(calls()[0][0]).toMatch(/update-pickup/)
    expect(calls()[1][0]).toMatch(/update-drop/)
    expect(ensureFreshBookingData).toHaveBeenCalledTimes(1)
  })

  it('tshirt sum must equal total_pax, else error without request', async () => {
    load(booking())
    const r = await writeBookingChange('77', { tshirt_sizes: { m: 5 } }, 'c1')
    expect(r).toMatchObject({ status: 'error', httpStatus: 0, written: [] })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('ok result reports written parts', async () => {
    load(booking())
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(okJson({ success: true }))
    vi.mocked(ensureFreshBookingData).mockResolvedValue(booking())
    const r = await writeBookingChange('77', { pickup_time: '09:00', tshirt_sizes: { m: 2 } }, 'c1')
    expect(r).toMatchObject({ status: 'ok', written: ['pickup', 'tshirt'] })
  })
})
