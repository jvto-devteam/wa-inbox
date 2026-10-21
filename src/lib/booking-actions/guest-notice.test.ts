/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import type { BookingData } from '@/lib/booking/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/send', () => ({ sendMessage: vi.fn() }))
vi.mock('@/lib/booking/client', () => ({ lookupBookingResult: vi.fn(), ensureFreshBookingData: vi.fn() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))
vi.mock('./store', () => ({ reevaluateBookingActions: vi.fn().mockResolvedValue({ resolved: 0, opened: 0 }) }))
vi.mock('@/lib/push/send', async (orig) => ({ ...(await orig<typeof import('@/lib/push/send')>()), notifyBookingAction: vi.fn() }))
vi.mock('./history', () => ({ recordEvent: vi.fn().mockResolvedValue(undefined) }))

import { prisma } from '@/lib/db'
import { sendMessage } from '@/lib/send'
import { notifyBookingAction } from '@/lib/push/send'
import { recordEvent } from './history'
import { buildGuestNoticeText, guestPortalLink, notifyGuestOfUpdate } from './guest-notice'
import { bookingShortCandidate } from '@/lib/booking/short-link'

const db = prisma as unknown as DeepMockProxy<PrismaClient>
const NOW = new Date('2026-10-20T03:00:00Z')
const FRESH_INBOUND = new Date('2026-10-20T01:00:00Z')
const OLD_INBOUND = new Date('2026-10-18T01:00:00Z')
const PORTAL = 'https://javavolcano-touroperator.com/my-booking/tok123'

const booking = (over: Record<string, unknown> = {}): BookingData => ({
  booking_id: 77,
  id: 'JVTO-3899',
  total_pax: 3,
  customer_portal: PORTAL,
  pickup: { meeting_point: 'Surabaya Airport', meeting_point_value: 'GA 300', pickup_time: '10:30' },
  guestDetails: { country: 'Germany' },
  ...over,
})

type Input = Parameters<typeof notifyGuestOfUpdate>[0]
const tshirtItem = { actionId: 'a1', sourceMessageId: 'm0', written: [{ field: 'tshirt_sizes' as const, value: 'XL x 1, L x 2' }] }
const input = (over: Partial<Input> = {}): Input => ({
  conversationId: 'c1', bookingId: '77', accountId: null, booking: booking(), items: [tshirtItem], now: NOW, ...over,
})

function setup(opts: { direction?: string; isTest?: boolean; phone?: string; platform?: string; inbound?: Date | null; sentBefore?: boolean; content?: string } = {}) {
  db.message.findMany.mockImplementation((async (a: { where: { id: { in: string[] } } }) =>
    a.where.id.in.map((id) => ({ id, direction: opts.direction ?? 'INBOUND', content: opts.content ?? null }))) as never)
  db.conversation.findUnique.mockResolvedValue({
    isTest: opts.isTest ?? false, contact: { phone: opts.phone ?? '4915112345678' }, channelIdentity: { platform: opts.platform ?? 'WHATSAPP' },
  } as never)
  db.bookingActionEvent.findFirst.mockResolvedValue((opts.sentBefore ? { id: 'e9' } : null) as never)
  db.message.findFirst.mockResolvedValue((opts.inbound === null ? null : { createdAt: opts.inbound ?? FRESH_INBOUND }) as never)
  vi.mocked(sendMessage).mockResolvedValue({ id: 'm1', deliveryStatus: 'SENT' } as never)
}

beforeEach(() => {
  mockReset(db)
  vi.mocked(sendMessage).mockReset()
  vi.mocked(notifyBookingAction).mockReset()
  vi.mocked(recordEvent).mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  process.env.BOOKING_ACTIONS_ROLLOUT = 'all'
})
afterEach(() => {
  delete process.env.BOOKING_ACTIONS_ROLLOUT
  delete process.env.BOOKING_ACTIONS_TEST_PHONES
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('buildGuestNoticeText', () => {
  it('owner example: tshirt -> "Noted" + canonical sizes + portal link (English default)', () => {
    expect(buildGuestNoticeText([{ field: 'tshirt_sizes', value: 'XL x 1, L x 2' }], booking())).toBe(
      ['Noted, thank you! Your booking has been updated:', '- T-shirt: L x 2, XL x 1', '', `You can check the full details here: ${PORTAL}`].join('\n')
    )
  })

  it('Indonesian guest -> Indonesian text; point + detail on one line, time on its own', () => {
    const text = buildGuestNoticeText(
      [{ field: 'pickup_point', value: 'Surabaya Hotel' }, { field: 'pickup_detail', value: 'Hotel Majapahit' }, { field: 'pickup_time', value: '09:30' }],
      booking({ guestDetails: { country: 'Indonesia' } })
    )
    expect(text).toBe(
      ['Noted, terima kasih! Booking Anda sudah kami perbarui:', '- Titik jemput: Surabaya Hotel · Hotel Majapahit', '- Jam jemput: 09:30', '', `Detail lengkap bisa dicek di: ${PORTAL}`].join('\n')
    )
  })

  it('detail only -> current point from the booking; new point without detail does not carry the old detail', () => {
    expect(buildGuestNoticeText([{ field: 'pickup_detail', value: 'GA 410' }], booking())).toContain('- Pickup point: Surabaya Airport · GA 410')
    expect(buildGuestNoticeText([{ field: 'drop_point', value: 'Surabaya Hotel' }], booking({ dropoff: { drop_point: 'Others', drop_point_value: 'Mall' } })))
      .toContain('- Drop-off point: Surabaya Hotel\n')
  })

  it('no link available -> no link line', () => {
    const text = buildGuestNoticeText([{ field: 'pickup_time', value: '09:30' }], booking({ customer_portal: undefined }))
    expect(text).toBe(['Noted, thank you! Your booking has been updated:', '- Pickup time: 09:30'].join('\n'))
  })

  it('nothing nameable (e.g. empty list) -> null', () => {
    expect(buildGuestNoticeText([], booking())).toBeNull()
  })
})

describe('guestPortalLink', () => {
  it('prefers a short link (bare code or full URL), then client_portal_url, then customer_portal with a valid token', () => {
    expect(guestPortalLink(booking({ url_short: 'Ab3x9' }))).toBe('https://jvto.me/b/Ab3x9')
    expect(guestPortalLink(booking({ short_url: 'https://jvto.me/b/Zz1' }))).toBe('https://jvto.me/b/Zz1')
    expect(guestPortalLink(booking({ client_portal_url: 'https://javavolcano-touroperator.com/my-booking/xyz' }))).toBe('https://javavolcano-touroperator.com/my-booking/xyz')
    expect(guestPortalLink(booking())).toBe(PORTAL)
  })

  it('TWT (client_portal_url null) or a portal without token -> null', () => {
    expect(guestPortalLink(booking({ client_portal_url: null }))).toBeNull()
    expect(guestPortalLink(booking({ customer_portal: 'https://javavolcano-touroperator.com/my-booking/' }))).toBeNull()
  })
})

describe('notifyGuestOfUpdate', () => {
  it('sends exactly one guest message (BOT when automatic) with the lines and link, then GUEST_NOTICE_SENT', async () => {
    setup()
    await notifyGuestOfUpdate(input())
    expect(sendMessage).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(sendMessage).mock.calls[0][0]
    expect(arg).toMatchObject({ conversationId: 'c1', sentBy: 'BOT', purpose: 'SYSTEM', botTrace: { source: 'booking_update_notice', idempotencyKey: 'guest_update:a1' } })
    expect(arg.text).toContain('- T-shirt: L x 2, XL x 1')
    expect(arg.text).toContain(PORTAL)
    expect(recordEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event: 'GUEST_NOTICE_SENT', actionId: 'a1', actor: 'SYSTEM', newValue: { messageId: 'm1', batch: ['a1'] } }))
    expect(notifyBookingAction).not.toHaveBeenCalled()
  })

  it('English chat from a guest whose booking says Indonesia -> English notice (owner 2026-10-21)', async () => {
    setup({ content: 'Hello, just want to confirm if my pickup location is hotel 88 surabaya at 10:00 am' })
    await notifyGuestOfUpdate(input({ booking: booking({ guestDetails: { country: 'Indonesia' } }) }))
    expect(vi.mocked(sendMessage).mock.calls[0][0].text).toMatch(/^Noted, thank you! Your booking has been updated:/)
  })

  it('long my-booking link -> verified jvto.me short link (owner 2026-10-21)', async () => {
    setup()
    vi.stubEnv('LEGACY_BASE_URL', 'https://legacy.example.test')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ url: 'tok123' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await notifyGuestOfUpdate(input())
    const text = vi.mocked(sendMessage).mock.calls[0][0].text
    expect(text).toContain(`https://jvto.me/b/${bookingShortCandidate('tok123', 0)}`)
    expect(text).not.toContain(PORTAL)
    expect(fetchMock).toHaveBeenCalledWith(`https://legacy.example.test/bookings/short/${bookingShortCandidate('tok123', 0)}`, expect.anything())
  })

  it('short code not verified (404) -> long portal link stays', async () => {
    setup()
    vi.stubEnv('LEGACY_BASE_URL', 'https://legacy.example.test')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    await notifyGuestOfUpdate(input())
    expect(vi.mocked(sendMessage).mock.calls[0][0].text).toContain(PORTAL)
  })

  it('TWT booking (client_portal_url null) -> no link and no short-link lookup', async () => {
    setup()
    vi.stubEnv('LEGACY_BASE_URL', 'https://legacy.example.test')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await notifyGuestOfUpdate(input({ booking: booking({ client_portal_url: null }) }))
    expect(vi.mocked(sendMessage).mock.calls[0][0].text).not.toContain('https://')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('manual Setujui -> sent as the agent who clicked', async () => {
    setup()
    await notifyGuestOfUpdate(input({ accountId: 'acc1' }))
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ sentBy: 'AGENT', agentId: 'acc1' }))
    expect(recordEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event: 'GUEST_NOTICE_SENT', actor: 'ACCOUNT', accountId: 'acc1' }))
  })

  it('24-hour window closed -> no free text, GUEST_NOTICE_SKIPPED (WINDOW_CLOSED) + admin push', async () => {
    setup({ inbound: OLD_INBOUND })
    await notifyGuestOfUpdate(input())
    expect(sendMessage).not.toHaveBeenCalled()
    expect(recordEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event: 'GUEST_NOTICE_SKIPPED', reason: 'WINDOW_CLOSED' }))
    expect(notifyBookingAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'GUEST_NOTICE_FAILED', conversationId: 'c1', bookingCode: 'JVTO-3899', actionId: 'a1', tagSuffix: 'guest' }))
  })

  it('rollout test + ordinary guest -> nothing; the whitelisted test phone still gets it', async () => {
    delete process.env.BOOKING_ACTIONS_ROLLOUT
    setup()
    await notifyGuestOfUpdate(input())
    expect(sendMessage).not.toHaveBeenCalled()
    expect(recordEvent).not.toHaveBeenCalled()
    expect(notifyBookingAction).not.toHaveBeenCalled()

    process.env.BOOKING_ACTIONS_TEST_PHONES = '6282143403501'
    setup({ phone: '6282143403501' })
    await notifyGuestOfUpdate(input())
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('idempotent: a GUEST_NOTICE_SENT for this action already exists -> nothing sent again', async () => {
    setup({ sentBefore: true })
    await notifyGuestOfUpdate(input())
    expect(sendMessage).not.toHaveBeenCalled()
    expect(db.bookingActionEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { actionId: { in: ['a1'] }, event: 'GUEST_NOTICE_SENT', createdAt: { gte: new Date(NOW.getTime() - 24 * 60 * 60 * 1000) } },
    }))
  })

  it('only changes that came from a guest (INBOUND) message', async () => {
    setup({ direction: 'OUTBOUND' })
    await notifyGuestOfUpdate(input())
    await notifyGuestOfUpdate(input({ items: [{ ...tshirtItem, sourceMessageId: null }] }))
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('send failure (FAILED or throw) -> GUEST_NOTICE_FAILED + admin push, never throws', async () => {
    setup()
    vi.mocked(sendMessage).mockResolvedValueOnce({ id: 'm1', deliveryStatus: 'FAILED' } as never)
    await expect(notifyGuestOfUpdate(input())).resolves.toBeUndefined()
    vi.mocked(sendMessage).mockRejectedValueOnce(new Error('meta down'))
    await expect(notifyGuestOfUpdate(input())).resolves.toBeUndefined()
    expect(recordEvent).toHaveBeenCalledTimes(2)
    expect(recordEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event: 'GUEST_NOTICE_FAILED', reason: 'SEND_FAILED' }))
    expect(notifyBookingAction).toHaveBeenCalledTimes(2)
    // Log tanpa teks pesan.
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('T-shirt')
  })

  it('not WhatsApp -> nothing', async () => {
    setup({ platform: 'EMAIL' })
    await notifyGuestOfUpdate(input())
    expect(sendMessage).not.toHaveBeenCalled()
  })
})

