/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import type { BookingData } from '@/lib/booking/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))
vi.mock('@/lib/booking/client', () => ({ ensureFreshBookingData: vi.fn() }))
vi.mock('@/lib/booking-actions/store', () => ({ reevaluateBookingActions: vi.fn().mockResolvedValue({ resolved: 0, opened: 0 }) }))
vi.mock('@/lib/booking-actions/bali-vendor', () => ({ notifyBaliVendor: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/booking-actions/history', () => ({ recordEvent: vi.fn().mockResolvedValue(undefined) }))

import { prisma } from '@/lib/db'
import { ensureFreshBookingData } from '@/lib/booking/client'
import { recordEvent } from '@/lib/booking-actions/history'
import { notifyBaliVendor } from '@/lib/booking-actions/bali-vendor'
import { executeBookingAction, releaseStaleExecuting, revertBookingAction } from './execute'

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
  vi.mocked(notifyBaliVendor).mockClear()
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

describe('executeBookingAction -> vendor Bali notice (Task 11a)', () => {
  const run = async (tier: string, over: Record<string, unknown> = {}, bd: BookingData = booking()) => {
    db.bookingAction.findUnique.mockResolvedValue({
      id: 'a1', conversationId: 'c1', bookingId: '77', type: 'CHANGE', field: 'pickup_time', proposedValue: '09:00', state: 'OPEN', tier, ...over,
    } as never)
    db.conversation.findUnique.mockResolvedValue({ id: 'c1', bookingData: bd, contact: { phone: '62811' } } as never)
    vi.mocked(ensureFreshBookingData).mockResolvedValue(booking({ pickup: { meeting_point: 'Surabaya Airport', pickup_time: '09:00' } }))
    return executeBookingAction({ actionId: 'a1', accountId: 'acc1', now: NOW })
  }

  it('BALI change executed -> one vendor notice with the refreshed booking', async () => {
    const r = await run('BALI')
    expect(r.status).toBe(200)
    expect(notifyBaliVendor).toHaveBeenCalledTimes(1)
    expect(notifyBaliVendor).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'a1', conversationId: 'c1', bookingId: '77', booking: expect.objectContaining({ pickup: expect.objectContaining({ pickup_time: '09:00' }) }) }))
  })

  it('tshirt_sizes on a BALI booking -> no notice (not a transport field)', async () => {
    expect((await run('BALI', { field: 'tshirt_sizes', proposedValue: 'M x 2' })).status).toBe(200)
    expect(notifyBaliVendor).not.toHaveBeenCalled()
  })

  it('drop_time on a BALI booking -> one notice', async () => {
    expect((await run('BALI', { field: 'drop_time', proposedValue: '17:00' }, booking({ dropoff: { drop_point: 'Surabaya Hotel', drop_time: '16:00' } }))).status).toBe(200)
    expect(notifyBaliVendor).toHaveBeenCalledTimes(1)
  })

  it('AI change -> no vendor notice', async () => {
    expect((await run('AI')).status).toBe(200)
    expect(notifyBaliVendor).not.toHaveBeenCalled()
  })

  it('a failed write sends no notice', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as never)
    expect((await run('BALI')).status).toBe(502)
    expect(notifyBaliVendor).not.toHaveBeenCalled()
  })

  it('a notice that rejects does not change the response (change kept)', async () => {
    vi.mocked(notifyBaliVendor).mockRejectedValueOnce(new Error('boom'))
    const r = await run('BALI')
    expect(r.status).toBe(200)
  })
})

