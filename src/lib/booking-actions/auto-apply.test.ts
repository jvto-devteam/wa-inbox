/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import type { BookingData } from '@/lib/booking/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('./execute', () => ({ executeBookingAction: vi.fn(), ALREADY_APPLIED_ERROR: 'sudah' }))
vi.mock('./guest-notice', () => ({ notifyGuestOfUpdate: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/push/send', async (orig) => ({ ...(await orig<typeof import('@/lib/push/send')>()), notifyBookingAction: vi.fn() }))

import { prisma } from '@/lib/db'
import { notifyBookingAction } from '@/lib/push/send'
import { executeBookingAction } from './execute'
import { notifyGuestOfUpdate } from './guest-notice'
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
  vi.mocked(notifyGuestOfUpdate).mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  db.bookingAction.findUnique.mockResolvedValue(action() as never)
  db.bookingAction.findMany.mockResolvedValue([{ id: 'a1', field: 'pickup_time', proposedValue: '09:00', sourceMessageId: 'm1' }] as never)
  db.conversation.findUnique.mockResolvedValue({ bookingData: booking(), isTest: false, contact: { phone: '4915112345678' } } as never)
  settings('ALWAYS')
  // Perilaku sesudah rollout dibuka (R25); gerbang rollout diuji tersendiri.
  process.env.BOOKING_ACTIONS_ROLLOUT = 'all'
})
afterEach(() => {
  delete process.env.BOOKING_ACTIONS_ROLLOUT
  delete process.env.BOOKING_ACTIONS_TEST_PHONES
})

describe("final review Important 7 (R25): rollout gate on auto-apply", () => {
  it("rollout 'test' (default): a normal guest's card is never auto-applied; a test phone's card is", async () => {
    delete process.env.BOOKING_ACTIONS_ROLLOUT
    expect(await autoApplyIfAllowed('a1')).toBe('skipped')
    expect(executeBookingAction).not.toHaveBeenCalled()

    process.env.BOOKING_ACTIONS_TEST_PHONES = '6282143403501'
    db.conversation.findUnique.mockResolvedValue({ bookingData: booking(), isTest: false, contact: { phone: '6282143403501' } } as never)
    expect(await autoApplyIfAllowed('a1')).toBe('applied')
    expect(executeBookingAction).toHaveBeenCalledTimes(1)
  })
})

describe('autoApplyIfAllowed', () => {
  it('ALWAYS light -> applied without click, event actor SYSTEM (no account) and AUTO_APPLIED', async () => {
    expect(await autoApplyIfAllowed('a1')).toBe('applied')
    expect(executeBookingAction).toHaveBeenCalledWith({ actionId: 'a1', accountId: null, actor: 'SYSTEM', closedReason: 'AUTO_APPLIED', deferGuestNotice: true })
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

  it('R8 fill-CHANGE (booking field empty, e.g. detail) under ALWAYS is auto-applied', async () => {
    db.bookingAction.findUnique.mockResolvedValue(action({ field: 'pickup_detail', proposedValue: 'Hotel X' }) as never)
    db.bookingAction.findMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ id: 'a1', field: 'pickup_detail', proposedValue: 'Hotel X', sourceMessageId: 'm1' }] as never)
    db.conversation.findUnique.mockResolvedValue({ bookingData: booking({ pickup: { meeting_point: 'Surabaya Hotel', pickup_time: '10:30' } }) } as never)
    expect(await autoApplyIfAllowed('a1')).toBe('applied')
    expect(executeBookingAction).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'a1', actor: 'SYSTEM' }))
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

  it('value already in the booking after an ack -> "sudah sesuai" confirmation to the guest (variant matched)', async () => {
    vi.mocked(executeBookingAction).mockResolvedValue({ status: 409, body: { error: 'sudah' } } as never)
    db.bookingActionEvent.findFirst.mockResolvedValue({ id: 'e1' } as never)
    expect(await autoApplyIfAllowed('a1')).toBe('skipped')
    expect(notifyGuestOfUpdate).toHaveBeenCalledTimes(1)
    expect(vi.mocked(notifyGuestOfUpdate).mock.calls[0][0]).toMatchObject({
      conversationId: 'c1', variant: 'matched', items: [{ actionId: 'a1', written: [{ field: 'pickup_time', value: '09:00' }] }],
    })
    expect(notifyBookingAction).not.toHaveBeenCalled()
  })

  it('value already in the booking but NO ack was sent -> nothing to the guest', async () => {
    vi.mocked(executeBookingAction).mockResolvedValue({ status: 409, body: { error: 'sudah' } } as never)
    db.bookingActionEvent.findFirst.mockResolvedValue(null as never)
    expect(await autoApplyIfAllowed('a1')).toBe('skipped')
    expect(notifyGuestOfUpdate).not.toHaveBeenCalled()
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

    it('with an OPEN detail card (same side) both are written in one execute and share ONE AUTO_APPLIED push + one guest notice', async () => {
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
      expect(notifyBookingAction).toHaveBeenCalledTimes(1)
      expect(notifyBookingAction).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'AUTO_APPLIED', actionId: 'a1', messageId: 'm1', summary: 'Titik jemput → Surabaya Hotel; Detail jemput diperbarui — buka chat',
      }))
      expect(notifyGuestOfUpdate).toHaveBeenCalledTimes(1)
      expect(vi.mocked(notifyGuestOfUpdate).mock.calls[0][0].items.map((i) => i.actionId)).toEqual(['a1', 'a2'])
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

const changeEvent = (id = 'a1') => ({
  kind: 'CHANGE' as const, conversationId: 'c1', bookingCode: 'JVTO-3899', summary: 'Jam jemput → 09:00', actionId: id, messageId: 'm1',
})

describe('autoApplyCreated', () => {
  it('runs the events one at a time and never throws', async () => {
    db.bookingAction.findUnique.mockRejectedValueOnce(new Error('db')).mockResolvedValue(action({ id: 'a2' }) as never)
    await expect(autoApplyCreated([changeEvent('a1'), changeEvent('a2')])).resolves.toBeUndefined()
    expect(executeBookingAction).toHaveBeenCalledTimes(1)
  })

  it('auto-applied CHANGE: exactly one push, AUTO_APPLIED, no CHANGE push', async () => {
    await autoApplyCreated([changeEvent()])
    expect(notifyBookingAction).toHaveBeenCalledTimes(1)
    expect(notifyBookingAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'AUTO_APPLIED', actionId: 'a1' }))
  })

  it('setting APPROVE (admin switched it): the held CHANGE push goes out, nothing is executed', async () => {
    settings('APPROVE')
    await autoApplyCreated([changeEvent()])
    expect(executeBookingAction).not.toHaveBeenCalled()
    expect(notifyBookingAction).toHaveBeenCalledTimes(1)
    expect(notifyBookingAction).toHaveBeenCalledWith(changeEvent())
  })

  it('needs-detail skip leaves the card OPEN: one CHANGE push', async () => {
    vi.mocked(executeBookingAction).mockResolvedValue({ status: 400, body: { error: 'Isi detail titik baru dulu' } } as never)
    await autoApplyCreated([changeEvent()])
    expect(notifyBookingAction).toHaveBeenCalledTimes(1)
    expect(notifyBookingAction).toHaveBeenCalledWith(changeEvent())
  })

  it('409/503 lookup skip leaves the card OPEN: one CHANGE push', async () => {
    vi.mocked(executeBookingAction).mockResolvedValue({ status: 503, body: { error: 'x' } } as never)
    await autoApplyCreated([changeEvent()])
    expect(notifyBookingAction).toHaveBeenCalledTimes(1)
    expect(notifyBookingAction).toHaveBeenCalledWith(changeEvent())
  })

  it('failure: EXECUTE_FAILED only, never the CHANGE push', async () => {
    vi.mocked(executeBookingAction).mockResolvedValue({ status: 502, body: { error: 'Backoffice gagal' } } as never)
    await autoApplyCreated([changeEvent()])
    expect(notifyBookingAction).toHaveBeenCalledTimes(1)
    expect(notifyBookingAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'EXECUTE_FAILED', actionId: 'a1' }))
  })

  it('unexpected error after the card was fetched: EXECUTE_FAILED fallback from the held event', async () => {
    vi.mocked(executeBookingAction).mockRejectedValue(new Error('boom'))
    await autoApplyCreated([changeEvent()])
    expect(notifyBookingAction).toHaveBeenCalledTimes(1)
    expect(notifyBookingAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'EXECUTE_FAILED', actionId: 'a1', summary: 'Jam jemput → 09:00' }))
  })

  it('a companion card closed by its partner\'s write gets no CHANGE push', async () => {
    db.bookingAction.findUnique
      .mockResolvedValueOnce(action({ id: 'a2', state: 'EXECUTED' }) as never) // decide(): not OPEN -> skipped
      .mockResolvedValueOnce({ state: 'EXECUTED' } as never) // state check
    await autoApplyCreated([changeEvent('a2')])
    expect(notifyBookingAction).not.toHaveBeenCalled()
  })

  it("rollout 'test' with a non-test guest: nothing executed, CHANGE push goes out (card stays for a human)", async () => {
    delete process.env.BOOKING_ACTIONS_ROLLOUT
    await autoApplyCreated([changeEvent()])
    expect(executeBookingAction).not.toHaveBeenCalled()
    expect(notifyBookingAction).toHaveBeenCalledWith(changeEvent())
  })
})

