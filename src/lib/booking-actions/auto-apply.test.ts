/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import type { BookingData } from '@/lib/booking/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('./execute', () => ({ executeBookingAction: vi.fn() }))
vi.mock('@/lib/push/send', async (orig) => ({ ...(await orig<typeof import('@/lib/push/send')>()), notifyBookingAction: vi.fn() }))

import { prisma } from '@/lib/db'
import { notifyBookingAction } from '@/lib/push/send'
import { executeBookingAction } from './execute'
import { autoApplyCreated, autoApplyIfAllowed } from './auto-apply'

const db = prisma as unknown as DeepMockProxy<PrismaClient>
const booking = (over: Partial<BookingData> = {}): BookingData => ({
  booking_id: 77,
  id: 'JVTO-3899',
  pickup: { meeting_point: 'Surabaya Airport', meeting_point_value: 'GA 300', pickup_time: '10:30' },
  ...over,
})
const action = (over: Record<string, unknown> = {}) => ({
  id: 'a1', conversationId: 'c1', bookingId: '77', type: 'CHANGE', field: 'pickup_time', tier: 'AI', state: 'OPEN',
  proposedValue: '09:00', sourceMessageId: 'm1', ...over,
})
const settings = (light: string, bali = 'APPROVE') => db.settings.findUnique.mockResolvedValue({ bookingLightApproval: light, bookingBaliApproval: bali } as never)
const OK = { status: 200, body: { ok: true, state: 'EXECUTED', executed: ['a1'], written: ['pickup'] } } as never

beforeEach(() => {
  mockReset(db)
  vi.mocked(executeBookingAction).mockReset().mockResolvedValue(OK)
  vi.mocked(notifyBookingAction).mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  db.bookingAction.findUnique.mockResolvedValue(action() as never)
  db.bookingAction.findMany.mockResolvedValue([{ id: 'a1', field: 'pickup_time', proposedValue: '09:00', sourceMessageId: 'm1' }] as never)
  db.conversation.findUnique.mockResolvedValue({ bookingData: booking() } as never)
  settings('ALWAYS')
})

