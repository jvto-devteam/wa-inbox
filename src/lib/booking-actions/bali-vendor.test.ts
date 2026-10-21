/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookingData } from '@/lib/booking/client'

vi.mock('@/lib/db', () => ({ prisma: { conversation: { findUnique: vi.fn() } } }))
vi.mock('@/lib/system-templates/send', () => ({ enqueueSystemTemplateSend: vi.fn() }))
vi.mock('@/lib/push/send', () => ({ notifyBookingAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/booking-actions/history', () => ({ recordEvent: vi.fn().mockResolvedValue(undefined) }))

import { enqueueSystemTemplateSend } from '@/lib/system-templates/send'
import { prisma } from '@/lib/db'
import { notifyBookingAction } from '@/lib/push/send'
import { recordEvent } from '@/lib/booking-actions/history'
import { BALI_UPDATE_TEMPLATE_KEY, buildVendorVariables, notifyBaliVendor } from './bali-vendor'

const booking: BookingData = {
  id: 'JVTO-3899',
  booking_id: 77,
  total_pax: 3,
  date: { start: '12 October 2026', end: '14 October 2026', start_ymd: '2026-10-12', end_ymd: '2026-10-14' },
  pickup: { meeting_point: 'Bali Hotel', meeting_point_value: 'Kuta Beach Hotel', pickup_time: '09:30' },
  dropoff: { drop_point: 'Surabaya Hotel', drop_point_value: 'Hotel Majapahit', drop_time: '17:00' },
}
const input = { actionId: 'a1', conversationId: 'c1', bookingId: '77', booking }

beforeEach(() => {
  vi.mocked(enqueueSystemTemplateSend).mockReset()
  vi.mocked(notifyBookingAction).mockClear()
  vi.mocked(recordEvent).mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  // Bawaan: percakapan tamu biasa (bukan uji); rollout bawaan `test`.
  vi.mocked(prisma.conversation.findUnique).mockReset().mockResolvedValue({ isTest: false, contact: { phone: '4915112345678' } } as never)
})

describe('buildVendorVariables', () => {
  it('carries code, dates, pax, and the current points with times; no guest name', () => {
    const v = buildVendorVariables(booking)
    expect(v).toEqual({
      booking_code: 'JVTO-3899',
      travel_dates: '12 October 2026 - 14 October 2026',
      total_pax: '3',
      pickup: 'Bali Hotel - Kuta Beach Hotel (09:30)',
      drop: 'Surabaya Hotel - Hotel Majapahit (17:00)',
    })
  })

  it('falls back to "-" for missing parts', () => {
    expect(buildVendorVariables({ id: 'X-1' })).toMatchObject({ pickup: '-', drop: '-', travel_dates: '-', total_pax: '-' })
  })
})

describe('notifyBaliVendor', () => {
  it('BALI change executed -> exactly one vendor notice via the update template', async () => {
    vi.mocked(enqueueSystemTemplateSend).mockResolvedValue({ ok: true, jobId: 'j1', status: 'QUEUED', duplicate: false })
    await notifyBaliVendor(input)
    expect(enqueueSystemTemplateSend).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(enqueueSystemTemplateSend).mock.calls[0][0]
    expect(arg.templateKey).toBe(BALI_UPDATE_TEMPLATE_KEY)
    expect(arg.idempotencyKey).toBe('bali_update:a1')
    expect(arg.to).toEqual({ phone: expect.stringMatching(/^\d+$/) })
    expect(notifyBookingAction).not.toHaveBeenCalled()
    expect(recordEvent).not.toHaveBeenCalled()
  })

  it('an explicit idempotencyKey (revert) replaces the default bali_update key', async () => {
    await notifyBaliVendor({ ...input, idempotencyKey: 'bali_revert:a1' })
    expect(vi.mocked(enqueueSystemTemplateSend).mock.calls.at(-1)?.[0].idempotencyKey).toBe('bali_revert:a1')
  })

  it('send failure -> VENDOR_NOTICE_FAILED event + admin push, never throws, no phone in logs/push', async () => {
    vi.mocked(enqueueSystemTemplateSend).mockResolvedValue({ ok: false, code: 'TEMPLATE_NOT_FOUND' })
    await expect(notifyBaliVendor(input)).resolves.toBeUndefined()
    const phone = (vi.mocked(enqueueSystemTemplateSend).mock.calls[0][0].to as { phone: string }).phone
    expect(recordEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event: 'VENDOR_NOTICE_FAILED', actionId: 'a1', conversationId: 'c1', actor: 'SYSTEM' }))
    expect(notifyBookingAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'EXECUTE_FAILED', conversationId: 'c1', bookingCode: 'JVTO-3899', summary: 'Kabar ke vendor Bali gagal — kabari manual' })
    )
    const logged = JSON.stringify([...vi.mocked(console.error).mock.calls, ...vi.mocked(notifyBookingAction).mock.calls, ...vi.mocked(recordEvent).mock.calls])
    expect(logged).not.toContain(phone)
  })

  it('a thrown send is also a failure, and a CANCELLED (blocked) job counts as not sent', async () => {
    vi.mocked(enqueueSystemTemplateSend).mockRejectedValueOnce(new Error('db down'))
    await expect(notifyBaliVendor(input)).resolves.toBeUndefined()
    expect(notifyBookingAction).toHaveBeenCalledTimes(1)

    vi.mocked(enqueueSystemTemplateSend).mockResolvedValueOnce({ ok: true, jobId: 'j', status: 'CANCELLED', duplicate: false })
    await notifyBaliVendor(input)
    expect(notifyBookingAction).toHaveBeenCalledTimes(2)
  })

  it('a failing push or event write never throws', async () => {
    vi.mocked(enqueueSystemTemplateSend).mockResolvedValue({ ok: false, code: 'ENQUEUE_FAILED' })
    vi.mocked(recordEvent).mockRejectedValueOnce(new Error('x'))
    vi.mocked(notifyBookingAction).mockRejectedValueOnce(new Error('y'))
    await expect(notifyBaliVendor(input)).resolves.toBeUndefined()
  })
})

