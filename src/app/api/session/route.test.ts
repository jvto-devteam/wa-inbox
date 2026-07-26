import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifySessionToken } from '@/lib/auth/session'
import { GET } from './route'

vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

beforeEach(() => {
  vi.mocked(verifySessionToken).mockReset()
})

describe('GET /api/session', () => {
  it('returns the role for a valid session cookie', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN' })
    const req = new Request('http://localhost', { headers: { cookie: 'wa_inbox_session=tok' } })
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ role: 'ADMIN' })
  })

  it('returns 401 when there is no session cookie', async () => {
    const req = new Request('http://localhost')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 when the session token is invalid', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null)
    const req = new Request('http://localhost', { headers: { cookie: 'wa_inbox_session=bad' } })
    const res = await GET(req)
    expect(res.status).toBe(401)
  })
})
