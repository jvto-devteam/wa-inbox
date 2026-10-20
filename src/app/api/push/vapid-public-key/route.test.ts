/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

import { verifySessionToken } from '@/lib/auth/session'
import { GET } from './route'

const req = () => new Request('http://localhost/api/push/vapid-public-key', { headers: { cookie: 'wa_inbox_session=tok' } })

beforeEach(() => {
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc1', role: 'AGENT', tokenVersion: 0 })
  process.env.VAPID_PUBLIC_KEY = 'pub'
  process.env.VAPID_PRIVATE_KEY = 'priv'
  process.env.VAPID_SUBJECT = 'mailto:ops@example.com'
})

describe('GET /api/push/vapid-public-key', () => {
  it('401 without session', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null)
    expect((await GET(req())).status).toBe(401)
  })

  it('returns only the public key', async () => {
    const res = await GET(req())
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ publicKey: 'pub' })
    expect(text).not.toContain('priv')
  })

  it('404 when push is not configured', async () => {
    delete process.env.VAPID_PUBLIC_KEY
    expect((await GET(req())).status).toBe(404)
  })
})
