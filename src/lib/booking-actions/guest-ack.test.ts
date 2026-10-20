/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import type { BookingData } from '@/lib/booking/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/send', () => ({ sendMessage: vi.fn() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))
vi.mock('./history', () => ({ recordEvent: vi.fn().mockResolvedValue(undefined) }))

import { prisma } from '@/lib/db'
import { sendMessage } from '@/lib/send'
import { recordEvent } from './history'
import { GUEST_ACK_TEXT, notifyGuestRequestReceived } from './guest-ack'

const db = prisma as unknown as DeepMockProxy<PrismaClient>
const NOW = new Date('2026-10-20T03:00:00Z')
const booking = (country = 'Germany'): BookingData => ({ booking_id: 77, id: 'JVTO-1', guestDetails: { country } }) as BookingData

function setup(opts: {
  cardIds?: string[]
  cards?: { id: string; sourceMessageId: string | null }[]
  direction?: string
  platform?: string
  isTest?: boolean
  phone?: string
  inbound?: Date | null
  acked?: boolean
  recent?: boolean
} = {}) {
  db.bookingAction.findMany.mockResolvedValue((opts.cards ?? [{ id: 'a1', sourceMessageId: 'm1' }, { id: 'a2', sourceMessageId: 'm1' }]) as never)
  db.message.findMany.mockImplementation((async (a: { where: { id: { in: string[] } } }) =>
    a.where.id.in.map((id) => ({ id, direction: opts.direction ?? 'INBOUND' }))) as never)
  db.conversation.findUnique.mockResolvedValue({
    isTest: opts.isTest ?? false, contact: { phone: opts.phone ?? '4915112345678' }, channelIdentity: { platform: opts.platform ?? 'WHATSAPP' },
  } as never)
  db.$transaction.mockImplementation((async (fn: (tx: unknown) => unknown) => fn(db)) as never)
  db.bookingActionEvent.findFirst.mockImplementation((async (a: { where: { actionId?: unknown } }) =>
    (a.where.actionId ? (opts.acked ? { id: 'e1' } : null) : opts.recent ? { id: 'e2' } : null)) as never)
  db.message.findFirst.mockResolvedValue((opts.inbound === null ? null : { createdAt: opts.inbound ?? new Date('2026-10-20T02:59:00Z') }) as never)
  vi.mocked(sendMessage).mockResolvedValue({ id: 'out1', deliveryStatus: 'SENT' } as never)
}
const run = (b: BookingData = booking()) =>
  notifyGuestRequestReceived({ conversationId: 'c1', bookingId: '77', booking: b, cardIds: ['a1', 'a2'], now: NOW })

beforeEach(() => {
  mockReset(db)
  vi.mocked(sendMessage).mockReset()
  vi.mocked(recordEvent).mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  process.env.BOOKING_ACTIONS_ROLLOUT = 'all'
})
afterEach(() => {
  delete process.env.BOOKING_ACTIONS_ROLLOUT
  vi.restoreAllMocks()
})

describe('notifyGuestRequestReceived', () => {
  it('CHANGE + TASK from one message -> exactly ONE ack, English by default, marked automated, event on every card', async () => {
    setup()
    await run()
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'c1', text: GUEST_ACK_TEXT.en, sentBy: 'BOT',
      botTrace: expect.objectContaining({ source: 'booking_request_ack', idempotencyKey: 'guest_ack:a1' }),
    }))
    expect(GUEST_ACK_TEXT.en).toBe("Noted, we've received your request and are processing it now.")
    expect(vi.mocked(recordEvent).mock.calls.map((c) => [c[1].actionId, c[1].event])).toEqual([['a1', 'GUEST_ACK_SENT'], ['a2', 'GUEST_ACK_SENT']])
  })

  it('claims (writes GUEST_ACK_SENT) BEFORE sending, so an overlapping run sees it', async () => {
    setup()
    const order: string[] = []
    vi.mocked(recordEvent).mockImplementation(async () => {
      order.push('claim')
    })
    vi.mocked(sendMessage).mockImplementation((async () => {
      order.push('send')
      return { id: 'out1', deliveryStatus: 'SENT' }
    }) as never)
    await run()
    expect(order).toEqual(['claim', 'claim', 'send'])
  })

  it('overlapping runs -> exactly one ack (second run sees the claim)', async () => {
    setup()
    let claimed = false
    vi.mocked(recordEvent).mockImplementation(async () => {
      claimed = true
    })
    db.bookingActionEvent.findFirst.mockImplementation((async (a: { where: { actionId?: unknown } }) => (a.where.actionId && claimed ? { id: 'e1' } : null)) as never)
    await run()
    await run()
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('a reevaluate-born fill card (not in cardIds) never triggers an ack', async () => {
    setup()
    db.bookingAction.findMany.mockResolvedValue([] as never)
    await notifyGuestRequestReceived({ conversationId: 'c1', bookingId: '77', booking: booking(), cardIds: [], now: NOW })
    expect(sendMessage).not.toHaveBeenCalled()
    expect(db.bookingAction.findMany).not.toHaveBeenCalled()
  })

  it('send failure keeps the claim (no re-send on retry)', async () => {
    setup()
    vi.mocked(sendMessage).mockRejectedValue(new Error('x'))
    await run()
    expect(vi.mocked(recordEvent).mock.calls).toHaveLength(2)
  })

  it('Indonesian guest -> Indonesian text', async () => {
    setup()
    await run(booking('Indonesia'))
    expect(vi.mocked(sendMessage).mock.calls[0][0].text).toBe('Noted, permintaan Anda sudah kami terima dan sedang kami proses.')
  })

  it('no CHANGE/TASK born (MISMATCH-only extraction) -> nothing sent; query only asks for CHANGE/TASK', async () => {
    setup({ cards: [] })
    await run()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(db.bookingAction.findMany.mock.calls[0][0]?.where).toMatchObject({ type: { in: ['CHANGE', 'TASK'] } })
  })

  it('card whose source is not an INBOUND guest message -> nothing sent', async () => {
    setup({ direction: 'OUTBOUND' })
    await run()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('rollout "test" blocks a real guest (no send, no event)', async () => {
    delete process.env.BOOKING_ACTIONS_ROLLOUT
    setup()
    await run()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(recordEvent).not.toHaveBeenCalled()
  })

  it('isTest sandbox passes the rollout gate', async () => {
    delete process.env.BOOKING_ACTIONS_ROLLOUT
    setup({ isTest: true })
    await run()
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('non-WhatsApp channel -> nothing sent', async () => {
    setup({ platform: 'MESSENGER' })
    await run()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('24h window closed -> silent skip: no send, no event', async () => {
    setup({ inbound: new Date('2026-10-18T01:00:00Z') })
    await run()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(recordEvent).not.toHaveBeenCalled()
  })

  it('re-extraction over the same cards (GUEST_ACK_SENT exists) -> not re-sent', async () => {
    setup({ acked: true })
    await run()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('another ack in the same conversation within 2 minutes -> not sent', async () => {
    setup({ recent: true })
    await run()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('send failure -> logs the error name only, never throws', async () => {
    setup()
    vi.mocked(sendMessage).mockRejectedValue(new TypeError('boom secret text'))
    await expect(run()).resolves.toBeUndefined()
    expect(console.error).toHaveBeenCalledWith(expect.any(String), { conversationId: 'c1', error: 'TypeError' })
  })

  it('DB failure never throws', async () => {
    setup()
    db.bookingAction.findMany.mockRejectedValue(new Error('db down'))
    await expect(run()).resolves.toBeUndefined()
    expect(sendMessage).not.toHaveBeenCalled()
  })
})
