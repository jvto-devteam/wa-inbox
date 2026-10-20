/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import type { BookingData } from '@/lib/booking/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))
vi.mock('@/lib/booking/client', () => ({ ensureFreshBookingData: vi.fn() }))
vi.mock('@/lib/booking-actions/store', () => ({ reevaluateBookingActions: vi.fn().mockResolvedValue({ resolved: 0, opened: 0 }) }))
vi.mock('@/lib/booking-actions/history', () => ({ recordEvent: vi.fn().mockResolvedValue(undefined) }))

import { prisma } from '@/lib/db'
import { ensureFreshBookingData } from '@/lib/booking/client'
import { recordEvent } from '@/lib/booking-actions/history'
import { executeBookingAction, releaseStaleExecuting } from './execute'

const db = prisma as unknown as DeepMockProxy<PrismaClient>
const NOW = new Date('2026-10-20T03:00:00Z')

const booking = (over: Partial<BookingData> = {}): BookingData => ({
  booking_id: 77,
  customer_portal: 'https://javavolcano-touroperator.com/my-booking/tok123',
  total_pax: 2,
  pickup: { meeting_point: 'Surabaya Airport', meeting_point_value: 'GA 300', pickup_time: '10:30' },
  ...over,
})

beforeEach(() => {
  mockReset(db)
  vi.mocked(recordEvent).mockClear()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) }))
  process.env.LEGACY_BASE_URL = 'https://javavolcano-touroperator.com'
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  db.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) => fn(db)) as never)
  db.bookingAction.updateMany.mockResolvedValue({ count: 1 } as never)
  db.bookingAction.findMany.mockResolvedValue([])
})
afterEach(() => {
  delete process.env.LEGACY_BASE_URL
  vi.restoreAllMocks()
})

describe('executeBookingAction (klien tulis sungguhan, fetch di-stub)', () => {
  it('owner case: Surabaya Airport (detail GA 300) → Surabaya Hotel + detail Hotel Majapahit = one write, 200', async () => {
    db.bookingAction.findUnique.mockResolvedValue({
      id: 'a1', conversationId: 'c1', bookingId: '77', type: 'CHANGE', field: 'pickup_point', proposedValue: 'Surabaya Hotel', state: 'OPEN',
    } as never)
    db.conversation.findUnique.mockResolvedValue({
      id: 'c1', bookingData: booking(), bookingCheckedAt: NOW, pipelineStage: 'booked', orderChannel: null, isTest: false, contact: { phone: '62811' },
    } as never)
    vi.mocked(ensureFreshBookingData).mockResolvedValue(booking({ pickup: { meeting_point: 'Surabaya Hotel', meeting_point_value: 'Hotel Majapahit' } }))

    const r = await executeBookingAction({ actionId: 'a1', accountId: 'acc1', detail: 'Hotel Majapahit', now: NOW })

    expect(r.status).toBe(200)
    const calls = vi.mocked(fetch).mock.calls
    expect(calls).toHaveLength(1)
    expect(String(calls[0][0])).toBe('https://javavolcano-touroperator.com/bookings/update-pickup/tok123')
    const form = Object.fromEntries(new URLSearchParams(String((calls[0][1] as RequestInit).body)))
    expect(form).toEqual({ meeting_point: 'Surabaya Hotel', hotel: 'Hotel Majapahit', pickup_time1: '10', pickup_time2: '30' })
  })

  it('without the detail the same card is refused before any request (the gap R19 closes)', async () => {
    db.bookingAction.findUnique.mockResolvedValue({
      id: 'a1', conversationId: 'c1', bookingId: '77', type: 'CHANGE', field: 'pickup_point', proposedValue: 'Surabaya Hotel', state: 'OPEN',
    } as never)
    db.conversation.findUnique.mockResolvedValue({ id: 'c1', bookingData: booking(), contact: { phone: '62811' } } as never)
    const r = await executeBookingAction({ actionId: 'a1', accountId: 'acc1', now: NOW })
    expect(r).toEqual({ status: 400, body: { error: 'Isi detail titik baru dulu' } })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('releaseStaleExecuting', () => {
  const stuck = (over: Record<string, unknown> = {}) => ({
    id: 's1', conversationId: 'c1', bookingId: '77', field: 'pickup_point', proposedValue: 'Surabaya Hotel',
    conversation: { bookingData: booking() }, ...over,
  })

  it('reopens with lastError when the booking does not carry the value', async () => {
    db.bookingAction.findMany.mockResolvedValue([stuck()] as never)
    expect(await releaseStaleExecuting('c1', NOW)).toBe(1)
    const cutoff = new Date('2026-10-20T02:58:00Z')
    expect(db.bookingAction.findMany.mock.calls[0][0]?.where).toEqual({ conversationId: 'c1', state: 'EXECUTING', updatedAt: { lt: cutoff } })
    expect(db.bookingAction.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', state: 'EXECUTING', updatedAt: { lt: cutoff } },
      data: { state: 'OPEN', lastError: expect.stringContaining('Eksekusi terputus') },
    })
    expect(recordEvent).toHaveBeenCalledWith(prisma, expect.objectContaining({ actionId: 's1', event: 'EXECUTE_FAILED', actor: 'SYSTEM' }))
  })

  it('closes MATCHED_IN_BACKOFFICE when the interrupted write did land, so a re-click cannot rewrite production', async () => {
    db.bookingAction.findMany.mockResolvedValue([stuck({ conversation: { bookingData: booking({ pickup: { meeting_point: 'Surabaya Hotel' } }) } })] as never)
    await releaseStaleExecuting('c1', NOW)
    expect(db.bookingAction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { state: 'RESOLVED', closedReason: 'MATCHED_IN_BACKOFFICE', closedAt: NOW, lastError: null },
    }))
    expect(recordEvent).toHaveBeenCalledWith(prisma, expect.objectContaining({ event: 'RESOLVED', reason: 'MATCHED_IN_BACKOFFICE', actor: 'SYSTEM' }))
  })

  it('without conversationId sweeps all conversations in one query (tick)', async () => {
    db.bookingAction.findMany.mockResolvedValue([])
    await releaseStaleExecuting(undefined, NOW)
    expect(db.bookingAction.findMany).toHaveBeenCalledTimes(1)
    expect(db.bookingAction.findMany.mock.calls[0][0]?.where).not.toHaveProperty('conversationId')
  })

  it('a row claimed again in the meantime (count 0) is left alone and writes no event', async () => {
    db.bookingAction.findMany.mockResolvedValue([stuck()] as never)
    db.bookingAction.updateMany.mockResolvedValue({ count: 0 } as never)
    expect(await releaseStaleExecuting('c1', NOW)).toBe(0)
    expect(recordEvent).not.toHaveBeenCalled()
  })
})