describe('review 2026-10-20 Important 2: one combined notice', () => {
  it('several cards from one guest message -> ONE WhatsApp listing every field, GUEST_NOTICE_SENT on every card', async () => {
    setup()
    await notifyGuestOfUpdate(input({
      items: [
        { actionId: 'a1', sourceMessageId: 'm0', written: [{ field: 'pickup_point', value: 'Surabaya Hotel' }] },
        { actionId: 'a2', sourceMessageId: 'm0', written: [{ field: 'pickup_detail', value: 'Hotel Majapahit' }] },
        { actionId: 'a3', sourceMessageId: 'm0', written: [{ field: 'pickup_time', value: '09:30' }] },
        { ...tshirtItem, actionId: 'a4' },
      ],
    }))
    expect(sendMessage).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(sendMessage).mock.calls[0][0]
    expect(arg.botTrace).toEqual({ source: 'booking_update_notice', idempotencyKey: 'guest_update:a1' })
    expect(arg.text).toContain('- Pickup point: Surabaya Hotel · Hotel Majapahit\n- Pickup time: 09:30\n- T-shirt: L x 2, XL x 1')
    const sentFor = vi.mocked(recordEvent).mock.calls.filter((c) => c[1].event === 'GUEST_NOTICE_SENT').map((c) => c[1].actionId)
    expect(sentFor).toEqual(['a1', 'a2', 'a3', 'a4'])
  })

  it('a card whose source is not an INBOUND message is dropped from the combined notice', async () => {
    setup()
    db.message.findMany.mockResolvedValue([{ id: 'm0', direction: 'INBOUND' }, { id: 'm9', direction: 'OUTBOUND' }] as never)
    await notifyGuestOfUpdate(input({
      items: [{ ...tshirtItem, sourceMessageId: 'm9', actionId: 'a0' }, { actionId: 'a1', sourceMessageId: 'm0', written: [{ field: 'pickup_time', value: '09:30' }] }],
    }))
    const text = vi.mocked(sendMessage).mock.calls[0][0].text
    expect(text).toContain('Pickup time: 09:30')
    expect(text).not.toContain('T-shirt')
    expect(vi.mocked(sendMessage).mock.calls[0][0].botTrace).toMatchObject({ idempotencyKey: 'guest_update:a1' })
  })
})
