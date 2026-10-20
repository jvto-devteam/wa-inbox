/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import type { BookingData } from '@/lib/booking/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/send', () => ({ sendMessage: vi.fn() }))
vi.mock('@/lib/booking/client', () => ({ lookupBookingResult: vi.fn() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))
vi.mock('./store', () => ({ reevaluateBookingActions: vi.fn().mockResolvedValue({ resolved: 0, opened: 0 }) }))
vi.mock('@/lib/push/send', async (orig) => ({ ...(await orig<typeof import('@/lib/push/send')>()), notifyBookingAction: vi.fn() }))

import { prisma } from '@/lib/db'
import { sendMessage } from '@/lib/send'
import { lookupBookingResult } from '@/lib/booking/client'
import { notifyBookingAction } from '@/lib/push/send'
import { reevaluateBookingActions } from './store'
import { buildDataRequestText, createDataRequestDrafts, findDataGaps, sendDataRequest } from './data-requests'

const db = prisma as unknown as DeepMockProxy<PrismaClient>
// 2026-10-20 10:00 WIB (03:00 UTC): di dalam jam kirim, hari ini = 2026-10-20.
const NOW = new Date('2026-10-20T03:00:00Z')
const FRESH_INBOUND = new Date('2026-10-20T01:00:00Z')
const OLD_INBOUND = new Date('2026-10-18T01:00:00Z')

const booking = (over: Record<string, unknown> = {}): BookingData => ({
  booking_id: 77,
  id: 'JVTO-3899',
  date: { start_ymd: '2026-10-27' },
  pickup: { meeting_point: 'Others', pickup_time: '10:30' },
  dropoff: { drop_point: 'Surabaya Hotel', drop_time: '14:00' },
  guestDetails: { country: 'Germany' },
  ...over,
})
const conv = (over: Record<string, unknown> = {}) => ({
  id: 'c1', bookingData: booking(), isTest: false, contact: { phone: '4915112345678' }, channelIdentity: { platform: 'WHATSAPP' }, ...over,
})
const stored = (over: Record<string, unknown> = {}) => ({
  id: 'd1', conversationId: 'c1', bookingId: '77', type: 'DATA_REQUEST', state: 'OPEN', draftText: buildDataRequestText(booking(), ['pickup_detail']), forDay: '2026-10-20', lastError: null, proposedValue: ['pickup_detail'], createdAt: new Date('2026-10-20T01:30:00Z'),
  conversation: conv(), ...over,
})

function setup(opts: { convs?: unknown[]; open?: unknown[]; older?: unknown[]; todays?: unknown[]; approval?: string; inbound?: Date | null; newer?: boolean; fresh?: BookingData | 'error' | 'not_found' } = {}) {
  db.conversation.findMany.mockResolvedValue((opts.convs ?? [conv()]) as never)
  db.bookingAction.findMany.mockImplementation(((args: { where: { forDay?: unknown } }) => {
    const w = args.where
    if (typeof w.forDay === 'object' && w.forDay !== null) return Promise.resolve(opts.older ?? [])
    if (typeof w.forDay === 'string') return Promise.resolve(opts.todays ?? [])
    return Promise.resolve(opts.open ?? [])
  }) as never)
  db.bookingAction.findFirst.mockResolvedValue(null)
  db.bookingAction.create.mockResolvedValue({ id: 'd1' } as never)
  db.bookingAction.updateMany.mockResolvedValue({ count: 1 } as never)
  db.settings.findUnique.mockResolvedValue({ dataRequestApproval: opts.approval ?? 'ALWAYS' } as never)
  db.message.findFirst.mockImplementation(((args: { where: { createdAt?: unknown } }) => {
    if (args.where.createdAt) return Promise.resolve(opts.newer ? { id: 'm9' } : null) // pesan masuk lebih baru dari draf
    return Promise.resolve(opts.inbound === null ? null : { createdAt: opts.inbound ?? FRESH_INBOUND })
  }) as never)
  const f = opts.fresh
  vi.mocked(lookupBookingResult).mockResolvedValue(
    f === 'error' ? { status: 'error' } : f === 'not_found' ? { status: 'not_found' } : { status: 'found', data: f ?? booking() }
  )
  db.bookingAction.findUnique.mockResolvedValue(stored() as never)
  vi.mocked(sendMessage).mockResolvedValue({ id: 'm1', deliveryStatus: 'SENT' } as never)
}

beforeEach(() => {
  mockReset(db)
  vi.mocked(sendMessage).mockReset()
  vi.mocked(lookupBookingResult).mockReset()
  vi.mocked(notifyBookingAction).mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.mocked(reevaluateBookingActions).mockClear()
  // Kasus di file ini menguji perilaku sesudah rollout dibuka (R25); gerbang rollout diuji tersendiri di bawah.
  process.env.BOOKING_ACTIONS_ROLLOUT = 'all'
})
afterEach(() => {
  delete process.env.BOOKING_ACTIONS_ROLLOUT
  delete process.env.BOOKING_ACTIONS_TEST_PHONES
})

describe('createDataRequestDrafts', () => {
  it('H-8 -> none; H-7 -> one', async () => {
    setup({ convs: [conv({ bookingData: booking({ date: { start_ymd: '2026-10-28' } }) })] })
    expect((await createDataRequestDrafts(NOW)).created).toBe(0)
    expect(db.bookingAction.create).not.toHaveBeenCalled()

    setup({ convs: [conv({ bookingData: booking({ date: { start_ymd: '2026-10-27' } }) })] })
    expect((await createDataRequestDrafts(NOW)).created).toBe(1)
    expect(db.bookingAction.create).toHaveBeenCalledTimes(1)
    const data = db.bookingAction.create.mock.calls[0][0].data as Record<string, unknown>
    expect(data).toMatchObject({ type: 'DATA_REQUEST', bookingId: '77', forDay: '2026-10-20', state: 'OPEN', proposedValue: ['pickup_detail'] })
  })

  it('Indonesian number -> none (isTest exempt, R13)', async () => {
    setup({ convs: [conv({ contact: { phone: '6281234567890' } })] })
    expect((await createDataRequestDrafts(NOW)).created).toBe(0)
    setup({ convs: [conv({ contact: { phone: '6282143403501' }, isTest: true })] })
    expect((await createDataRequestDrafts(NOW)).created).toBe(1)
  })

  it("final review Important 7 (R25): rollout 'test' -> drafts only for test conversations; a whitelisted Indonesian test phone gets one", async () => {
    delete process.env.BOOKING_ACTIONS_ROLLOUT
    setup({ convs: [conv()] })
    expect((await createDataRequestDrafts(NOW)).created).toBe(0)
    process.env.BOOKING_ACTIONS_TEST_PHONES = '+62 821-4340-3501'
    setup({ convs: [conv(), conv({ id: 'c2', contact: { phone: '6282143403501' } })] })
    expect((await createDataRequestDrafts(NOW)).created).toBe(1)
    expect(db.bookingAction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ conversationId: 'c2' }) }))
  })

  it('no gap -> none; not WhatsApp or no phone -> none', async () => {
    setup({ convs: [conv({ bookingData: booking({ pickup: { meeting_point: 'Others', meeting_point_value: 'Hotel X', pickup_time: '10:30' } }) })] })
    expect((await createDataRequestDrafts(NOW)).created).toBe(0)
    setup({ convs: [conv({ channelIdentity: { platform: 'INSTAGRAM' } }), conv({ id: 'c2', contact: { phone: null } })] })
    expect((await createDataRequestDrafts(NOW)).created).toBe(0)
  })

  it('does not create drafts at night (before 08:00 / from 20:00 WIB)', async () => {
    setup()
    expect((await createDataRequestDrafts(new Date('2026-10-19T23:00:00Z'))).created).toBe(0) // 06:00 WIB
    expect((await createDataRequestDrafts(new Date('2026-10-20T13:00:00Z'))).created).toBe(0) // 20:00 WIB
    expect(db.bookingAction.create).not.toHaveBeenCalled()
  })

  it('default setting sends automatically within 24h window', async () => {
    setup({ todays: [{ id: 'd1' }] })
    const res = await createDataRequestDrafts(NOW)
    expect(res).toMatchObject({ created: 1, sent: 1 })
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'c1', sentBy: 'BOT', botTrace: { source: 'data_request', idempotencyKey: 'data_request:d1' },
    }))
    expect(db.bookingAction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'd1', state: 'OPEN' }, data: expect.objectContaining({ state: 'DONE', closedReason: 'SENT', closedById: null }),
    }))
    expect(db.bookingActionEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ event: 'DRAFT_SENT', actor: 'SYSTEM', actionId: 'd1' }) })
    expect(notifyBookingAction).not.toHaveBeenCalled()
  })

  it('ALWAYS + window closed -> not sent (draft stays OPEN)', async () => {
    setup({ todays: [{ id: 'd1' }], inbound: OLD_INBOUND })
    const res = await createDataRequestDrafts(NOW)
    expect(res).toMatchObject({ created: 1, sent: 0 })
    expect(sendMessage).not.toHaveBeenCalled()
    expect(db.bookingAction.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'DONE' }) }))
  })

  it('APPROVE -> created but never sent automatically', async () => {
    setup({ approval: 'APPROVE', todays: [{ id: 'd1' }] })
    const res = await createDataRequestDrafts(NOW)
    expect(res).toMatchObject({ created: 1, sent: 0 })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('same day twice -> still one', async () => {
    setup()
    db.bookingAction.findFirst.mockResolvedValue({ id: 'd1' } as never) // sudah ada hari ini
    expect((await createDataRequestDrafts(NOW)).created).toBe(0)
    expect(db.bookingAction.create).not.toHaveBeenCalled()

    // Balapan antar dua tick: cek lolos, tulis menabrak unique.
    setup()
    db.bookingAction.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
    expect((await createDataRequestDrafts(NOW)).created).toBe(0)
  })

  it("next day -> yesterday's superseded, new one created", async () => {
    setup({ older: [{ id: 'old', conversationId: 'c1', bookingId: '77' }] })
    const res = await createDataRequestDrafts(NOW)
    expect(res).toMatchObject({ created: 1, closed: 1 })
    expect(db.bookingAction.updateMany).toHaveBeenCalledWith({
      where: { id: 'old', state: 'OPEN' }, data: expect.objectContaining({ state: 'SUPERSEDED', closedReason: 'REPLACED' }),
    })
    expect(db.bookingActionEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ event: 'SUPERSEDED', actionId: 'old' }) })
  })

  it('data completed -> resolved DATA_COMPLETE', async () => {
    const complete = booking({ pickup: { meeting_point: 'Others', meeting_point_value: 'Hotel X', pickup_time: '10:30' } })
    setup({ convs: [], open: [{ id: 'old', conversationId: 'c1', bookingId: '77', forDay: '2026-10-19', conversation: { bookingData: complete } }] })
    const res = await createDataRequestDrafts(NOW)
    expect(res.closed).toBe(1)
    expect(db.bookingAction.updateMany).toHaveBeenCalledWith({
      where: { id: 'old', state: 'OPEN' }, data: expect.objectContaining({ state: 'RESOLVED', closedReason: 'DATA_COMPLETE' }),
    })
    expect(db.bookingActionEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ event: 'RESOLVED', reason: 'DATA_COMPLETE' }) })
  })

  it('trip started -> resolved TRIP_STARTED (even at night)', async () => {
    const started = booking({ date: { start_ymd: '2026-10-19' } })
    setup({ convs: [], open: [{ id: 'old', conversationId: 'c1', bookingId: '77', forDay: '2026-10-19', conversation: { bookingData: started } }] })
    const res = await createDataRequestDrafts(new Date('2026-10-20T16:00:00Z')) // 23:00 WIB
    expect(res.closed).toBe(1)
    expect(db.bookingAction.updateMany).toHaveBeenCalledWith({
      where: { id: 'old', state: 'OPEN' }, data: expect.objectContaining({ state: 'RESOLVED', closedReason: 'TRIP_STARTED' }),
    })
  })

  it('H-0 (start day) -> no draft is created, open draft closes TRIP_STARTED (R24)', async () => {
    const day0 = booking({ date: { start_ymd: '2026-10-20' } })
    setup({ convs: [conv({ bookingData: day0 })], open: [{ id: 'old', conversationId: 'c1', bookingId: '77', forDay: '2026-10-19', conversation: { bookingData: day0 } }] })
    const res = await createDataRequestDrafts(NOW)
    expect(res).toMatchObject({ created: 0, closed: 1 })
    expect(db.bookingAction.updateMany).toHaveBeenCalledWith({
      where: { id: 'old', state: 'OPEN' }, data: expect.objectContaining({ closedReason: 'TRIP_STARTED' }),
    })
  })

  it('a draft already SENT today (e.g. manual) -> no new draft for that booking', async () => {
    setup()
    db.bookingAction.findFirst.mockImplementation(((args: { where: { closedReason?: string } }) =>
      Promise.resolve(args.where.closedReason === 'SENT' ? { id: 'sent' } : null)) as never)
    expect((await createDataRequestDrafts(NOW)).created).toBe(0)
  })

  it('open draft of a different booking is left alone', async () => {
    setup({ convs: [], open: [{ id: 'old', conversationId: 'c1', bookingId: '12', forDay: '2026-10-19', conversation: { bookingData: booking() } }] })
    expect((await createDataRequestDrafts(NOW)).closed).toBe(0)
  })
})

