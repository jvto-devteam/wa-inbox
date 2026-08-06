import { describe, it, expect } from 'vitest'
import { isIndonesianNumber } from './phone'

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
