/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CRON_SECRET_ENV, CRON_SECRET_HEADER } from '@/lib/outbound/cron-auth'
import { createLiveReplyItems, reconcileSummaryItems } from '@/lib/summary-items/sync'
import { reviewConversation } from '@/lib/daily-summary/review'
import { pruneBotAuditLogs } from '@/lib/bot-control/audit'
import { advancePipelineStagesFromBooking, refreshStaleBookingData } from '@/lib/booking/client'
import { processDueOutboundJobs } from '@/lib/outbound/worker'
import { POST } from './route'

vi.mock('@/lib/summary-items/sync', () => ({ reconcileSummaryItems: vi.fn(), createLiveReplyItems: vi.fn() }))
vi.mock('@/lib/daily-summary/review', () => ({ reviewConversation: vi.fn() }))
vi.mock('@/lib/bot-control/audit', () => ({ pruneBotAuditLogs: vi.fn() }))
vi.mock('@/lib/booking/client', () => ({ advancePipelineStagesFromBooking: vi.fn(), refreshStaleBookingData: vi.fn() }))
vi.mock('@/lib/outbound/worker', () => ({ processDueOutboundJobs: vi.fn() }))

const SECRET = 't'.repeat(40)
const URL_ = 'http://localhost/api/summary-items/tick'
const req = (secret?: string) => new Request(URL_, { method: 'POST', headers: secret === undefined ? {} : { [CRON_SECRET_HEADER]: secret } })
const originalSecret = process.env[CRON_SECRET_ENV]
const order = (fn: unknown) => vi.mocked(fn as () => unknown).mock.invocationCallOrder[0]

beforeEach(() => {
  vi.clearAllMocks()
  process.env[CRON_SECRET_ENV] = SECRET
  vi.mocked(pruneBotAuditLogs).mockResolvedValue({ deleted: 0 } as never)
  vi.mocked(advancePipelineStagesFromBooking).mockResolvedValue({ diperbarui: 0 })
  vi.mocked(refreshStaleBookingData).mockResolvedValue({ diperiksa: 0 })
  vi.mocked(reconcileSummaryItems).mockResolvedValue({ closed: 2, converted: 1, reopened: 0 })
  vi.mocked(createLiveReplyItems).mockResolvedValue({ created: 3, reopened: 1, skipped: 4 })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  if (originalSecret === undefined) delete process.env[CRON_SECRET_ENV]
  else process.env[CRON_SECRET_ENV] = originalSecret
})

describe('POST /api/summary-items/tick', () => {
  it('scheduler dengan secret: kebersihan, reconcile, lalu item live, dengan waktu yang sama', async () => {
    const res = await POST(req(SECRET))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ reconciled: { closed: 2, converted: 1, reopened: 0 }, live: { created: 3, reopened: 1, skipped: 4 } })
    const sequence = [pruneBotAuditLogs, advancePipelineStagesFromBooking, refreshStaleBookingData, reconcileSummaryItems, createLiveReplyItems].map(order)
    expect(sequence.every((n) => typeof n === 'number')).toBe(true)
    expect([...sequence].sort((a, b) => a - b)).toEqual(sequence)
    expect(vi.mocked(createLiveReplyItems).mock.calls[0][0]).toBe(vi.mocked(reconcileSummaryItems).mock.calls[0][0])
  })

  it('tahap pipeline naik SEBELUM reconcile (STAGE_ADVANCED di tick yang sama)', async () => {
    await POST(req(SECRET))
    expect(order(advancePipelineStagesFromBooking)).toBeLessThan(order(reconcileSummaryItems))
  })

  it.each([
    ['pruneBotAuditLogs', pruneBotAuditLogs],
    ['advancePipelineStagesFromBooking', advancePipelineStagesFromBooking],
    ['refreshStaleBookingData', refreshStaleBookingData],
  ])('%s gagal tidak menghentikan yang lain', async (_name, failing) => {
    vi.mocked(failing as () => Promise<unknown>).mockRejectedValue(new Error('down'))
    const res = await POST(req(SECRET))
    expect(res.status).toBe(200)
    for (const fn of [pruneBotAuditLogs, advancePipelineStagesFromBooking, refreshStaleBookingData, reconcileSummaryItems, createLiveReplyItems]) {
      expect(fn).toHaveBeenCalledTimes(1)
    }
    expect(console.error).toHaveBeenCalled()
  })

  it('tidak pernah memproses antrean outbound (retry ladder) dan tidak memanggil LLM', async () => {
    await POST(req(SECRET))
    expect(processDueOutboundJobs).not.toHaveBeenCalled()
    expect(reviewConversation).not.toHaveBeenCalled()
  })

  it('tanpa secret: 401 dan tidak menjalankan apa pun', async () => {
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: expect.any(String) })
    for (const fn of [pruneBotAuditLogs, advancePipelineStagesFromBooking, refreshStaleBookingData, reconcileSummaryItems, createLiveReplyItems]) {
      expect(fn).not.toHaveBeenCalled()
    }
  })

  it('secret salah atau tidak dikonfigurasi: 401', async () => {
    expect((await POST(req('x'.repeat(40)))).status).toBe(401)
    delete process.env[CRON_SECRET_ENV]
    expect((await POST(req(SECRET))).status).toBe(401)
    expect(reconcileSummaryItems).not.toHaveBeenCalled()
  })

  it('error tak terduga: 500 { error } tanpa pesan mentah, dan tercatat', async () => {
    vi.mocked(createLiveReplyItems).mockRejectedValue(new Error('password=rahasia'))
    const res = await POST(req(SECRET))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: 'Gagal menjalankan tick antrean' })
    expect(JSON.stringify(body)).not.toContain('rahasia')
    expect(console.error).toHaveBeenCalled()
  })
})