describe('executeBookingAction as SYSTEM (auto-apply, Task 11b)', () => {
  it('records SYSTEM with no account, closes EXECUTED/AUTO_APPLIED with closedById null, and stores the batch', async () => {
    db.bookingAction.findUnique.mockResolvedValue({
      id: 'a1', conversationId: 'c1', bookingId: '77', type: 'CHANGE', field: 'pickup_time', proposedValue: '09:00', state: 'OPEN', tier: 'AI',
    } as never)
    db.conversation.findUnique.mockResolvedValue({ id: 'c1', bookingData: booking(), contact: { phone: '62811' } } as never)
    vi.mocked(ensureFreshBookingData).mockResolvedValue(booking({ pickup: { meeting_point: 'Surabaya Airport', pickup_time: '09:00' } }))
    const r = await executeBookingAction({ actionId: 'a1', accountId: null, actor: 'SYSTEM', closedReason: 'AUTO_APPLIED', now: NOW })
    expect(r.status).toBe(200)
    expect(db.bookingAction.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', state: 'EXECUTING', claimedAt: NOW },
      data: expect.objectContaining({ state: 'EXECUTED', closedReason: 'AUTO_APPLIED', closedById: null }),
    })
    expect(recordEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      event: 'EXECUTED', actor: 'SYSTEM', accountId: null, oldValue: '10:30', newValue: '09:00',
      backoffice: expect.objectContaining({ batch: ['a1'] }),
    }))
  })

  it('a failed auto write returns the card to OPEN and records EXECUTE_FAILED as SYSTEM', async () => {
    db.bookingAction.findUnique.mockResolvedValue({
      id: 'a1', conversationId: 'c1', bookingId: '77', type: 'CHANGE', field: 'pickup_time', proposedValue: '09:00', state: 'OPEN', tier: 'AI',
    } as never)
    db.conversation.findUnique.mockResolvedValue({ id: 'c1', bookingData: booking(), contact: { phone: '62811' } } as never)
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as never)
    const r = await executeBookingAction({ actionId: 'a1', accountId: null, actor: 'SYSTEM', closedReason: 'AUTO_APPLIED', now: NOW })
    expect(r.status).toBe(502)
    expect(db.bookingAction.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'OPEN' }) }))
    expect(recordEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event: 'EXECUTE_FAILED', actor: 'SYSTEM', accountId: null }))
  })
})

