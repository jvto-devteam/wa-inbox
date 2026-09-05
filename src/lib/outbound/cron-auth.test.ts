/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { hasValidCronSecret, CRON_SECRET_HEADER, CRON_SECRET_ENV, MIN_SECRET_LENGTH } from './cron-auth'

const SECRET = 'a'.repeat(40)

function req(headerValue?: string): Request {
  return new Request('http://localhost/api/outbound-jobs/process', {
    method: 'POST',
    headers: headerValue === undefined ? {} : { [CRON_SECRET_HEADER]: headerValue },
  })
}

const original = process.env[CRON_SECRET_ENV]

beforeEach(() => {
  process.env[CRON_SECRET_ENV] = SECRET
})

afterEach(() => {
  if (original === undefined) delete process.env[CRON_SECRET_ENV]
  else process.env[CRON_SECRET_ENV] = original
})

describe('hasValidCronSecret', () => {
  it('accepts the configured secret', () => {
    expect(hasValidCronSecret(req(SECRET))).toBe(true)
  })

  it('rejects a wrong secret of the same length', () => {
    expect(hasValidCronSecret(req('b'.repeat(40)))).toBe(false)
  })

  it('rejects a secret of a different length without throwing', () => {
    // timingSafeEqual throws on mismatched buffer lengths; the guard must catch that first.
    expect(() => hasValidCronSecret(req('a'.repeat(39)))).not.toThrow()
    expect(hasValidCronSecret(req('a'.repeat(39)))).toBe(false)
    expect(hasValidCronSecret(req('a'.repeat(41)))).toBe(false)
  })

  it('rejects a request with no header at all', () => {
    expect(hasValidCronSecret(req())).toBe(false)
    expect(hasValidCronSecret(req(''))).toBe(false)
  })

  it('rejects EVERYTHING when the secret is not configured', () => {
    // The dangerous version of this function degrades into "everything matches" when the env
    // var is missing, turning a forgotten variable into an open endpoint.
    delete process.env[CRON_SECRET_ENV]
    expect(hasValidCronSecret(req(SECRET))).toBe(false)
    expect(hasValidCronSecret(req(''))).toBe(false)
    expect(hasValidCronSecret(req('anything'))).toBe(false)
  })

  it('rejects everything when the secret is blank', () => {
    process.env[CRON_SECRET_ENV] = ''
    expect(hasValidCronSecret(req(''))).toBe(false)
  })

  it('refuses to honour a secret too short to be meaningful', () => {
    // An operator must not be able to "protect" this endpoint with "cron".
    const short = 'x'.repeat(MIN_SECRET_LENGTH - 1)
    process.env[CRON_SECRET_ENV] = short
    expect(hasValidCronSecret(req(short))).toBe(false)
  })

  it('accepts a secret exactly at the minimum length', () => {
    const exact = 'y'.repeat(MIN_SECRET_LENGTH)
    process.env[CRON_SECRET_ENV] = exact
    expect(hasValidCronSecret(req(exact))).toBe(true)
  })
})
