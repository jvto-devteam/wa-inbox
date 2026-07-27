/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { SignJWT } from 'jose'
import { createSessionCookie, verifySessionToken } from './session'

beforeAll(() => {
  process.env.SESSION_SECRET = 'a'.repeat(64)
})

describe('session tokens', () => {
  it('round-trips a valid token', async () => {
    const token = await createSessionCookie({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
    const payload = await verifySessionToken(token)
    expect(payload).toEqual({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
  })

  it('rejects a tampered token', async () => {
    const token = await createSessionCookie({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
    const tampered = token.slice(0, -2) + 'xx'
    const payload = await verifySessionToken(tampered)
    expect(payload).toBeNull()
  })

  it('carries tokenVersion through so the account lookup can revoke stale sessions', async () => {
    const token = await createSessionCookie({ accountId: 'acc_1', role: 'ADMIN', tokenVersion: 7 })
    expect(await verifySessionToken(token)).toEqual({ accountId: 'acc_1', role: 'ADMIN', tokenVersion: 7 })
  })

  it('rejects a correctly-signed token that predates the tokenVersion claim', async () => {
    // Exactly the shape createSessionCookie used to produce. The signature is
    // valid, but there is no version to compare against the account, so it
    // must not be accepted as a session.
    const legacy = await new SignJWT({ accountId: 'acc_1', role: 'ADMIN' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(new TextEncoder().encode(process.env.SESSION_SECRET!))

    expect(await verifySessionToken(legacy)).toBeNull()
  })
})
