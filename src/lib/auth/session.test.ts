/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createSessionCookie, verifySessionToken } from './session'

beforeAll(() => {
  process.env.SESSION_SECRET = 'a'.repeat(64)
})

describe('session tokens', () => {
  it('round-trips a valid token', async () => {
    const token = await createSessionCookie({ accountId: 'acc_1', role: 'AGENT' })
    const payload = await verifySessionToken(token)
    expect(payload).toEqual({ accountId: 'acc_1', role: 'AGENT' })
  })

  it('rejects a tampered token', async () => {
    const token = await createSessionCookie({ accountId: 'acc_1', role: 'AGENT' })
    const tampered = token.slice(0, -2) + 'xx'
    const payload = await verifySessionToken(tampered)
    expect(payload).toBeNull()
  })
})
