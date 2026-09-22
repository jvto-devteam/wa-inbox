/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifySessionToken } from '@/lib/auth/session'
import { CRON_SECRET_ENV, CRON_SECRET_HEADER } from '@/lib/outbound/cron-auth'
import { generateDailySummary } from '@/lib/daily-summary/generate'
import { POST } from './route'

vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/daily-summary/generate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/daily-summary/generate')>()),
  generateDailySummary: vi.fn(),
}))

const SECRET = 'd'.repeat(40)
const URL_ = 'http://localhost/api/daily-summary/generate'

function adminReq(body?: unknown) {
  return new Request(URL_, {
    method: 'POST',
    headers: { cookie: 'wa_inbox_session=tok' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function cronReq(secret?: string) {
  return new Request(URL_, { method: 'POST', headers: secret === undefined ? {} : { [CRON_SECRET_HEADER]: secret } })
}

const originalSecret = process.env[CRON_SECRET_ENV]

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-21T17:00:30Z')) // 00:00:30 WIB 22 September
  process.env[CRON_SECRET_ENV] = SECRET
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  vi.mocked(generateDailySummary).mockResolvedValue({ outcome: 'generated', date: '2026-09-21', status: 'DONE' })
})

afterEach(() => {
  vi.useRealTimers()
  if (originalSecret === undefined) delete process.env[CRON_SECRET_ENV]
  else process.env[CRON_SECRET_ENV] = originalSecret
})

describe('POST /api/daily-summary/generate', () => {
  it('scheduler dengan secret meringkas hari WIB yang baru selesai', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null)
    const res = await POST(cronReq(SECRET))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ date: '2026-09-21', status: 'DONE' })
    expect(vi.mocked(generateDailySummary).mock.calls[0][0]).toBe('2026-09-21')
  })

  it('menolak tanpa secret dan tanpa sesi admin', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null)
    expect((await POST(cronReq('salah'.repeat(10)))).status).toBe(403)
    expect(generateDailySummary).not.toHaveBeenCalled()
  })

  it('menolak AGENT', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
    expect((await POST(adminReq())).status).toBe(403)
  })

  it('admin bisa membuat ulang tanggal tertentu', async () => {
    const res = await POST(adminReq({ date: '2026-09-15' }))
    expect(res.status).toBe(200)
    expect(vi.mocked(generateDailySummary).mock.calls[0][0]).toBe('2026-09-15')
  })

  it.each([
    ['hari ini', { date: '2026-09-22' }, 'Hari itu belum selesai'],
    ['lewat retensi 30 hari', { date: '2026-08-01' }, 'Tanggal itu sudah lewat masa simpan 30 hari'],
    ['format salah', { date: '21-09-2026' }, 'Format tanggal harus YYYY-MM-DD'],
    ['field tak dikenal', { date: '2026-09-21', extra: 1 }, undefined],
  ])('menolak %s dengan 400', async (_label, body, message) => {
    const res = await POST(adminReq(body))
    expect(res.status).toBe(400)
    if (message) expect((await res.json()).error).toBe(message)
    expect(generateDailySummary).not.toHaveBeenCalled()
  })

  it('409 saat sedang berjalan, 500 saat gagal', async () => {
    vi.mocked(generateDailySummary).mockResolvedValueOnce({ outcome: 'already_running', date: '2026-09-21' })
    expect((await POST(adminReq())).status).toBe(409)
    vi.mocked(generateDailySummary).mockResolvedValueOnce({ outcome: 'failed', date: '2026-09-21' })
    const res = await POST(adminReq())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal membuat ringkasan' })
  })
})
