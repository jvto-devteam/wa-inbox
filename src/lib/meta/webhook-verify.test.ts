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

describe('verifyMetaSignature with multiple app secrets', () => {
  const secretA = 'secret-a'
  const secretB = 'secret-b'
  const secretC = 'unrelated-secret-c'
  const body = JSON.stringify({ hello: 'world' })

  function sign(b: string, s: string) {
    return 'sha256=' + crypto.createHmac('sha256', s).update(b).digest('hex')
  }

  it('verifies a signature made with secret A when the list is [A, B]', () => {
    expect(verifyMetaSignature(body, sign(body, secretA), [secretA, secretB])).toBe(true)
  })

  it('verifies a signature made with secret B when the list is [A, B]', () => {
    expect(verifyMetaSignature(body, sign(body, secretB), [secretA, secretB])).toBe(true)
  })

  it('rejects a signature made with an unrelated secret C when the list is [A, B]', () => {
    expect(verifyMetaSignature(body, sign(body, secretC), [secretA, secretB])).toBe(false)
  })

  it('rejects when the secret list is empty', () => {
    expect(verifyMetaSignature(body, sign(body, secretA), [])).toBe(false)
  })

  it('rejects when the secret list contains only empty strings', () => {
    expect(verifyMetaSignature(body, sign(body, secretA), ['', ''])).toBe(false)
  })

  it('verifies the valid secret when the list also contains undefined/null entries, without throwing', () => {
    expect(() =>
      verifyMetaSignature(body, sign(body, secretA), [undefined, secretA, null]),
    ).not.toThrow()
    expect(verifyMetaSignature(body, sign(body, secretA), [undefined, secretA, null])).toBe(true)
  })

  it('still rejects a tampered payload with a multi-secret list', () => {
    expect(verifyMetaSignature(body + 'x', sign(body, secretA), [secretA, secretB])).toBe(false)
  })

  it('still requires the sha256= prefix with a multi-secret list', () => {
    const raw = crypto.createHmac('sha256', secretA).update(body).digest('hex')
    expect(verifyMetaSignature(body, raw, [secretA, secretB])).toBe(false)
  })

  it('still rejects when the signature length does not match, with a multi-secret list', () => {
    expect(verifyMetaSignature(body, 'sha256=deadbeef', [secretA, secretB])).toBe(false)
  })

  it('rejects a signature whose UTF-16 length matches 64 but contains a non-ASCII character, without throwing', () => {
    // 63 ASCII hex-like chars + 1 non-ASCII char ('é') is 64 UTF-16 code units
    // (so a naive `.length` guard would pass) but 65 UTF-8 bytes once
    // `Buffer.from` encodes it — which used to make `crypto.timingSafeEqual`
    // throw a RangeError instead of returning false.
    const nonAsciiProvided = 'a'.repeat(63) + 'é'
    expect(nonAsciiProvided.length).toBe(64)
    const header = 'sha256=' + nonAsciiProvided
    expect(() => verifyMetaSignature(body, header, [secretA, secretB])).not.toThrow()
    expect(verifyMetaSignature(body, header, [secretA, secretB])).toBe(false)
  })
})