describe('sendDataRequest', () => {
  it('window closed -> send blocked (no free text, no claim)', async () => {
    setup({ inbound: OLD_INBOUND })
    const res = await sendDataRequest({ actionId: 'd1', accountId: 'acc1', now: NOW })
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(sendMessage).not.toHaveBeenCalled()
    expect(db.bookingAction.updateMany).not.toHaveBeenCalled()
    setup({ inbound: null })
    expect((await sendDataRequest({ actionId: 'd1', accountId: 'acc1', now: NOW })).ok).toBe(false)
  })

  it('manual send: claims, sends as the account and records DRAFT_SENT/ACCOUNT', async () => {
    setup()
    expect(await sendDataRequest({ actionId: 'd1', accountId: 'acc1', now: NOW })).toEqual({ ok: true })
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ sentBy: 'AGENT', agentId: 'acc1' }))
    expect(db.bookingActionEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ event: 'DRAFT_SENT', actor: 'ACCOUNT', accountId: 'acc1' }) })
  })

  it("final review Important 7 (R25): rollout 'test' refuses sending to a normal guest (also manual); a test phone is sent after a REAL booking lookup", async () => {
    delete process.env.BOOKING_ACTIONS_ROLLOUT
    setup()
    expect(await sendDataRequest({ actionId: 'd1', accountId: 'acc1', now: NOW })).toMatchObject({ ok: false, status: 409 })
    expect(sendMessage).not.toHaveBeenCalled()
    expect(lookupBookingResult).not.toHaveBeenCalled()

    process.env.BOOKING_ACTIONS_TEST_PHONES = '6282143403501'
    setup()
    db.bookingAction.findUnique.mockResolvedValue(stored({ conversation: conv({ contact: { phone: '6282143403501' } }) }) as never)
    expect(await sendDataRequest({ actionId: 'd1', accountId: 'acc1', now: NOW })).toEqual({ ok: true })
    // Tidak seperti sandbox isTest, nomor uji punya booking sungguhan: tetap dicari.
    expect(lookupBookingResult).toHaveBeenCalledWith('6282143403501')
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('cheap minor: fresh booking is saved as JSON and the other cards are re-evaluated', async () => {
    setup()
    expect(await sendDataRequest({ actionId: 'd1', accountId: null, now: NOW })).toEqual({ ok: true })
    expect(db.conversation.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { bookingData: booking(), bookingCheckedAt: NOW } })
    expect(reevaluateBookingActions).toHaveBeenCalledWith('c1')
  })

  it('already claimed by another caller -> 409, nothing sent', async () => {
    setup()
    db.bookingAction.updateMany.mockResolvedValue({ count: 0 } as never)
    expect(await sendDataRequest({ actionId: 'd1', accountId: null, now: NOW })).toMatchObject({ ok: false, status: 409 })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('not OPEN, wrong type, changed booking, complete data, Indonesian -> refused before sending', async () => {
    setup()
    db.bookingAction.findUnique.mockResolvedValue(stored({ state: 'DONE' }) as never)
    expect(await sendDataRequest({ actionId: 'd1', accountId: null, now: NOW })).toMatchObject({ ok: false, status: 409 })
    db.bookingAction.findUnique.mockResolvedValue(stored({ type: 'CHANGE' }) as never)
    expect(await sendDataRequest({ actionId: 'd1', accountId: null, now: NOW })).toMatchObject({ ok: false, status: 404 })
    db.bookingAction.findUnique.mockResolvedValue(stored({ bookingId: '12' }) as never)
    expect(await sendDataRequest({ actionId: 'd1', accountId: null, now: NOW })).toMatchObject({ ok: false, status: 409 })
    db.bookingAction.findUnique.mockResolvedValue(stored({ conversation: conv({ bookingData: booking({ pickup: { meeting_point: 'Surabaya Hotel', pickup_time: '10:30' } }) }) }) as never)
    expect(await sendDataRequest({ actionId: 'd1', accountId: null, now: NOW })).toMatchObject({ ok: false, status: 409 })
    db.bookingAction.findUnique.mockResolvedValue(stored({ conversation: conv({ contact: { phone: '6281234567890' } }) }) as never)
    expect(await sendDataRequest({ actionId: 'd1', accountId: null, now: NOW })).toMatchObject({ ok: false, status: 409 })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('failed delivery -> back to OPEN with lastError, EXECUTE_FAILED event, push', async () => {
    setup()
    vi.mocked(sendMessage).mockResolvedValue({ id: 'm1', deliveryStatus: 'FAILED' } as never)
    expect(await sendDataRequest({ actionId: 'd1', accountId: null, now: NOW })).toMatchObject({ ok: false, status: 502 })
    expect(db.bookingAction.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'd1', state: 'DONE', closedReason: 'SENT' }, data: expect.objectContaining({ state: 'OPEN', lastError: 'Pesan gagal dikirim' }),
    })
    expect(db.bookingActionEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ event: 'EXECUTE_FAILED', reason: 'SEND_FAILED' }) })
    expect(notifyBookingAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'DATA_REQUEST_FAILED', actionId: 'd1' }))
  })

  it('a thrown send is handled the same way (never throws)', async () => {
    setup()
    vi.mocked(sendMessage).mockRejectedValue(new Error('boom'))
    expect(await sendDataRequest({ actionId: 'd1', accountId: null, now: NOW })).toMatchObject({ ok: false, status: 502 })
    expect(notifyBookingAction).toHaveBeenCalled()
  })
})

