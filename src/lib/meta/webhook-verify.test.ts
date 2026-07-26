import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { verifyMetaSignature } from './webhook-verify'

describe('verifyMetaSignature', () => {
  const secret = 'test-secret'
  const body = JSON.stringify({ hello: 'world' })
  function sign(b: string) {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(b).digest('hex')
  }

  it('accepts a correctly signed payload', () => {
    expect(verifyMetaSignature(body, sign(body), secret)).toBe(true)
  })

  it('rejects a tampered payload', () => {
    expect(verifyMetaSignature(body + 'x', sign(body), secret)).toBe(false)
  })

  it('rejects a missing signature header', () => {
    expect(verifyMetaSignature(body, null, secret)).toBe(false)
  })
})
