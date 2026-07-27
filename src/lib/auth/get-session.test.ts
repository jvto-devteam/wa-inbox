/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifySessionToken } from '@/lib/auth/session'
import { getSession } from './get-session'

vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

const payload = { accountId: 'acc_1', role: 'AGENT' as const, tokenVersion: 0 }

beforeEach(() => {
  vi.mocked(verifySessionToken).mockReset()
  vi.mocked(verifySessionToken).mockResolvedValue(payload)
})

describe('getSession', () => {
  it('returns the verified payload for a valid cookie', async () => {
    const req = new Request('http://localhost', { headers: { cookie: 'wa_inbox_session=tok' } })
    expect(await getSession(req)).toEqual(payload)
    expect(verifySessionToken).toHaveBeenCalledWith('tok')
  })

  it('finds the cookie when other cookies are present', async () => {
    const req = new Request('http://localhost', { headers: { cookie: 'theme=dark; wa_inbox_session=tok; foo=bar' } })
    expect(await getSession(req)).toEqual(payload)
    expect(verifySessionToken).toHaveBeenCalledWith('tok')
  })

  it('URL-decodes the cookie value before verifying it', async () => {
    const req = new Request('http://localhost', { headers: { cookie: 'wa_inbox_session=a%2Bb' } })
    await getSession(req)
    expect(verifySessionToken).toHaveBeenCalledWith('a+b')
  })

  it('returns null when there is no cookie header at all', async () => {
    expect(await getSession(new Request('http://localhost'))).toBeNull()
    expect(verifySessionToken).not.toHaveBeenCalled()
  })

  it('returns null when the cookie header has no session cookie', async () => {
    const req = new Request('http://localhost', { headers: { cookie: 'theme=dark' } })
    expect(await getSession(req)).toBeNull()
    expect(verifySessionToken).not.toHaveBeenCalled()
  })

  it('does not mistake a differently-named cookie that merely ends in the session name', async () => {
    const req = new Request('http://localhost', { headers: { cookie: 'other_wa_inbox_session=nope' } })
    expect(await getSession(req)).toBeNull()
    expect(verifySessionToken).not.toHaveBeenCalled()
  })

  it('propagates null when the token fails verification', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null)
    const req = new Request('http://localhost', { headers: { cookie: 'wa_inbox_session=bad' } })
    expect(await getSession(req)).toBeNull()
  })
})
