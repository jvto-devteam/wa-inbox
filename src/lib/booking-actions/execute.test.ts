/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import type { BookingData } from '@/lib/booking/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))
vi.mock('@/lib/booking/client', () => ({ ensureFreshBookingData: vi.fn(), lookupBookingResult: vi.fn() }))
vi.mock('@/lib/booking-actions/store', () => ({ reevaluateBookingActions: vi.fn().mockResolvedValue({ resolved: 0, opened: 0 }) }))
vi.mock('@/lib/booking-actions/bali-vendor', () => ({ notifyBaliVendor: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/booking-actions/history', () => ({ recordEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/booking-actions/guest-notice', () => ({ notifyGuestOfUpdate: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/booking-actions/tshirt-vendor', () => ({ notifyTshirtVendor: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/push/send', () => ({ notifyBookingAction: vi.fn().mockResolvedValue(undefined) }))

import { prisma } from '@/lib/db'
import { ensureFreshBookingData, lookupBookingResult } from '@/lib/booking/client'
import { reevaluateBookingActions } from '@/lib/booking-actions/store'
import { recordEvent } from '@/lib/booking-actions/history'
import { notifyBaliVendor } from '@/lib/booking-actions/bali-vendor'
import { notifyGuestOfUpdate } from '@/lib/booking-actions/guest-notice'
import { notifyTshirtVendor } from '@/lib/booking-actions/tshirt-vendor'
import { notifyBookingAction } from '@/lib/push/send'
import { GUEST_REVERT_HINT, executeBookingAction, releaseStaleExecuting, revertBookingAction } from './execute'

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
  vi.mocked(notifyGuestOfUpdate).mockClear()
  vi.mocked(notifyTshirtVendor).mockClear()
  vi.mocked(notifyBookingAction).mockClear()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) }))
  process.env.LEGACY_BASE_URL = 'https://javavolcano-touroperator.com'
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  db.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) => fn(db)) as never)
  db.bookingAction.updateMany.mockResolvedValue({ count: 1 } as never)
  db.bookingAction.findMany.mockResolvedValue([])
  // Critical 1: eksekusi selalu mencari booking segar. Bawaan: API menjawab booking yang sama dengan yang tersimpan.
  vi.mocked(lookupBookingResult).mockReset().mockImplementation((async () => {
    const conv = (await db.conversation.findUnique({ where: { id: 'c1' } })) as { bookingData?: BookingData } | null
    return conv?.bookingData ? { status: 'found', data: conv.bookingData } : { status: 'not_found' }
  }) as never)
  vi.mocked(reevaluateBookingActions).mockClear()
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

