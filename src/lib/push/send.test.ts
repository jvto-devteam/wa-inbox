/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('web-push', () => ({ default: { sendNotification: vi.fn() } }))

import webpush from 'web-push'
import { prisma } from '@/lib/db'
import { __resetPushMarksForTests, buildPushPayload, notifyBookingAction, pushMarkFailedRecently, summarizeAction } from './send'

const db = prisma as unknown as DeepMockProxy<PrismaClient>
const send = vi.mocked(webpush.sendNotification)
const event = {
  kind: 'CHANGE' as const,
  conversationId: 'conv1',
  bookingCode: 'JVTO-3899',
  summary: 'Titik jemput → Surabaya Hotel',
  actionId: 'act1',
}
const sub = (n: number) => ({ id: `s${n}`, accountId: `acc${n}`, endpoint: `https://push.example/${n}`, p256dh: `p${n}`, auth: `a${n}`, createdAt: new Date(), lastSuccessAt: null })

beforeEach(() => {
  mockReset(db)
  send.mockReset()
  send.mockResolvedValue({ statusCode: 201, body: '', headers: {} })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  process.env.VAPID_PUBLIC_KEY = 'pub'
  process.env.VAPID_PRIVATE_KEY = 'priv'
  process.env.VAPID_SUBJECT = 'mailto:ops@example.com'
  db.pushSubscription.findMany.mockResolvedValue([sub(1), sub(2)] as never)
})

describe('notifyBookingAction', () => {
  it('sends to every subscription of every account', async () => {
    await notifyBookingAction(event)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls.map((c) => (c[0] as { endpoint: string }).endpoint)).toEqual(['https://push.example/1', 'https://push.example/2'])
    expect(db.pushSubscription.findMany).toHaveBeenCalledWith()
  })

  it('410 from push service deletes subscription', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))
    await notifyBookingAction(event)
    expect(db.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { endpoint: 'https://push.example/1' } })
    expect(db.pushSubscription.deleteMany).toHaveBeenCalledTimes(1)
  })

  it('404 also deletes; 500 keeps the subscription', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error('nf'), { statusCode: 404 }))
    send.mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }))
    await notifyBookingAction(event)
    expect(db.pushSubscription.deleteMany).toHaveBeenCalledTimes(1)
    expect(db.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { endpoint: 'https://push.example/1' } })
  })

  it('push failure never throws into caller', async () => {
    send.mockRejectedValue(new Error('network down'))
    await expect(notifyBookingAction(event)).resolves.toBeUndefined()
    db.pushSubscription.findMany.mockRejectedValue(new Error('db down'))
    await expect(notifyBookingAction(event)).resolves.toBeUndefined()
  })

  it('is a silent no-op without VAPID env', async () => {
    delete process.env.VAPID_PRIVATE_KEY
    await notifyBookingAction(event)
    expect(send).not.toHaveBeenCalled()
    expect(db.pushSubscription.findMany).not.toHaveBeenCalled()
  })

  it('passes VAPID details and the JSON payload to web-push, never logging the private key', async () => {
    send.mockRejectedValue(new Error('x priv'))
    await notifyBookingAction(event)
    const opts = send.mock.calls[0][2] as { vapidDetails: { privateKey: string } }
    expect((send.mock.calls[0][2] as { timeout: number }).timeout).toBe(10_000)
    expect(opts.vapidDetails.privateKey).toBe('priv')
    const logged = JSON.stringify([...vi.mocked(console.error).mock.calls, ...vi.mocked(console.warn).mock.calls])
    expect(logged).not.toContain('"priv"')
    expect(JSON.parse(send.mock.calls[0][1] as string)).toMatchObject({ tag: 'booking-action:act1' })
  })
})

describe('summarizeAction', () => {
  it('free-text fields show label only, never guest text', () => {
    for (const f of ['note', 'pickup_detail', 'drop_detail']) {
      const body = buildPushPayload({ ...event, summary: summarizeAction(f, 'Atas nama Budi Santoso, tolong jemput di lobi') }).body
      expect(body).not.toMatch(/Budi|Santoso|lobi/)
      expect(body).toContain('buka chat')
    }
    expect(summarizeAction('note', 'x')).toBe('Catatan baru — buka chat')
    expect(summarizeAction('pickup_detail', 'x')).toBe('Detail jemput diperbarui — buka chat')
  })

  it('structured fields keep the value', () => {
    expect(summarizeAction('pickup_point', 'Surabaya Hotel')).toBe('Titik jemput → Surabaya Hotel')
    expect(summarizeAction('total_pax', '5')).toBe('Jumlah tamu → 5')
  })
})

