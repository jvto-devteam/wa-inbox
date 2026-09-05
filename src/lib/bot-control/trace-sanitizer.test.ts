/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { sanitizeTrace, REDACTED } from './trace-sanitizer'

describe('sanitizeTrace', () => {
  it('redacts anything whose key looks like a secret, at any depth', () => {
    const out = sanitizeTrace({
      mode: 'faq',
      config: { accessToken: 'EAAG...', coexistApiKey: 'key_123', nested: { META_APP_SECRET: 'shh' } },
    }) as Record<string, unknown>

    const config = out.config as Record<string, unknown>
    expect(config.accessToken).toBe(REDACTED)
    expect(config.coexistApiKey).toBe(REDACTED)
    expect((config.nested as Record<string, unknown>).META_APP_SECRET).toBe(REDACTED)
  })

  it('keeps the key itself so a reader can see that something was removed', () => {
    // Deleting the key entirely would hide the fact that a secret was ever in the trace.
    const out = sanitizeTrace({ password: 'hunter2' }) as Record<string, unknown>
    expect(Object.keys(out)).toEqual(['password'])
  })

  it('redacts inside arrays too', () => {
    const out = sanitizeTrace({ steps: [{ label: 'a', apiKey: 'x' }] }) as Record<string, unknown>
    const steps = out.steps as Array<Record<string, unknown>>
    expect(steps[0].apiKey).toBe(REDACTED)
    expect(steps[0].label).toBe('a')
  })

  it('leaves ordinary trace content untouched', () => {
    const trace = { mode: 'faq', sourceTopic: 'inclusions', steps: [{ label: 'Cek booking', detail: 'Tidak ada booking' }] }
    expect(sanitizeTrace(trace)).toEqual(trace)
  })

  it('summarises booking data instead of copying the whole record', () => {
    const out = sanitizeTrace({
      bookingData: {
        bookingCode: 'JV-1234',
        status: 'PAID',
        customerEmail: 'a@b.com',
        hotelAddress: 'Jl. Panjang No. 1',
        passportNumber: 'X9999999',
      },
    }) as Record<string, unknown>

    const booking = out.bookingData as Record<string, unknown>
    expect(booking.bookingCode).toBe('JV-1234')
    expect(booking.status).toBe('PAID')
    // Guidebook §12: booking data may appear, but only in summary.
    expect(booking.customerEmail).toBeUndefined()
    expect(booking.passportNumber).toBeUndefined()
    expect(booking._ringkasan).toBe('3 field lain disembunyikan')
  })

  it('keeps booking fields by allowlist, so a newly added field cannot leak', () => {
    const out = sanitizeTrace({ booking: { bookingCode: 'JV-1', creditCardLast4: '4242' } }) as Record<string, unknown>
    const booking = out.booking as Record<string, unknown>
    expect(booking.creditCardLast4).toBeUndefined()
  })

  it('truncates a runaway string so one field cannot bloat every audit row', () => {
    const out = sanitizeTrace({ detail: 'x'.repeat(5000) }) as Record<string, unknown>
    expect((out.detail as string).length).toBe(2001)
    expect(out.detail).toMatch(/…$/)
  })

  it('returns JSON null for a null decision rather than throwing', () => {
    expect(sanitizeTrace(null)).toBeNull()
    expect(sanitizeTrace(undefined)).toBeNull()
  })

  it('survives a circular object instead of taking down the bot turn', () => {
    // Recording runs inside the bot's own path; a throw here would be a behaviour change.
    const circular: Record<string, unknown> = { mode: 'faq' }
    circular.self = circular
    expect(sanitizeTrace(circular)).toEqual({ _error: 'Trace tidak bisa diserialisasi' })
  })
})