describe('final review Critical 1: fresh booking lookup before every write', () => {
  const openAction = (over: Record<string, unknown> = {}) => ({
    id: 'a1', conversationId: 'c1', bookingId: '77', type: 'CHANGE', field: 'pickup_point', proposedValue: 'Surabaya Hotel', state: 'OPEN', tier: 'AI', sourceMessageId: 'm2', ...over,
  })
  const cached = () => booking({ pickup: { meeting_point: 'Surabaya Airport', meeting_point_value: 'GA 300', pickup_time: '10:30' } })
  const setup = (fresh: BookingData | 'error' | 'not_found', over: Record<string, unknown> = {}, conv: Record<string, unknown> = {}) => {
    db.bookingAction.findUnique.mockResolvedValue(openAction(over) as never)
    db.conversation.findUnique.mockResolvedValue({ id: 'c1', bookingData: cached(), isTest: false, contact: { phone: '4915112345678' }, ...conv } as never)
    vi.mocked(lookupBookingResult).mockResolvedValue(fresh === 'error' ? { status: 'error' } : fresh === 'not_found' ? { status: 'not_found' } : { status: 'found', data: fresh })
    vi.mocked(ensureFreshBookingData).mockResolvedValue(null)
  }
  const form = () => Object.fromEntries(new URLSearchParams(String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body)))

  it('the form carries the time from the FRESH booking (ops moved it to 11:15), not the 24 h cache (10:30)', async () => {
    const fresh = booking({ pickup: { meeting_point: 'Surabaya Airport', meeting_point_value: 'GA 300', pickup_time: '11:15' } })
    setup(fresh)
    const r = await executeBookingAction({ actionId: 'a1', accountId: 'acc1', detail: 'Hotel Majapahit', now: NOW })
    expect(r.status).toBe(200)
    expect(lookupBookingResult).toHaveBeenCalledWith('4915112345678')
    expect(form()).toEqual({ meeting_point: 'Surabaya Hotel', hotel: 'Hotel Majapahit', pickup_time1: '11', pickup_time2: '15' })
    // Data segar disimpan (bukan `as never`) dan kartu lain dibandingkan ulang SEBELUM klaim.
    expect(db.conversation.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { bookingData: fresh, bookingCheckedAt: NOW } })
    expect(reevaluateBookingActions).toHaveBeenCalledWith('c1')
    expect(vi.mocked(reevaluateBookingActions).mock.invocationCallOrder[0]).toBeLessThan(db.bookingAction.updateMany.mock.invocationCallOrder[0])
  })

  it('a time change keeps the FRESH point/detail (ops changed the hotel) instead of reverting them', async () => {
    setup(booking({ pickup: { meeting_point: 'Surabaya Hotel', meeting_point_value: 'Hotel Baru', pickup_time: '10:30' } }), { field: 'pickup_time', proposedValue: '09:00' })
    expect((await executeBookingAction({ actionId: 'a1', accountId: 'acc1', now: NOW })).status).toBe(200)
    expect(form()).toEqual({ meeting_point: 'Surabaya Hotel', hotel: 'Hotel Baru', pickup_time1: '09', pickup_time2: '00' })
  })

  it('lookup failure -> 503, nothing claimed, nothing written', async () => {
    setup('error')
    const r = await executeBookingAction({ actionId: 'a1', accountId: 'acc1', detail: 'Hotel Majapahit', now: NOW })
    expect(r.status).toBe(503)
    expect(fetch).not.toHaveBeenCalled()
    expect(db.bookingAction.updateMany).not.toHaveBeenCalled()
    expect(db.conversation.update).not.toHaveBeenCalled()
  })

  it('a different booking_id from the lookup -> 409, nothing written; no booking any more -> 409', async () => {
    setup(booking({ booking_id: 78 }))
    expect((await executeBookingAction({ actionId: 'a1', accountId: 'acc1', detail: 'Hotel Majapahit', now: NOW })).status).toBe(409)
    setup('not_found')
    expect((await executeBookingAction({ actionId: 'a1', accountId: 'acc1', detail: 'Hotel Majapahit', now: NOW })).status).toBe(409)
    expect(fetch).not.toHaveBeenCalled()
    expect(db.bookingAction.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'EXECUTING' }) }))
  })

  it('value already in the fresh booking -> closed MATCHED_IN_BACKOFFICE without writing (409)', async () => {
    setup(booking({ pickup: { meeting_point: 'Surabaya Airport', pickup_time: '09:00' } }), { field: 'pickup_time', proposedValue: '09:00' })
    const r = await executeBookingAction({ actionId: 'a1', accountId: 'acc1', now: NOW })
    expect(r).toEqual({ status: 409, body: { error: expect.stringContaining('sudah memuat') } })
    expect(fetch).not.toHaveBeenCalled()
    expect(db.bookingAction.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', state: 'OPEN' }, data: expect.objectContaining({ state: 'RESOLVED', closedReason: 'MATCHED_IN_BACKOFFICE' }),
    })
    expect(recordEvent).toHaveBeenCalledWith(prisma, expect.objectContaining({ event: 'RESOLVED', reason: 'MATCHED_IN_BACKOFFICE', actor: 'SYSTEM' }))
  })

  it('sandbox isTest conversation is not looked up (no booking) and uses the stored data', async () => {
    setup('error', { field: 'pickup_time', proposedValue: '09:00' }, { isTest: true, contact: { phone: '__bot_test__' } })
    expect((await executeBookingAction({ actionId: 'a1', accountId: 'acc1', now: NOW })).status).toBe(200)
    expect(lookupBookingResult).not.toHaveBeenCalled()
  })

  it('revert: the "still our value" check uses the fresh booking (ops already changed it -> 409, no write)', async () => {
    db.bookingAction.findUnique.mockResolvedValue(openAction({ field: 'pickup_time', proposedValue: '09:00', state: 'EXECUTED' }) as never)
    db.bookingAction.findMany.mockResolvedValue([{ id: 'a1', field: 'pickup_time' }] as never)
    db.bookingActionEvent.findMany.mockResolvedValue([{ id: 'e1', actionId: 'a1', event: 'EXECUTED', oldValue: '10:30', newValue: '09:00', backoffice: { batch: ['a1'] }, createdAt: NOW }] as never)
    // Cache masih memuat nilai kita (09:00), tetapi backoffice sekarang 08:15.
    db.conversation.findUnique.mockResolvedValue({ id: 'c1', bookingData: booking({ pickup: { meeting_point: 'Surabaya Airport', pickup_time: '09:00' } }), isTest: false, contact: { phone: '4915112345678' } } as never)
    vi.mocked(lookupBookingResult).mockResolvedValue({ status: 'found', data: booking({ pickup: { meeting_point: 'Surabaya Airport', pickup_time: '08:15' } }) })
    const r = await revertBookingAction({ actionId: 'a1', accountId: 'acc1' })
    expect(r.status).toBe(409)
    expect(fetch).not.toHaveBeenCalled()

    vi.mocked(lookupBookingResult).mockResolvedValue({ status: 'error' })
    expect((await revertBookingAction({ actionId: 'a1', accountId: 'acc1' })).status).toBe(503)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('final review Important 3: releaseStaleExecuting closes a 07:00 change that landed', () => {
  it("stuck pickup_time '07:00' with booking showing '07:00' -> MATCHED_IN_BACKOFFICE, not reopened", async () => {
    db.bookingAction.findMany.mockResolvedValue([{
      id: 's1', conversationId: 'c1', bookingId: '77', field: 'pickup_time', proposedValue: '07:00',
      conversation: { bookingData: booking({ pickup: { meeting_point: 'Surabaya Airport', pickup_time: '07:00' } }) },
    }] as never)
    await releaseStaleExecuting('c1', NOW)
    expect(db.bookingAction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: 'RESOLVED', closedReason: 'MATCHED_IN_BACKOFFICE' }),
    }))
  })
})