describe('review 2026-10-20 Important 2: one guest message -> one Noted + one AUTO_APPLIED push', () => {
  it('pickup point+detail, time and tshirt from one message: ONE combined guest notice and ONE AUTO_APPLIED push', async () => {
    const cards: Record<string, Record<string, unknown>> = {
      a1: action({ id: 'a1', field: 'pickup_point', proposedValue: 'Surabaya Hotel' }),
      a3: action({ id: 'a3', field: 'pickup_time', proposedValue: '09:30' }),
      a4: action({ id: 'a4', field: 'tshirt_sizes', proposedValue: 'L x 2, XL x 1' }),
    }
    const executed: Record<string, string[]> = { a1: ['a1', 'a2'], a3: ['a3'], a4: ['a4'] }
    const rows: Record<string, unknown> = {
      a1: { id: 'a1', field: 'pickup_point', proposedValue: 'Surabaya Hotel', sourceMessageId: 'm1' },
      a2: { id: 'a2', field: 'pickup_detail', proposedValue: 'Hotel Majapahit', sourceMessageId: 'm1' },
      a3: { id: 'a3', field: 'pickup_time', proposedValue: '09:30', sourceMessageId: 'm1' },
      a4: { id: 'a4', field: 'tshirt_sizes', proposedValue: 'L x 2, XL x 1', sourceMessageId: 'm1' },
    }
    db.bookingAction.findUnique.mockImplementation((async (a: { where: { id: string } }) => cards[a.where.id] ?? null) as never)
    db.bookingAction.findMany.mockImplementation((async (a: { where: { id?: { in: string[] }; field?: unknown } }) => {
      if (a.where.id) return a.where.id.in.map((id) => rows[id])
      return [{ field: 'pickup_detail', tier: 'AI', proposedValue: 'Hotel Majapahit' }] // pendamping titik
    }) as never)
    db.conversation.findUnique.mockResolvedValue({ bookingData: booking({ pickup: { meeting_point: 'Surabaya Airport', pickup_time: '10:30' } }), isTest: false, contact: { phone: '4915112345678' } } as never)
    vi.mocked(executeBookingAction).mockImplementation((async (i: { actionId: string }) =>
      ({ status: 200, body: { ok: true, state: 'EXECUTED', executed: executed[i.actionId], written: ['pickup'] } })) as never)

    await autoApplyCreated(['a1', 'a3', 'a4'].map((id) => ({ kind: 'CHANGE' as const, conversationId: 'c1', bookingCode: 'JVTO-3899', summary: 's', actionId: id })))

    expect(executeBookingAction).toHaveBeenCalledTimes(3)
    for (const c of vi.mocked(executeBookingAction).mock.calls) expect(c[0]).toMatchObject({ deferGuestNotice: true })
    expect(notifyBookingAction).toHaveBeenCalledTimes(1)
    expect(notifyBookingAction).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'AUTO_APPLIED', actionId: 'a1',
      summary: 'Titik jemput → Surabaya Hotel; Detail jemput diperbarui — buka chat; Jam jemput → 09:30; Ukuran kaos → L x 2, XL x 1',
    }))
    expect(notifyGuestOfUpdate).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(notifyGuestOfUpdate).mock.calls[0][0]
    expect(arg).toMatchObject({ conversationId: 'c1', accountId: null, bookingId: '77' })
    expect(arg.items).toEqual([
      { actionId: 'a1', sourceMessageId: 'm1', written: [{ field: 'pickup_point', value: 'Surabaya Hotel' }] },
      { actionId: 'a2', sourceMessageId: 'm1', written: [{ field: 'pickup_detail', value: 'Hotel Majapahit' }] },
      { actionId: 'a3', sourceMessageId: 'm1', written: [{ field: 'pickup_time', value: '09:30' }] },
      { actionId: 'a4', sourceMessageId: 'm1', written: [{ field: 'tshirt_sizes', value: 'L x 2, XL x 1' }] },
    ])
  })

  it('minor: the post-execute read throwing never turns a written change into EXECUTE_FAILED', async () => {
    db.bookingAction.findMany.mockRejectedValue(new Error('db blip'))
    expect(await autoApplyIfAllowed('a1')).toBe('applied')
    expect(notifyBookingAction).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'EXECUTE_FAILED' }))
  })
})
