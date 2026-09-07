/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifySessionToken } from '@/lib/auth/session'
import { POST } from './route'

vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

function req(withSession = true) {
  return new Request('http://localhost/api/bot-control/releases/preview', {
    method: 'POST',
    headers: withSession ? { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' } : {},
    body: JSON.stringify({}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
})

describe('POST /api/bot-control/releases/preview', () => {
  it('returns the change summary shape the SDD specifies', async () => {
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      changes: { rules: 0, knowledge: 0, flows: 0, channelPolicy: 0 },
      requiresTestRun: false,
      blockingIssues: [],
    })
  })

  it('refuses an AGENT — a preview enumerates every pending change in the account', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
    expect((await POST(req())).status).toBe(403)
  })

  it('refuses a request with no session', async () => {
    expect((await POST(req(false))).status).toBe(403)
  })
})