describe('final review Important 5: execution supersedes older facts of the field', () => {
  it('after a successful write, active facts older than (or from) the source message get supersededAt; newer ones stay', async () => {
    db.bookingAction.findUnique.mockResolvedValue({
      id: 'a1', conversationId: 'c1', bookingId: '77', type: 'CHANGE', field: 'pickup_time', proposedValue: '09:00', state: 'OPEN', tier: 'AI', sourceMessageId: 'm2',
    } as never)
    db.conversation.findUnique.mockResolvedValue({ id: 'c1', bookingData: booking(), isTest: false, contact: { phone: '4915112345678' } } as never)
    vi.mocked(ensureFreshBookingData).mockResolvedValue(booking({ pickup: { meeting_point: 'Surabaya Airport', pickup_time: '09:00' } }))
    db.bookingFact.findMany.mockResolvedValue([
      { id: 'f-old', bookingId: '77', sourceMessageId: 'm1' },
      { id: 'f-new', bookingId: '77', sourceMessageId: 'm3' },
      { id: 'f-other-booking', bookingId: '55', sourceMessageId: 'm1' },
    ] as never)
    db.message.findMany.mockResolvedValue([
      { id: 'm1', createdAt: new Date('2026-10-20T01:00:00Z') },
      { id: 'm2', createdAt: new Date('2026-10-20T02:00:00Z') },
      { id: 'm3', createdAt: new Date('2026-10-20T03:00:00Z') },
    ] as never)
    expect((await executeBookingAction({ actionId: 'a1', accountId: 'acc1', now: NOW })).status).toBe(200)
    expect(db.bookingFact.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { conversationId: 'c1', supersededAt: null, field: { in: ['pickup_time'] } } }))
    expect(db.bookingFact.update.mock.calls.map(([a]) => a.where.id)).toEqual(['f-old'])
  })
})

describe('final review Important 6: Bali vendor notice only with the written values', () => {
  it('passes the written transport values as `expected`, so a stale refresh cannot be sent', async () => {
    db.bookingAction.findUnique.mockResolvedValue({
      id: 'a1', conversationId: 'c1', bookingId: '77', type: 'CHANGE', field: 'pickup_time', proposedValue: '09:00', state: 'OPEN', tier: 'BALI',
    } as never)
    db.conversation.findUnique.mockResolvedValue({ id: 'c1', bookingData: booking(), isTest: false, contact: { phone: '4915112345678' } } as never)
    vi.mocked(ensureFreshBookingData).mockResolvedValue(null) // penyegaran pasca-tulis gagal
    expect((await executeBookingAction({ actionId: 'a1', accountId: 'acc1', now: NOW })).status).toBe(200)
    expect(notifyBaliVendor).toHaveBeenCalledWith(expect.objectContaining({ expected: [{ field: 'pickup_time', value: '09:00' }] }))
  })
})

