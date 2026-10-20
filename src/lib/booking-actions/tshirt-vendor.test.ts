/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookingData } from '@/lib/booking/client'

vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('@/lib/system-templates/send', () => ({ enqueueSystemTemplateSend: vi.fn() }))
vi.mock('@/lib/push/send', () => ({ notifyBookingAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/booking-actions/history', () => ({ recordEvent: vi.fn().mockResolvedValue(undefined) }))

import { enqueueSystemTemplateSend } from '@/lib/system-templates/send'
import { notifyBookingAction } from '@/lib/push/send'
import { recordEvent } from '@/lib/booking-actions/history'
import { SYSTEM_TEMPLATE_SEEDS } from '@/lib/system-templates/seed-data'
import { renderSystemTemplate } from '@/lib/system-templates/render'
import { TSHIRT_UPDATE_TEMPLATE_KEY, buildTshirtVendorVariables, notifyTshirtVendor } from './tshirt-vendor'

const booking: BookingData = {
  id: 'JVTO-3899',
  booking_id: 77,
  total_pax: 3,
  tshirtSize: 'L x 2, XL x 1',
  guest: 'Jane Guest',
  date: { start: '12 Oct 26', end: '14 Oct 26', start_ymd: '2026-10-12', end_ymd: '2026-10-14' },
}
const input = { actionId: 'a1', conversationId: 'c1', bookingId: '77', booking, sizes: 'XL x 1, L x 2' }

beforeEach(() => {
  vi.mocked(enqueueSystemTemplateSend).mockReset().mockResolvedValue({ ok: true, jobId: 'j1', status: 'QUEUED', duplicate: false })
  vi.mocked(notifyBookingAction).mockClear()
  vi.mocked(recordEvent).mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  delete process.env.TSHIRT_VENDOR_PHONE
  vi.restoreAllMocks()
})

describe('buildTshirtVendorVariables', () => {
  it('code, dates, pax and canonical sizes; never the guest name', () => {
    const v = buildTshirtVendorVariables(booking, 'XL x 1, L x 2')
    expect(v).toEqual({ booking_code: 'JVTO-3899', travel_dates: '12 Oct 26 - 14 Oct 26', total_pax: '3', sizes: 'L x 2, XL x 1' })
    expect(JSON.stringify(v)).not.toContain('Jane')
  })

  it('renders through the seeded internal_tshirt_update template', () => {
    const seed = SYSTEM_TEMPLATE_SEEDS.find((s) => s.key === TSHIRT_UPDATE_TEMPLATE_KEY)
    expect(seed?.audience).toBe('INTERNAL')
    const out = renderSystemTemplate(seed!, buildTshirtVendorVariables(booking, 'L x 2, XL x 1'))
    expect(JSON.stringify(out)).toContain('L x 2, XL x 1')
  })
})

describe('notifyTshirtVendor', () => {
  it('sizes written -> exactly one vendor notice, key tshirt_update:<id>, default number from new-backoffice', async () => {
    await notifyTshirtVendor(input)
    expect(enqueueSystemTemplateSend).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(enqueueSystemTemplateSend).mock.calls[0][0]
    expect(arg).toMatchObject({ templateKey: 'internal_tshirt_update', idempotencyKey: 'tshirt_update:a1', to: { phone: '6281337844825' } })
    expect(recordEvent).not.toHaveBeenCalled()
    expect(notifyBookingAction).not.toHaveBeenCalled()
  })

  it('TSHIRT_VENDOR_PHONE overrides the destination; revert key replaces the default', async () => {
    process.env.TSHIRT_VENDOR_PHONE = '+62 821-4340-3501'
    await notifyTshirtVendor({ ...input, idempotencyKey: 'tshirt_revert:a1' })
    expect(vi.mocked(enqueueSystemTemplateSend).mock.calls[0][0]).toMatchObject({ to: { phone: '6282143403501' }, idempotencyKey: 'tshirt_revert:a1' })
  })

  it('refreshed booking without the written sizes -> nothing sent, VENDOR_NOTICE_FAILED + push "kabari vendor kaos manual"', async () => {
    await notifyTshirtVendor({ ...input, sizes: 'M x 3' })
    expect(enqueueSystemTemplateSend).not.toHaveBeenCalled()
    expect(recordEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event: 'VENDOR_NOTICE_FAILED', reason: expect.stringContaining('BOOKING_NOT_REFRESHED') }))
    expect(notifyBookingAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'EXECUTE_FAILED', summary: expect.stringContaining('vendor kaos manual') }))
  })

  it('send failure / throw / CANCELLED -> event + push, never throws, phone never logged', async () => {
    vi.mocked(enqueueSystemTemplateSend).mockResolvedValueOnce({ ok: false, code: 'TEMPLATE_NOT_FOUND' })
    await expect(notifyTshirtVendor(input)).resolves.toBeUndefined()
    vi.mocked(enqueueSystemTemplateSend).mockRejectedValueOnce(new Error('db'))
    await expect(notifyTshirtVendor(input)).resolves.toBeUndefined()
    vi.mocked(enqueueSystemTemplateSend).mockResolvedValueOnce({ ok: true, jobId: 'j', status: 'CANCELLED', duplicate: false })
    await notifyTshirtVendor(input)
    expect(notifyBookingAction).toHaveBeenCalledTimes(3)
    const logged = JSON.stringify([...vi.mocked(console.error).mock.calls, ...vi.mocked(notifyBookingAction).mock.calls, ...vi.mocked(recordEvent).mock.calls])
    expect(logged).not.toContain('6281337844825')
  })
})