describe('final review Important 6: no pre-change data and no fake time to the vendor', () => {
  it('refreshed booking that does NOT carry the written value -> nothing sent, VENDOR_NOTICE_FAILED + push', async () => {
    vi.mocked(enqueueSystemTemplateSend).mockResolvedValue({ ok: true, jobId: 'j1', status: 'QUEUED', duplicate: false })
    // Penyegaran pasca-tulis gagal: yang diterima masih booking lama (09:30), padahal 11:00 yang ditulis.
    await notifyBaliVendor({ ...input, expected: [{ field: 'pickup_time', value: '11:00' }] })
    expect(enqueueSystemTemplateSend).not.toHaveBeenCalled()
    expect(recordEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      event: 'VENDOR_NOTICE_FAILED', reason: expect.stringContaining('BOOKING_NOT_REFRESHED'),
    }))
    expect(notifyBookingAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'EXECUTE_FAILED', summary: 'Kabar ke vendor Bali gagal — kabari manual' }))
  })

  it('refreshed booking carrying every written value -> sent', async () => {
    vi.mocked(enqueueSystemTemplateSend).mockResolvedValue({ ok: true, jobId: 'j1', status: 'QUEUED', duplicate: false })
    await notifyBaliVendor({ ...input, expected: [{ field: 'pickup_time', value: '9.30' }, { field: 'pickup_detail', value: 'kuta beach hotel' }] })
    expect(enqueueSystemTemplateSend).toHaveBeenCalledTimes(1)
    expect(recordEvent).not.toHaveBeenCalled()
  })

  it("unknown booking time (null/''/'07:00') reads 'jam belum ada', unless 07:00 is the value just written", () => {
    for (const t of [null, '', '07:00']) {
      const b: BookingData = { ...booking, pickup: { ...booking.pickup, pickup_time: t } }
      expect(buildVendorVariables(b).pickup).toBe('Bali Hotel - Kuta Beach Hotel (jam belum ada)')
    }
    const real: BookingData = { ...booking, pickup: { ...booking.pickup, pickup_time: '07:00' } }
    expect(buildVendorVariables(real, [{ field: 'pickup_time', value: '07:00' }]).pickup).toBe('Bali Hotel - Kuta Beach Hotel (07:00)')
    // Jam 07:00 antar yang tidak ditulis tetap "jam belum ada".
    const drop: BookingData = { ...booking, dropoff: { ...booking.dropoff, drop_time: '07:00' } }
    expect(buildVendorVariables(drop, [{ field: 'pickup_time', value: '09:30' }]).drop).toBe('Surabaya Hotel - Hotel Majapahit (jam belum ada)')
  })
})