describe('sendDataRequest safeguards', () => {
  it('refreshes the booking before claiming; lookup failure -> not sent, stays OPEN, no push', async () => {
    for (const fresh of ['error', 'not_found'] as const) {
      setup({ fresh })
      const res = await sendDataRequest({ actionId: 'd1', accountId: null, now: NOW })
      expect(res).toMatchObject({ ok: false, status: 502 })
      expect(sendMessage).not.toHaveBeenCalled()
      expect(db.bookingAction.updateMany).not.toHaveBeenCalled()
      expect(notifyBookingAction).not.toHaveBeenCalled()
    }
  })

  it('fresh data complete -> RESOLVED/DATA_COMPLETE, nothing sent (auto and manual)', async () => {
    const complete = booking({ pickup: { meeting_point: 'Others', meeting_point_value: 'Hotel X', pickup_time: '10:30' } })
    for (const accountId of [null, 'acc1']) {
      setup({ fresh: complete })
      expect(await sendDataRequest({ actionId: 'd1', accountId, now: NOW })).toMatchObject({ ok: false, status: 409 })
      expect(sendMessage).not.toHaveBeenCalled()
      expect(db.bookingAction.updateMany).toHaveBeenCalledWith({
        where: { id: 'd1', state: 'OPEN' }, data: expect.objectContaining({ state: 'RESOLVED', closedReason: 'DATA_COMPLETE' }),
      })
    }
  })

  it('fresh data with different gaps -> text rebuilt from fresh data before sending', async () => {
    setup({ fresh: booking({ pickup: { meeting_point: 'Others', meeting_point_value: 'Hotel X' } }) })
    expect(await sendDataRequest({ actionId: 'd1', accountId: null, now: NOW })).toEqual({ ok: true })
    const sent = vi.mocked(sendMessage).mock.calls[0][0].text
    expect(sent).toContain('pickup time')
    expect(sent).not.toContain('hotel or the exact address')
  })

  it('auto-send skipped (left OPEN) when the guest just answered: open CHANGE, active fact, or newer inbound', async () => {
    setup()
    db.bookingAction.findFirst.mockImplementation(((args: { where: { type?: string } }) =>
      Promise.resolve(args.where.type === 'CHANGE' ? { id: 'ch' } : null)) as never)
    expect(await sendDataRequest({ actionId: 'd1', accountId: null, now: NOW })).toMatchObject({ ok: false, status: 409 })

    setup()
    db.bookingAction.findUnique.mockResolvedValue(stored({ proposedValue: ['pickup_detail'] }) as never)
    db.bookingFact.findFirst.mockResolvedValue({ id: 'f1' } as never)
    expect(await sendDataRequest({ actionId: 'd1', accountId: null, now: NOW })).toMatchObject({ ok: false, status: 409 })

    setup({ newer: true })
    expect(await sendDataRequest({ actionId: 'd1', accountId: null, now: NOW })).toMatchObject({ ok: false, status: 409 })
    expect(sendMessage).not.toHaveBeenCalled()
    expect(db.bookingAction.updateMany).not.toHaveBeenCalled()
  })

  it('manual send is not blocked by those checks (a human decides)', async () => {
    setup({ newer: true })
    expect(await sendDataRequest({ actionId: 'd1', accountId: 'acc1', now: NOW })).toEqual({ ok: true })
  })

  it('manual send of a draft from another day -> 409 expired, nothing sent', async () => {
    setup()
    db.bookingAction.findUnique.mockResolvedValue(stored({ forDay: '2026-10-19' }) as never)
    expect(await sendDataRequest({ actionId: 'd1', accountId: 'acc1', now: NOW })).toMatchObject({ ok: false, status: 409, error: 'Draf sudah kedaluwarsa' })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('already sent today (manual) then auto at 08:00 -> refused, one message per booking per day', async () => {
    setup()
    db.bookingAction.findFirst.mockImplementation(((args: { where: { closedReason?: string } }) =>
      Promise.resolve(args.where.closedReason === 'SENT' ? { id: 'other' } : null)) as never)
    expect(await sendDataRequest({ actionId: 'd1', accountId: null, now: NOW })).toMatchObject({ ok: false, status: 409 })
    expect(await sendDataRequest({ actionId: 'd1', accountId: 'acc1', now: NOW })).toMatchObject({ ok: false, status: 409 })
    expect(sendMessage).not.toHaveBeenCalled()
  })
})

describe('sendDataRequest fix round 2', () => {
  it('different booking id from the lookup -> draft closed BOOKING_CHANGED with an event, nothing sent', async () => {
    setup({ fresh: booking({ booking_id: 99 }) })
    expect(await sendDataRequest({ actionId: 'd1', accountId: null, now: NOW })).toMatchObject({ ok: false, status: 409 })
    expect(db.bookingAction.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', state: 'OPEN' }, data: expect.objectContaining({ state: 'RESOLVED', closedReason: 'BOOKING_CHANGED' }),
    })
    expect(db.bookingActionEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ event: 'RESOLVED', reason: 'BOOKING_CHANGED' }) })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('rescheduled trip with the same gaps -> text carries the new date (auto); manual gets 409 "Isi pesan berubah"', async () => {
    const moved = booking({ date: { start_ymd: '2026-10-25' } })
    setup({ fresh: moved })
    expect(await sendDataRequest({ actionId: 'd1', accountId: null, now: NOW })).toEqual({ ok: true })
    expect(vi.mocked(sendMessage).mock.calls[0][0].text).toContain('25 Oct 2026')

    vi.mocked(sendMessage).mockClear()
    setup({ fresh: moved })
    const res = await sendDataRequest({ actionId: 'd1', accountId: 'acc1', now: NOW })
    expect(res).toMatchObject({ ok: false, status: 409, error: 'Isi pesan berubah — muat ulang' })
    expect(sendMessage).not.toHaveBeenCalled()
    expect(db.bookingAction.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', state: 'OPEN' }, data: expect.objectContaining({ draftText: expect.stringContaining('25 Oct 2026') }),
    })
  })

  it('trip moved to today -> closed TRIP_STARTED; moved beyond H-7 -> OUT_OF_WINDOW; nothing sent', async () => {
    setup({ fresh: booking({ date: { start_ymd: '2026-10-20' } }) })
    expect(await sendDataRequest({ actionId: 'd1', accountId: null, now: NOW })).toMatchObject({ ok: false, status: 409 })
    expect(db.bookingAction.updateMany).toHaveBeenCalledWith({ where: { id: 'd1', state: 'OPEN' }, data: expect.objectContaining({ closedReason: 'TRIP_STARTED' }) })
    setup({ fresh: booking({ date: { start_ymd: '2026-11-20' } }) })
    expect(await sendDataRequest({ actionId: 'd1', accountId: null, now: NOW })).toMatchObject({ ok: false, status: 409 })
    expect(db.bookingAction.updateMany).toHaveBeenCalledWith({ where: { id: 'd1', state: 'OPEN' }, data: expect.objectContaining({ closedReason: 'OUT_OF_WINDOW' }) })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('airport guest who already gave a flight number (active pickup_arrival fact / open CHANGE) -> no auto-send', async () => {
    const airport = booking({ pickup: { meeting_point: 'Surabaya Airport', pickup_time: '10:30' } })
    setup({ fresh: airport })
    db.bookingAction.findUnique.mockResolvedValue(stored({ conversation: conv({ bookingData: airport }), draftText: buildDataRequestText(airport, ['pickup_detail']) }) as never)
    db.bookingFact.findFirst.mockImplementation(((args: { where: { field: { in: string[] } } }) =>
      Promise.resolve(args.where.field.in.includes('pickup_arrival') ? { id: 'f1' } : null)) as never)
    expect(await sendDataRequest({ actionId: 'd1', accountId: null, now: NOW })).toMatchObject({ ok: false, status: 409 })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('answered-check also runs on the RECOMPUTED gaps after the fresh lookup', async () => {
    // Celah tersimpan hanya pickup_time; data segar menambah drop_time, dan ada fakta aktif drop_time.
    setup({ fresh: booking({ pickup: { meeting_point: 'Surabaya Hotel', pickup_time: '10:30' }, dropoff: { drop_point: 'Surabaya Hotel' } }) })
    db.bookingAction.findUnique.mockResolvedValue(stored({ proposedValue: ['pickup_time'], conversation: conv({ bookingData: booking({ pickup: { meeting_point: 'Surabaya Hotel' } }) }) }) as never)
    db.bookingFact.findFirst.mockImplementation(((args: { where: { field: { in: string[] } } }) =>
      Promise.resolve(args.where.field.in.includes('drop_time') ? { id: 'f2' } : null)) as never)
    expect(await sendDataRequest({ actionId: 'd1', accountId: null, now: NOW })).toMatchObject({ ok: false, status: 409 })
    expect(sendMessage).not.toHaveBeenCalled()
  })
})

describe('tick auto-send budget', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `d${i}` }))

  it('booking API hanging/failing -> at most 10 lookup attempts per tick', async () => {
    setup({ convs: [], todays: many, fresh: 'error' })
    db.bookingAction.findUnique.mockResolvedValue(stored() as never)
    const res = await createDataRequestDrafts(NOW)
    expect(res.sent).toBe(0)
    expect(vi.mocked(lookupBookingResult)).toHaveBeenCalledTimes(10)
  })

  it('stops when the 30 s time budget is spent', async () => {
    setup({ convs: [], todays: many, fresh: 'error' })
    db.bookingAction.findUnique.mockResolvedValue(stored() as never)
    let clock = 1_000_000
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    vi.mocked(lookupBookingResult).mockImplementation(async () => { clock += 20_000; return { status: 'error' } })
    await createDataRequestDrafts(NOW)
    spy.mockRestore()
    expect(vi.mocked(lookupBookingResult)).toHaveBeenCalledTimes(2)
  })
})

