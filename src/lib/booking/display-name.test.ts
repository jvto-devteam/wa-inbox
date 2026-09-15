import { describe, it, expect } from 'vitest'
import { bookingGuestName, contactDisplayName } from './display-name'

describe('bookingGuestName', () => {
  it('returns the trimmed guest name when present', () => {
    expect(bookingGuestName({ guest: '  Muhammad Zayar  ' })).toBe('Muhammad Zayar')
  })

  it('returns null when bookingData has no guest field', () => {
    expect(bookingGuestName({ id: 'JVTO-3754' })).toBeNull()
  })

  it('returns null when guest is empty after trim', () => {
    expect(bookingGuestName({ guest: '   ' })).toBeNull()
  })

  it('returns null when guest is not a string', () => {
    expect(bookingGuestName({ guest: 123 })).toBeNull()
  })

  it('returns null for null/undefined/non-object bookingData', () => {
    expect(bookingGuestName(null)).toBeNull()
    expect(bookingGuestName(undefined)).toBeNull()
    expect(bookingGuestName('not an object')).toBeNull()
  })
})

describe('contactDisplayName', () => {
  it('appends the booking guest name in parentheses when it differs from the contact name', () => {
    expect(contactDisplayName('Zayar', 'Muhammad Zayar', '6281234567890')).toBe('Zayar (Muhammad Zayar)')
  })

  it('shows the name only once when the booking guest name matches the contact name, case-insensitively', () => {
    expect(contactDisplayName('Bruno Figarola', 'bruno figarola', '6281234567890')).toBe('Bruno Figarola')
  })

  it('falls back to the given fallback (e.g. phone number) plus the booking guest name when there is no contact name', () => {
    expect(contactDisplayName(null, 'Muhammad Zayar', '6281234567890')).toBe('6281234567890 (Muhammad Zayar)')
  })

  it('returns just the base name when there is no booking guest name', () => {
    expect(contactDisplayName('Zayar', null, '6281234567890')).toBe('Zayar')
  })

  it('treats a whitespace-only contact name as absent, falling back', () => {
    expect(contactDisplayName('   ', null, 'Tanpa nama')).toBe('Tanpa nama')
  })
})