describe('autoApplyIfAllowed', () => {
  it('ALWAYS light -> applied without click, event actor SYSTEM (no account) and AUTO_APPLIED', async () => {
    expect(await autoApplyIfAllowed('a1')).toBe('applied')
    expect(executeBookingAction).toHaveBeenCalledWith({ actionId: 'a1', accountId: null, actor: 'SYSTEM', closedReason: 'AUTO_APPLIED' })
    expect(notifyBookingAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'AUTO_APPLIED', actionId: 'a1', bookingCode: 'JVTO-3899', summary: 'Jam jemput → 09:00' }))
  })

  it('ALWAYS never applies HEAVY, TASK, MISMATCH or non-writable fields', async () => {
    db.bookingAction.findUnique.mockResolvedValue(action({ tier: 'HEAVY', field: 'travel_date', proposedValue: '2026-11-05' }) as never)
    expect(await autoApplyIfAllowed('a1')).toBe('skipped')
    db.bookingAction.findUnique.mockResolvedValue(action({ type: 'TASK', tier: 'HEAVY' }) as never)
    expect(await autoApplyIfAllowed('a1')).toBe('skipped')
    db.bookingAction.findUnique.mockResolvedValue(action({ type: 'MISMATCH' }) as never)
    expect(await autoApplyIfAllowed('a1')).toBe('skipped')
    db.bookingAction.findUnique.mockResolvedValue(action({ field: 'note', proposedValue: 'vegetarian' }) as never)
    expect(await autoApplyIfAllowed('a1')).toBe('skipped')
    db.bookingAction.findUnique.mockResolvedValue(action({ field: 'pickup_arrival', proposedValue: 'GA 300' }) as never)
    expect(await autoApplyIfAllowed('a1')).toBe('skipped')
    expect(executeBookingAction).not.toHaveBeenCalled()
  })

  it('APPROVE -> stays OPEN (nothing executed, nothing pushed); missing settings row or read error also = APPROVE', async () => {
    settings('APPROVE')
    expect(await autoApplyIfAllowed('a1')).toBe('skipped')
    db.settings.findUnique.mockResolvedValue(null as never)
    expect(await autoApplyIfAllowed('a1')).toBe('skipped')
    db.settings.findUnique.mockRejectedValue(new Error('db'))
    expect(await autoApplyIfAllowed('a1')).toBe('skipped')
    expect(executeBookingAction).not.toHaveBeenCalled()
    expect(notifyBookingAction).not.toHaveBeenCalled()
  })

  it('BALI tier follows bookingBaliApproval, not the light switch', async () => {
    db.bookingAction.findUnique.mockResolvedValue(action({ tier: 'BALI' }) as never)
    settings('ALWAYS', 'APPROVE')
    expect(await autoApplyIfAllowed('a1')).toBe('skipped')
    settings('APPROVE', 'ALWAYS')
    expect(await autoApplyIfAllowed('a1')).toBe('applied')
  })

  it('auto-apply failure -> failed, EXECUTE_FAILED push (core already reopened the card + wrote the event)', async () => {
    vi.mocked(executeBookingAction).mockResolvedValue({ status: 502, body: { error: 'Backoffice gagal' } } as never)
    expect(await autoApplyIfAllowed('a1')).toBe('failed')
    expect(notifyBookingAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'EXECUTE_FAILED', actionId: 'a1' }))
    expect(notifyBookingAction).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'AUTO_APPLIED' }))
  })

  it('a thrown error never escapes', async () => {
    vi.mocked(executeBookingAction).mockRejectedValue(new Error('boom'))
    await expect(autoApplyIfAllowed('a1')).resolves.toBe('failed')
  })

  it('pre-claim refusals (booking changed / not configured / already closed) are skipped without a failure push', async () => {
    for (const status of [409, 503, 404]) {
      vi.mocked(executeBookingAction).mockResolvedValue({ status, body: { error: 'x' } } as never)
      expect(await autoApplyIfAllowed('a1')).toBe('skipped')
    }
    expect(notifyBookingAction).not.toHaveBeenCalled()
  })

  it('booking changed since the card was made -> skipped before executing', async () => {
    db.conversation.findUnique.mockResolvedValue({ bookingData: booking({ booking_id: 99 }) } as never)
    expect(await autoApplyIfAllowed('a1')).toBe('skipped')
    expect(executeBookingAction).not.toHaveBeenCalled()
  })

  describe('point cards need a usable detail', () => {
    const point = () => action({ field: 'pickup_point', proposedValue: 'Surabaya Hotel' })
    it('booking already has a detail and no detail card -> left OPEN, no push', async () => {
      db.bookingAction.findUnique.mockResolvedValue(point() as never)
      db.bookingAction.findMany.mockResolvedValue([] as never)
      expect(await autoApplyIfAllowed('a1')).toBe('skipped')
      expect(executeBookingAction).not.toHaveBeenCalled()
      expect(notifyBookingAction).not.toHaveBeenCalled()
    })

    it('with an OPEN detail card (same side) both are written in one execute and each gets its AUTO_APPLIED push', async () => {
      db.bookingAction.findUnique.mockResolvedValue(point() as never)
      db.bookingAction.findMany
        .mockResolvedValueOnce([{ field: 'pickup_detail', tier: 'AI', proposedValue: 'Hotel Majapahit' }] as never)
        .mockResolvedValueOnce([
          { id: 'a1', field: 'pickup_point', proposedValue: 'Surabaya Hotel', sourceMessageId: 'm1' },
          { id: 'a2', field: 'pickup_detail', proposedValue: 'Hotel Majapahit', sourceMessageId: 'm1' },
        ] as never)
      vi.mocked(executeBookingAction).mockResolvedValue({ status: 200, body: { ok: true, state: 'EXECUTED', executed: ['a1', 'a2'], written: ['pickup'] } } as never)
      expect(await autoApplyIfAllowed('a1')).toBe('applied')
      expect(executeBookingAction).toHaveBeenCalledTimes(1)
      expect(vi.mocked(notifyBookingAction).mock.calls.map((c) => c[0].actionId)).toEqual(['a1', 'a2'])
    })

    it('a companion card in a tier that is not ALWAYS blocks the whole pair', async () => {
      db.bookingAction.findUnique.mockResolvedValue(point() as never)
      db.bookingAction.findMany.mockResolvedValue([{ field: 'pickup_detail', tier: 'BALI', proposedValue: 'Hotel Majapahit' }] as never)
      expect(await autoApplyIfAllowed('a1')).toBe('skipped')
      expect(executeBookingAction).not.toHaveBeenCalled()
    })

    it('booking with no detail yet -> point alone may be applied', async () => {
      db.bookingAction.findUnique.mockResolvedValue(point() as never)
      db.bookingAction.findMany.mockResolvedValueOnce([] as never)
      db.conversation.findUnique.mockResolvedValue({ bookingData: booking({ pickup: { meeting_point: 'Surabaya Airport', pickup_time: '10:30' } }) } as never)
      expect(await autoApplyIfAllowed('a1')).toBe('applied')
    })

    it('client still refusing with "Isi detail titik baru dulu" -> skipped, no failure push', async () => {
      db.bookingAction.findUnique.mockResolvedValue(point() as never)
      db.bookingAction.findMany.mockResolvedValueOnce([{ field: 'pickup_detail', tier: 'AI', proposedValue: 'X' }] as never)
      vi.mocked(executeBookingAction).mockResolvedValue({ status: 400, body: { error: 'Isi detail titik baru dulu' } } as never)
      expect(await autoApplyIfAllowed('a1')).toBe('skipped')
      expect(notifyBookingAction).not.toHaveBeenCalled()
    })
  })
})

describe('autoApplyCreated', () => {
  it('runs the ids one at a time and never throws', async () => {
    db.bookingAction.findUnique.mockRejectedValueOnce(new Error('db')).mockResolvedValue(action({ id: 'a2' }) as never)
    await expect(autoApplyCreated(['a1', 'a2'])).resolves.toBeUndefined()
    expect(executeBookingAction).toHaveBeenCalledTimes(1)
  })
})