describe('buildPushPayload', () => {
  it('AUTO_APPLIED keeps the CHANGE tag (replaces the earlier notification) and says it can be cancelled', () => {
    const changeTag = buildPushPayload({ ...event, kind: 'CHANGE' }).tag
    const p = buildPushPayload({ ...event, kind: 'AUTO_APPLIED', summary: 'Jam jemput → 09:00' })
    expect(p.tag).toBe(changeTag)
    expect(p.body).toContain('Diterapkan otomatis · Jam jemput → 09:00 — ketuk untuk melihat/batalkan')
  })

  it('payload has no phone/email', () => {
    const p = buildPushPayload({ ...event, summary: 'Catatan → hubungi 081234567890 atau tamu@mail.com +62 812-3456-7890' })
    expect(p.body).not.toMatch(/\d{8,}/)
    expect(p.body).not.toContain('@')
    expect(p.body).not.toMatch(/\d[\d\s-]{7,}\d/)
    expect(p.title).not.toMatch(/\d{8,}|@/)
  })

  it('notification url opens conversation with action', () => {
    expect(buildPushPayload(event).url).toBe('/inbox?conversation=conv1')
    expect(buildPushPayload({ ...event, messageId: 'm9' }).url).toBe('/inbox?conversation=conv1&message=m9')
    expect(buildPushPayload(event).tag).toBe('booking-action:act1')
  })

  it('includes booking code, and tolerates a missing one', () => {
    expect(buildPushPayload(event).body).toContain('JVTO-3899')
    expect(buildPushPayload({ ...event, bookingCode: null }).body).toContain(event.summary)
  })

  it('titles differ per kind', () => {
    const titles = (['CHANGE', 'MISMATCH', 'TASK', 'AUTO_APPLIED', 'EXECUTE_FAILED'] as const).map((kind) => buildPushPayload({ ...event, kind }).title)
    expect(new Set(titles).size).toBe(5)
  })
})

describe('review 2026-10-20 Important 3: manual-notice alarms keep their own tag', () => {
  it('guest/vendor failure tags differ from the card tag, so a later AUTO_APPLIED cannot replace them', () => {
    const card = buildPushPayload({ ...event, kind: 'AUTO_APPLIED' }).tag
    expect(card).toBe('booking-action:act1')
    expect(buildPushPayload({ ...event, kind: 'GUEST_NOTICE_FAILED', tagSuffix: 'guest' }).tag).toBe('booking-action:act1:guest')
    expect(buildPushPayload({ ...event, kind: 'GUEST_NOTICE_FAILED', tagSuffix: 'guest-revert' }).tag).toBe('booking-action:act1:guest-revert')
    expect(buildPushPayload({ ...event, kind: 'EXECUTE_FAILED', tagSuffix: 'vendor-tshirt' }).tag).toBe('booking-action:act1:vendor-tshirt')
    expect(buildPushPayload({ ...event, kind: 'EXECUTE_FAILED', tagSuffix: 'vendor-bali' }).tag).toBe('booking-action:act1:vendor-bali')
  })

  it('every push records a PUSHED marker on the card (also without VAPID), for the lost-push sweep', async () => {
    delete process.env.VAPID_PUBLIC_KEY
    await notifyBookingAction(event)
    expect(db.bookingActionEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actionId: 'act1', event: 'PUSHED', reason: 'CHANGE', actor: 'SYSTEM' }) })
  })
})

describe('review round 2: alarm titles and marker failures', () => {
  it('revert alarm and vendor failures carry their own title', () => {
    expect(buildPushPayload({ ...event, kind: 'GUEST_NOTICE_FAILED', tagSuffix: 'guest-revert' }).title).toBe('Perubahan dibatalkan — kabari tamu manual')
    expect(buildPushPayload({ ...event, kind: 'EXECUTE_FAILED', tagSuffix: 'vendor-tshirt' }).title).toBe('Kabar ke vendor gagal')
    expect(buildPushPayload({ ...event, kind: 'EXECUTE_FAILED', tagSuffix: 'vendor-bali' }).title).toBe('Kabar ke vendor gagal')
    expect(buildPushPayload({ ...event, kind: 'EXECUTE_FAILED' }).title).toBe('Perubahan booking gagal diterapkan')
    expect(buildPushPayload({ ...event, kind: 'GUEST_NOTICE_FAILED', tagSuffix: 'guest' }).title).toBe('Tamu belum dikabari perubahan booking')
  })

  it('a PUSHED marker that fails to write is remembered (the sweep skips the card), the push still goes out', async () => {
    __resetPushMarksForTests()
    db.bookingActionEvent.create.mockRejectedValueOnce(new Error('db'))
    db.pushSubscription.findMany.mockResolvedValue([sub(1)] as never)
    expect(pushMarkFailedRecently('act1')).toBe(false)
    await notifyBookingAction(event)
    expect(pushMarkFailedRecently('act1')).toBe(true)
    expect(pushMarkFailedRecently('act1', Date.now() + 2 * 60 * 60 * 1000)).toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
