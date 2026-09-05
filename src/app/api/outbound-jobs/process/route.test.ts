/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { verifySessionToken } from '@/lib/auth/session'
import { processDueOutboundJobs } from '@/lib/outbound/worker'
import { CRON_SECRET_ENV, CRON_SECRET_HEADER } from '@/lib/outbound/cron-auth'
import { POST } from './route'

vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/outbound/worker', () => ({ processDueOutboundJobs: vi.fn() }))

const SECRET = 'c'.repeat(40)

const req = new Request('http://localhost/api/outbound-jobs/process', {
  method: 'POST',
  headers: { cookie: 'wa_inbox_session=tok' },
})

function cronReq(secret?: string) {
  return new Request('http://localhost/api/outbound-jobs/process', {
    method: 'POST',
    headers: secret === undefined ? {} : { [CRON_SECRET_HEADER]: secret },
  })
}

const originalSecret = process.env[CRON_SECRET_ENV]

afterEach(() => {
  if (originalSecret === undefined) delete process.env[CRON_SECRET_ENV]
  else process.env[CRON_SECRET_ENV] = originalSecret
})

beforeEach(() => {
  vi.clearAllMocks()
  process.env[CRON_SECRET_ENV] = SECRET
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  vi.mocked(processDueOutboundJobs).mockResolvedValue({ processed: 3, sent: 2, failed: 0, retrying: 1 })
})

describe('POST /api/outbound-jobs/process', () => {
  it('runs the due jobs and returns the tally', async () => {
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ processed: 3, sent: 2, failed: 0, retrying: 1 })
  })

  it('refuses an AGENT', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })

    const res = await POST(req)
    expect(res.status).toBe(403)
    expect(processDueOutboundJobs).not.toHaveBeenCalled()
  })

  it('accepts a scheduler presenting the shared secret, with no session at all', async () => {
    // A cron cannot hold a browser session cookie. Without this path the retry ladder could
    // never fire in production.
    const res = await POST(cronReq(SECRET))
    expect(res.status).toBe(200)
    expect(processDueOutboundJobs).toHaveBeenCalled()
  })

  it('refuses a wrong secret', async () => {
    const res = await POST(cronReq('d'.repeat(40)))
    expect(res.status).toBe(403)
    expect(processDueOutboundJobs).not.toHaveBeenCalled()
  })

  it('refuses a request with neither secret nor session', async () => {
    const res = await POST(cronReq())
    expect(res.status).toBe(403)
    expect(processDueOutboundJobs).not.toHaveBeenCalled()
  })

  it('re-checks the secret itself rather than trusting the middleware', async () => {
    // Defence in depth: a future edit to middleware's matcher must not silently
    // unauthenticate this endpoint.
    delete process.env[CRON_SECRET_ENV]
    const res = await POST(cronReq('anything'))
    expect(res.status).toBe(403)
    expect(processDueOutboundJobs).not.toHaveBeenCalled()
  })

  it('returns 500 with the mandated { error } shape when the worker throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(processDueOutboundJobs).mockRejectedValue(new Error('db down'))

    const res = await POST(req)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal memproses antrean' })
  })
})