describe('review 2026-10-20 Important 4: test conversations never reach the real Bali vendor', () => {
  const queued = { ok: true as const, jobId: 'j1', status: 'QUEUED' as const, duplicate: false }
  afterEach(() => {
    delete process.env.BOOKING_ACTIONS_TEST_PHONES
    delete process.env.BOOKING_ACTIONS_ROLLOUT
  })

  it("rollout 'test' + test conversation (isTest or whitelisted phone) -> sent to the FIRST test phone", async () => {
    vi.mocked(enqueueSystemTemplateSend).mockResolvedValue(queued)
    process.env.BOOKING_ACTIONS_TEST_PHONES = '6282143403501, 6281111111111'
    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({ isTest: false, contact: { phone: '6282143403501' } } as never)
    await notifyBaliVendor(input)
    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({ isTest: true, contact: { phone: '628000' } } as never)
    await notifyBaliVendor(input)
    expect(vi.mocked(enqueueSystemTemplateSend).mock.calls.map((c) => c[0].to)).toEqual([{ phone: '6282143403501' }, { phone: '6282143403501' }])
    expect(vi.mocked(enqueueSystemTemplateSend).mock.calls[0][0].idempotencyKey).toBe('bali_update:a1')
  })

  it('test conversation without any test phone -> nothing sent, event only (no admin alarm)', async () => {
    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({ isTest: true, contact: { phone: '628000' } } as never)
    await notifyBaliVendor(input)
    expect(enqueueSystemTemplateSend).not.toHaveBeenCalled()
    expect(recordEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event: 'VENDOR_NOTICE_FAILED', reason: expect.stringContaining('TEST_PHONE_MISSING') }))
    expect(notifyBookingAction).not.toHaveBeenCalled()
  })

  it("rollout 'all' -> the real vendor even for a test conversation (the lookup only checks Mode uji tanpa WA)", async () => {
    vi.mocked(enqueueSystemTemplateSend).mockResolvedValue(queued)
    process.env.BOOKING_ACTIONS_ROLLOUT = 'all'
    process.env.BOOKING_ACTIONS_TEST_PHONES = '6282143403501'
    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({ isTest: true, contact: { phone: '6282143403501' } } as never)
    await notifyBaliVendor(input)
    expect(vi.mocked(enqueueSystemTemplateSend).mock.calls[0][0].to).not.toEqual({ phone: '6282143403501' })
  })

  it("rollout 'test' and the conversation cannot be read -> not sent; failure event + push with the vendor tag", async () => {
    vi.mocked(prisma.conversation.findUnique).mockRejectedValue(new Error('db'))
    await notifyBaliVendor(input)
    expect(enqueueSystemTemplateSend).not.toHaveBeenCalled()
    expect(notifyBookingAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'EXECUTE_FAILED', tagSuffix: 'vendor-bali' }))
  })
})
