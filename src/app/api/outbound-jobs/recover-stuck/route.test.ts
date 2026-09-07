/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifySessionToken } from '@/lib/auth/session'
import { recoverStuckOutboundJobs } from '@/lib/outbound/worker'
import { POST } from './route'

vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/outbound/worker', () => ({ recoverStuckOutboundJobs: vi.fn() }))

function req(withSession = true) {
  return new Request('http://localhost/api/outbound-jobs/recover-stuck', {
    method: 'POST',
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  vi.mocked(recoverStuckOutboundJobs).mockResolvedValue({ requeued: 2, failed: 1 })
})

describe('POST /api/outbound-jobs/recover-stuck', () => {
  it('recovers abandoned jobs and reports what it moved', async () => {
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ requeued: 2, failed: 1 })
  })

  it('reports an empty run rather than pretending nothing happened', async () => {
    // "0 dipulihkan" means the queue is healthy, which is different information from an error.
    vi.mocked(recoverStuckOutboundJobs).mockResolvedValue({ requeued: 0, failed: 0 })
    expect(await (await POST(req())).json()).toEqual({ requeued: 0, failed: 0 })
  })

  it('refuses an AGENT — this moves job state for the whole account', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })

    const res = await POST(req())
    expect(res.status).toBe(403)
    expect(recoverStuckOutboundJobs).not.toHaveBeenCalled()
  })

  it('refuses a request with no session at all', async () => {
    const res = await POST(req(false))
    expect(res.status).toBe(403)
    expect(recoverStuckOutboundJobs).not.toHaveBeenCalled()
  })

  it('reports a recovery failure as a 500 without leaking the raw error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(recoverStuckOutboundJobs).mockRejectedValue(new Error('db down'))

    const res = await POST(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal memulihkan job yang menggantung' })
  })
})
