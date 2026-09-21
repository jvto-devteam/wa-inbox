import { describe, it, expect } from 'vitest'
import { isIndonesianNumber, normalizePhoneNumber } from './phone'

describe('isIndonesianNumber', () => {
  it('recognizes a real Indonesian number (country code 62)', () => {
    expect(isIndonesianNumber('6282143403501')).toBe(true)
    expect(isIndonesianNumber('628123456789')).toBe(true)
  })

  it('does not match a non-Indonesian number', () => {
    expect(isIndonesianNumber('12025551234')).toBe(false) // US
    expect(isIndonesianNumber('60123456789')).toBe(false) // Malaysia
    expect(isIndonesianNumber('6512345678')).toBe(false) // Singapore
  })

  it('does not match a bare "62" with nothing after it, or malformed/empty input', () => {
    expect(isIndonesianNumber('62')).toBe(false)
    expect(isIndonesianNumber('')).toBe(false)
    expect(isIndonesianNumber('+6282143403501')).toBe(false) // stored format never has a leading "+"
  })
})

describe('normalizePhoneNumber', () => {
  it('strips formatting down to digits', () => {
    expect(normalizePhoneNumber('+62 812-3456-7890')).toBe('6281234567890')
  })

  it('turns an Indonesian local 0 prefix into 62', () => {
    expect(normalizePhoneNumber('082143403501')).toBe('6282143403501')
  })

  it('keeps foreign numbers as they are', () => {
    expect(normalizePhoneNumber('+1 (202) 555-1234')).toBe('12025551234')
  })

  it('refuses things that are not phone numbers', () => {
    expect(normalizePhoneNumber('')).toBeNull()
    expect(normalizePhoneNumber('12345')).toBeNull()
    expect(normalizePhoneNumber('120363335090996109@g.us')).toBeNull()
  })
})
