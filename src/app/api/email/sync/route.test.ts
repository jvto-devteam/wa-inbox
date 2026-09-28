import { describe, it, expect, beforeEach, vi } from 'vitest'
import { hasValidCronSecret } from '@/lib/outbound/cron-auth'
import { requireAdmin } from '@/lib/auth/require-admin'
import { syncAllMailAccounts } from '@/lib/gmail/sync'

vi.mock('@/lib/outbound/cron-auth', () => ({ hasValidCronSecret: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/gmail/sync', () => ({ syncAllMailAccounts: vi.fn() }))

import { POST } from './route'

beforeEach(() => {
  vi.mocked(hasValidCronSecret).mockReset().mockReturnValue(false)
  vi.mocked(requireAdmin).mockReset().mockResolvedValue(null)
  vi.mocked(syncAllMailAccounts).mockReset().mockResolvedValue([
    { accountId: 'mail_1', emailAddress: 'hello@x.com', ingested: 2, skipped: 0, error: null },
  ])
})

describe('POST /api/email/sync', () => {
  it('tanpa secret dan bukan admin: 403', async () => {
    expect((await POST(new Request('https://h/api/email/sync', { method: 'POST' }))).status).toBe(403)
    expect(syncAllMailAccounts).not.toHaveBeenCalled()
  })

  it('cron dengan secret yang sah menjalankan sinkronisasi', async () => {
    vi.mocked(hasValidCronSecret).mockReturnValue(true)
    const res = await POST(new Request('https://h/api/email/sync', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ results: [{ accountId: 'mail_1', emailAddress: 'hello@x.com', ingested: 2, skipped: 0, error: null }] })
  })

  it('admin boleh menekan "Sinkron sekarang"', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ accountId: 'a', role: 'ADMIN' } as never)
    expect((await POST(new Request('https://h/api/email/sync', { method: 'POST' }))).status).toBe(200)
  })
})