describe('owner 2026-10-20: guest confirmation + t-shirt vendor after a successful execute', () => {
  const tshirtBooking = (sizes: string) => booking({ total_pax: 3, tshirtSize: sizes })
  const run = async (over: Record<string, unknown>, opts: { accountId?: string | null; bd?: BookingData; after?: BookingData; detail?: string } = {}) => {
    db.bookingAction.findUnique.mockResolvedValue({
      id: 'a1', conversationId: 'c1', bookingId: '77', type: 'CHANGE', state: 'OPEN', tier: 'AI', sourceMessageId: 'm0', ...over,
    } as never)
    db.conversation.findUnique.mockResolvedValue({ id: 'c1', bookingData: opts.bd ?? booking(), contact: { phone: '4915112345678' } } as never)
    vi.mocked(ensureFreshBookingData).mockResolvedValue(opts.after ?? booking())
    const accountId = opts.accountId === undefined ? 'acc1' : opts.accountId
    return executeBookingAction({
      actionId: 'a1', accountId, now: NOW, ...(opts.detail ? { detail: opts.detail } : {}),
      ...(accountId === null ? { actor: 'SYSTEM' as const, closedReason: 'AUTO_APPLIED' as const } : {}),
    })
  }

  it('auto-apply (deferGuestNotice) tshirt success -> NO guest notice here (auto-apply sends one combined) + one vendor notice', async () => {
    const after = tshirtBooking('L x 2, XL x 1')
    db.bookingAction.findUnique.mockResolvedValue({
      id: 'a1', conversationId: 'c1', bookingId: '77', type: 'CHANGE', state: 'OPEN', tier: 'AI', sourceMessageId: 'm0', field: 'tshirt_sizes', proposedValue: 'L x 2, XL x 1',
    } as never)
    db.conversation.findUnique.mockResolvedValue({ id: 'c1', bookingData: tshirtBooking('M x 3'), contact: { phone: '4915112345678' } } as never)
    vi.mocked(ensureFreshBookingData).mockResolvedValue(after)
    const res = await executeBookingAction({ actionId: 'a1', accountId: null, actor: 'SYSTEM', closedReason: 'AUTO_APPLIED', deferGuestNotice: true, now: NOW })
    expect(res.status).toBe(200)
    expect(notifyGuestOfUpdate).not.toHaveBeenCalled()
    expect(notifyTshirtVendor).toHaveBeenCalledTimes(1)
    expect(notifyTshirtVendor).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'a1', sizes: 'L x 2, XL x 1', booking: after }))
    expect(vi.mocked(notifyTshirtVendor).mock.calls[0][0].idempotencyKey).toBeUndefined()
  })

  it('manual Setujui -> one guest notice with the account; point + detail (isian) both listed; non-tshirt -> no vendor notice', async () => {
    const r = await run({ field: 'pickup_point', proposedValue: 'Surabaya Hotel' }, { detail: 'Hotel Majapahit' })
    expect(r.status).toBe(200)
    expect(notifyGuestOfUpdate).toHaveBeenCalledTimes(1)
    expect(notifyGuestOfUpdate).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'c1', bookingId: '77', accountId: 'acc1',
      items: [{ actionId: 'a1', sourceMessageId: 'm0', written: [{ field: 'pickup_point', value: 'Surabaya Hotel' }, { field: 'pickup_detail', value: 'Hotel Majapahit' }] }],
    }))
    expect(notifyTshirtVendor).not.toHaveBeenCalled()
  })

  it('failed write -> neither guest nor vendor notice', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as never)
    expect((await run({ field: 'tshirt_sizes', proposedValue: 'L x 2, XL x 1' }, { bd: tshirtBooking('M x 3') })).status).toBe(502)
    expect(notifyGuestOfUpdate).not.toHaveBeenCalled()
    expect(notifyTshirtVendor).not.toHaveBeenCalled()
  })

  it('a rejecting guest notice does not change the response', async () => {
    vi.mocked(notifyGuestOfUpdate).mockRejectedValueOnce(new Error('boom'))
    expect((await run({ field: 'pickup_time', proposedValue: '09:00' })).status).toBe(200)
  })

  it('revert of a tshirt change -> one vendor notice with tshirt_revert key and the restored sizes; guest NOT messaged', async () => {
    db.bookingAction.findUnique.mockResolvedValue({
      id: 'a1', conversationId: 'c1', bookingId: '77', type: 'CHANGE', field: 'tshirt_sizes', proposedValue: 'L x 2, XL x 1', state: 'EXECUTED', tier: 'AI',
    } as never)
    db.bookingAction.findMany.mockResolvedValue([{ id: 'a1', field: 'tshirt_sizes' }] as never)
    db.bookingActionEvent.findMany.mockResolvedValue([{
      id: 'e1', actionId: 'a1', event: 'EXECUTED', oldValue: 'M x 3', newValue: 'L x 2, XL x 1', backoffice: { written: ['tshirt'], batch: ['a1'] }, createdAt: NOW,
    }] as never)
    db.conversation.findUnique.mockResolvedValue({ id: 'c1', bookingData: tshirtBooking('L x 2, XL x 1'), contact: { phone: '4915112345678' } } as never)
    vi.mocked(ensureFreshBookingData).mockResolvedValue(tshirtBooking('M x 3'))
    const r = await revertBookingAction({ actionId: 'a1', accountId: 'acc1' })
    expect(r.status).toBe(200)
    expect(notifyTshirtVendor).toHaveBeenCalledTimes(1)
    expect(notifyTshirtVendor).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'tshirt_revert:a1', sizes: 'M x 3' }))
    expect(notifyGuestOfUpdate).not.toHaveBeenCalled()
    // Tamu belum pernah dikabari: tanpa petunjuk, tanpa push "kabari tamu".
    expect(r.body).not.toHaveProperty('hint')
    expect(notifyBookingAction).not.toHaveBeenCalled()
  })

  it('revert after the guest WAS notified -> push "Kabari tamu manual — perubahan dibatalkan" (own tag) + hint in the response', async () => {
    db.bookingAction.findUnique.mockResolvedValue({
      id: 'a1', conversationId: 'c1', bookingId: '77', type: 'CHANGE', field: 'pickup_time', proposedValue: '09:00', state: 'EXECUTED', tier: 'AI', createdAt: NOW,
    } as never)
    db.bookingAction.findMany.mockResolvedValue([{ id: 'a1', field: 'pickup_time' }] as never)
    db.bookingActionEvent.findMany.mockResolvedValue([{
      id: 'e1', actionId: 'a1', event: 'EXECUTED', oldValue: '10:30', newValue: '09:00', backoffice: { written: ['pickup'], batch: ['a1'] }, createdAt: NOW,
    }] as never)
    db.bookingActionEvent.findFirst.mockResolvedValue({ id: 'g1' } as never)
    db.conversation.findUnique.mockResolvedValue({
      id: 'c1', bookingData: booking({ id: 'JVTO-3899', pickup: { meeting_point: 'Surabaya Airport', meeting_point_value: 'GA 300', pickup_time: '09:00' } }), contact: { phone: '4915112345678' },
    } as never)
    vi.mocked(ensureFreshBookingData).mockResolvedValue(booking({ id: 'JVTO-3899' }))
    const r = await revertBookingAction({ actionId: 'a1', accountId: 'acc1' })
    expect(r).toEqual({ status: 200, body: { ok: true, state: 'REVERTED', reverted: ['a1'], hint: GUEST_REVERT_HINT } })
    expect(db.bookingActionEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { actionId: { in: ['a1'] }, event: 'GUEST_NOTICE_SENT', createdAt: { gte: NOW } } }))
    expect(notifyBookingAction).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'GUEST_NOTICE_FAILED', summary: 'Kabari tamu manual — perubahan dibatalkan', tagSuffix: 'guest-revert', actionId: 'a1', bookingCode: 'JVTO-3899',
    }))
  })

  it('revert of a non-tshirt change -> no vendor kaos notice, no guest notice', async () => {
    db.bookingAction.findUnique.mockResolvedValue({
      id: 'a1', conversationId: 'c1', bookingId: '77', type: 'CHANGE', field: 'pickup_time', proposedValue: '09:00', state: 'EXECUTED', tier: 'AI',
    } as never)
    db.bookingAction.findMany.mockResolvedValue([{ id: 'a1', field: 'pickup_time' }] as never)
    db.bookingActionEvent.findMany.mockResolvedValue([{
      id: 'e1', actionId: 'a1', event: 'EXECUTED', oldValue: '10:30', newValue: '09:00', backoffice: { written: ['pickup'], batch: ['a1'] }, createdAt: NOW,
    }] as never)
    db.conversation.findUnique.mockResolvedValue({
      id: 'c1', bookingData: booking({ pickup: { meeting_point: 'Surabaya Airport', meeting_point_value: 'GA 300', pickup_time: '09:00' } }), contact: { phone: '4915112345678' },
    } as never)
    vi.mocked(ensureFreshBookingData).mockResolvedValue(booking())
    expect((await revertBookingAction({ actionId: 'a1', accountId: 'acc1' })).status).toBe(200)
    expect(notifyTshirtVendor).not.toHaveBeenCalled()
    expect(notifyGuestOfUpdate).not.toHaveBeenCalled()
  })
})