describe('findDataGaps / buildDataRequestText', () => {
  it('lists only missing items; only null/empty times count as missing (R23: 07:00 is not asked)', () => {
    const b = booking({ pickup: { meeting_point: 'Surabaya Airport' }, dropoff: { drop_point: 'Surabaya Hotel', drop_time: '' } })
    expect(findDataGaps(b)).toEqual(['pickup_detail', 'pickup_time', 'drop_time'])
    const text = buildDataRequestText(b, findDataGaps(b))
    expect(text).toContain('flight number')
    expect(text).toContain('pickup time')
    expect(text).toContain('drop-off time')
    expect(text).not.toContain('hotel or the exact address')
    const fake = booking({ pickup: { meeting_point: 'Surabaya Hotel', pickup_time: '07:00' }, dropoff: { drop_point: 'Surabaya Hotel', drop_time: '07:00' } })
    expect(findDataGaps(fake)).toEqual([])
  })

  it('dates are human readable (EN/ID) and a missing date drops the date clause', () => {
    const en = booking({ date: { start_ymd: '2026-10-25' } })
    expect(buildDataRequestText(en, findDataGaps(en))).toContain('starts on 25 Oct 2026.')
    const id = booking({ date: { start_ymd: '2026-10-25' }, guestDetails: { country: 'Indonesia' } })
    expect(buildDataRequestText(id, findDataGaps(id))).toContain('dimulai pada 25 Okt 2026.')
    const none = booking({ date: {} })
    const text = buildDataRequestText(none, findDataGaps(none))
    expect(text).toContain('is coming up.')
    expect(text).not.toContain('on .')
  })

  it('airport/station with a flight number or any detail is complete; train gets train wording', () => {
    expect(findDataGaps(booking({ pickup: { meeting_point: 'Surabaya Airport', meeting_point_value: 'GA 300', pickup_time: '10:30' } }))).toEqual([])
    const train = booking({ pickup: { meeting_point: 'Surabaya Train Station', pickup_time: '10:30' } })
    expect(buildDataRequestText(train, findDataGaps(train))).toContain('train')
  })

  it('Indonesian guests get Indonesian text', () => {
    const b = booking({ guestDetails: { country: 'Indonesia' } })
    expect(buildDataRequestText(b, findDataGaps(b))).toContain('Terima kasih')
  })

  it('no pickup point -> pickup time is not asked', () => {
    expect(findDataGaps(booking({ pickup: {} }))).toEqual([])
  })
})