describe('revertBookingAction (Task 11b)', () => {
  const executedAction = (over: Record<string, unknown> = {}) => ({
    id: 'a1', conversationId: 'c1', bookingId: '77', type: 'CHANGE', field: 'pickup_time', proposedValue: '09:00', state: 'EXECUTED', tier: 'AI', ...over,
  })
  const executedEvent = (over: Record<string, unknown> = {}) => ({
    id: 'e1', actionId: 'a1', event: 'EXECUTED', oldValue: '10:30', newValue: '09:00', backoffice: { written: ['pickup'], batch: ['a1'] }, createdAt: NOW, ...over,
  })
  const nowBooking = () => booking({ pickup: { meeting_point: 'Surabaya Airport', meeting_point_value: 'GA 300', pickup_time: '09:00' } })
  const setup = (over: { action?: Record<string, unknown>; event?: Record<string, unknown>; bd?: BookingData } = {}) => {
    db.bookingAction.findUnique.mockResolvedValue(executedAction(over.action) as never)
    db.bookingAction.findMany.mockResolvedValue([{ id: 'a1', field: 'pickup_time' }] as never)
    db.bookingActionEvent.findMany.mockResolvedValue([executedEvent(over.event)] as never)
    db.conversation.findUnique.mockResolvedValue({ id: 'c1', bookingData: over.bd ?? nowBooking(), contact: { phone: '62811' } } as never)
    vi.mocked(ensureFreshBookingData).mockResolvedValue(booking())
  }

  it('revert writes old value and records REVERTED', async () => {
    setup()
    const r = await revertBookingAction({ actionId: 'a1', accountId: 'acc1' })
    expect(r).toEqual({ status: 200, body: { ok: true, state: 'REVERTED', reverted: ['a1'] } })
    const calls = vi.mocked(fetch).mock.calls
    expect(calls).toHaveLength(1)
    expect(Object.fromEntries(new URLSearchParams(String((calls[0][1] as RequestInit).body)))).toMatchObject({ pickup_time1: '10', pickup_time2: '30' })
    expect(db.bookingAction.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', state: 'EXECUTED' },
      data: expect.objectContaining({ state: 'REVERTED', closedReason: 'REVERTED', closedById: 'acc1' }),
    })
    expect(recordEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event: 'REVERTED', actor: 'ACCOUNT', accountId: 'acc1', oldValue: '09:00', newValue: '10:30' }))
  })

  it('only EXECUTED actions can be reverted', async () => {
    setup({ action: { state: 'OPEN' } })
    expect((await revertBookingAction({ actionId: 'a1', accountId: 'acc1' })).status).toBe(409)
    setup({ action: { state: 'REVERTED' } })
    expect((await revertBookingAction({ actionId: 'a1', accountId: 'acc1' })).status).toBe(409)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses when the booking value is no longer what we wrote (someone changed it since)', async () => {
    setup({ bd: booking({ pickup: { meeting_point: 'Surabaya Airport', pickup_time: '08:00' } }) })
    const r = await revertBookingAction({ actionId: 'a1', accountId: 'acc1' })
    expect(r.status).toBe(409)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses when the previous value was empty (nothing sensible to write back)', async () => {
    setup({ event: { oldValue: null } })
    expect((await revertBookingAction({ actionId: 'a1', accountId: 'acc1' })).status).toBe(400)
    setup({ event: { oldValue: '07:00' } })
    expect((await revertBookingAction({ actionId: 'a1', accountId: 'acc1' })).status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a failed write keeps the card EXECUTED and records EXECUTE_FAILED (502)', async () => {
    setup()
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as never)
    const r = await revertBookingAction({ actionId: 'a1', accountId: 'acc1' })
    expect(r.status).toBe(502)
    expect(db.bookingAction.updateMany).not.toHaveBeenCalled()
    expect(recordEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event: 'EXECUTE_FAILED', actionId: 'a1' }))
    expect(recordEvent).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event: 'REVERTED' }))
  })

  it('double revert: the loser of the conditional update records nothing and gets 409', async () => {
    setup()
    db.bookingAction.updateMany.mockResolvedValue({ count: 0 } as never)
    const r = await revertBookingAction({ actionId: 'a1', accountId: 'acc1' })
    expect(r.status).toBe(409)
    expect(recordEvent).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event: 'REVERTED' }))
  })

  it('BALI pickup_time revert -> one vendor notice with key bali_revert:<id>; revert of a non-transport field -> none', async () => {
    setup({ action: { tier: 'BALI' } })
    expect((await revertBookingAction({ actionId: 'a1', accountId: 'acc1' })).status).toBe(200)
    expect(notifyBaliVendor).toHaveBeenCalledTimes(1)
    expect(notifyBaliVendor).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'a1', idempotencyKey: 'bali_revert:a1' }))
    vi.mocked(notifyBaliVendor).mockClear()
    setup({ action: { tier: 'BALI', field: 'tshirt_sizes', proposedValue: 'M x 2' }, event: { oldValue: 'L x 2', newValue: 'M x 2' }, bd: booking({ tshirtSize: 'M x 2' } as Partial<BookingData>) })
    db.bookingAction.findMany.mockResolvedValue([{ id: 'a1', field: 'tshirt_sizes' }] as never)
    expect((await revertBookingAction({ actionId: 'a1', accountId: 'acc1' })).status).toBe(200)
    expect(notifyBaliVendor).not.toHaveBeenCalled()
  })

  it('AI revert and a failed revert send no vendor notice', async () => {
    setup()
    await revertBookingAction({ actionId: 'a1', accountId: 'acc1' })
    setup({ action: { tier: 'BALI' } })
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as never)
    await revertBookingAction({ actionId: 'a1', accountId: 'acc1' })
    expect(notifyBaliVendor).not.toHaveBeenCalled()
  })

  it('previousDetail path: point executed with typed detail (no companion card) -> revert writes the old detail back', async () => {
    db.bookingAction.findUnique.mockResolvedValue(executedAction({ field: 'pickup_point', proposedValue: 'Surabaya Hotel' }) as never)
    db.bookingAction.findMany.mockResolvedValue([{ id: 'a1', field: 'pickup_point' }] as never)
    db.bookingActionEvent.findMany.mockResolvedValue([
      executedEvent({ oldValue: 'Surabaya Airport', newValue: 'Surabaya Hotel', backoffice: { batch: ['a1'], previousDetail: { pickup_detail: 'GA 300' } } }),
    ] as never)
    db.conversation.findUnique.mockResolvedValue({
      id: 'c1', contact: { phone: '62811' },
      bookingData: booking({ pickup: { meeting_point: 'Surabaya Hotel', meeting_point_value: 'Hotel Majapahit', pickup_time: '10:30' } }),
    } as never)
    vi.mocked(ensureFreshBookingData).mockResolvedValue(booking())
    expect((await revertBookingAction({ actionId: 'a1', accountId: 'acc1' })).status).toBe(200)
    expect(String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body)).toContain('GA+300')
  })

  it('previousDetail that was empty -> refused before any write (400)', async () => {
    db.bookingAction.findUnique.mockResolvedValue(executedAction({ field: 'pickup_point', proposedValue: 'Surabaya Hotel' }) as never)
    db.bookingAction.findMany.mockResolvedValue([{ id: 'a1', field: 'pickup_point' }] as never)
    db.bookingActionEvent.findMany.mockResolvedValue([
      executedEvent({ oldValue: 'Surabaya Airport', newValue: 'Surabaya Hotel', backoffice: { batch: ['a1'], previousDetail: { pickup_detail: null } } }),
    ] as never)
    db.conversation.findUnique.mockResolvedValue({
      id: 'c1', bookingData: booking({ pickup: { meeting_point: 'Surabaya Hotel', meeting_point_value: 'X', pickup_time: '10:30' } }),
    } as never)
    expect((await revertBookingAction({ actionId: 'a1', accountId: 'acc1' })).status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reverts the whole batch written together (point + detail) in one patch', async () => {
    db.bookingAction.findUnique.mockResolvedValue(executedAction({ field: 'pickup_point', proposedValue: 'Surabaya Hotel' }) as never)
    db.bookingAction.findMany.mockResolvedValue([{ id: 'a1', field: 'pickup_point' }, { id: 'a2', field: 'pickup_detail' }] as never)
    db.bookingActionEvent.findMany.mockResolvedValue([
      executedEvent({ oldValue: 'Surabaya Airport', newValue: 'Surabaya Hotel', backoffice: { batch: ['a1', 'a2'] } }),
      executedEvent({ id: 'e2', actionId: 'a2', oldValue: 'GA 300', newValue: 'Hotel Majapahit', backoffice: { batch: ['a1', 'a2'] } }),
    ] as never)
    db.conversation.findUnique.mockResolvedValue({
      id: 'c1', contact: { phone: '62811' },
      bookingData: booking({ pickup: { meeting_point: 'Surabaya Hotel', meeting_point_value: 'Hotel Majapahit', pickup_time: '10:30' } }),
    } as never)
    vi.mocked(ensureFreshBookingData).mockResolvedValue(booking())
    const r = await revertBookingAction({ actionId: 'a1', accountId: 'acc1' })
    expect(r.status).toBe(200)
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1)
    expect(Object.fromEntries(new URLSearchParams(String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body)))).toMatchObject({ meeting_point: 'Surabaya Airport' })
    expect(String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body)).toContain('GA+300')
    expect(recordEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event: 'REVERTED', actionId: 'a2' }))
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
    expect(db.bookingAction.findMany.mock.calls[0][0]?.where).toEqual({ conversationId: 'c1', state: 'EXECUTING', claimedAt: { lt: cutoff } })
    expect(db.bookingAction.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', state: 'EXECUTING', claimedAt: { lt: cutoff } },
      data: { state: 'OPEN', claimedAt: null, lastError: expect.stringContaining('Eksekusi terputus') },
    })
    expect(recordEvent).toHaveBeenCalledWith(prisma, expect.objectContaining({ actionId: 's1', event: 'EXECUTE_FAILED', actor: 'SYSTEM' }))
  })

  it('closes MATCHED_IN_BACKOFFICE when the interrupted write did land, so a re-click cannot rewrite production', async () => {
    db.bookingAction.findMany.mockResolvedValue([stuck({ conversation: { bookingData: booking({ pickup: { meeting_point: 'Surabaya Hotel' } }) } })] as never)
    await releaseStaleExecuting('c1', NOW)
    expect(db.bookingAction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { state: 'RESOLVED', closedReason: 'MATCHED_IN_BACKOFFICE', closedAt: NOW, claimedAt: null, lastError: null },
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
