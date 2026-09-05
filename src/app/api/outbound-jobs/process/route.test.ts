/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifySessionToken } from '@/lib/auth/session'
import { processDueOutboundJobs } from '@/lib/outbound/worker'
import { POST } from './route'

vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/outbound/worker', () => ({ processDueOutboundJobs: vi.fn() }))

const req = new Request('http://localhost/api/outbound-jobs/process', {
  method: 'POST',
  headers: { cookie: 'wa_inbox_session=tok' },
})

beforeEach(() => {
  vi.clearAllMocks()
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

  it('returns 500 with the mandated { error } shape when the worker throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(processDueOutboundJobs).mockRejectedValue(new Error('db down'))

    const res = await POST(req)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal memproses antrean' })
  })
})
