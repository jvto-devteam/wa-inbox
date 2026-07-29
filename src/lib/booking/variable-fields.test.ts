import { describe, it, expect } from 'vitest'
import { bookingVariableFields, resolveVariableField, VARIABLE_FIELD_DEFS } from './variable-fields'
import { formatIDR } from '@/lib/contact-format'
import type { BookingData } from './client'

const booking: BookingData = {
  guest: 'Jane Doe',
  package: 'Ijen Blue Fire Trekking',
  date: { start: '01 Aug 2026', end: '02 Aug 2026' },
  total_pax: 4,
  financial: { payment: 500000, balance: 350000 },
  hotels: [{ day: '1', hotel: 'Luminor Hotel' }],
  guides: [{ name: 'Budi Guide' }],
  drivers: [{ name: 'Agus Driver' }],
}

describe('resolveVariableField', () => {
  it('resolves a field by its stable key against a given conversation', () => {
    expect(resolveVariableField('package', null, booking)).toBe('Ijen Blue Fire Trekking')
    expect(resolveVariableField('financialBalance', null, booking)).toBe(formatIDR(350000))
    expect(resolveVariableField('hotel:1', null, booking)).toBe('Luminor Hotel')
    expect(resolveVariableField('guide:1', null, booking)).toBe('Budi Guide')
    expect(resolveVariableField('driver:1', null, booking)).toBe('Agus Driver')
    expect(resolveVariableField('contactName', 'Jane WA', booking)).toBe('Jane WA')
  })

  it('resolves the SAME key against a different conversation with different data -- the whole point of binding by key', () => {
    const otherBooking: BookingData = { package: 'Bromo Sunrise Tour', financial: { balance: 100000 } }
    expect(resolveVariableField('package', null, otherBooking)).toBe('Bromo Sunrise Tour')
    expect(resolveVariableField('financialBalance', null, otherBooking)).toBe(formatIDR(100000))
  })

  it('returns null for an unknown key, a key with no data, or when bookingData is null', () => {
    expect(resolveVariableField('not_a_real_key', null, booking)).toBeNull()
    expect(resolveVariableField('hotel:5', null, booking)).toBeNull()
    expect(resolveVariableField('package', null, null)).toBeNull()
  })
})

describe('bookingVariableFields', () => {
  it('includes package name, remaining balance, hotel, and crew -- exactly what the user asked for', () => {
    const fields = bookingVariableFields(null, booking)
    expect(fields).toContainEqual({ key: 'package', label: 'Nama Paket', value: 'Ijen Blue Fire Trekking' })
    expect(fields).toContainEqual({ key: 'financialBalance', label: 'Sisa Tagihan', value: formatIDR(350000) })
    expect(fields).toContainEqual({ key: 'hotel:1', label: 'Nama Hotel (Hari 1)', value: 'Luminor Hotel' })
    expect(fields).toContainEqual({ key: 'guide:1', label: 'Nama Kru 1', value: 'Budi Guide' })
    expect(fields).toContainEqual({ key: 'driver:1', label: 'Nama Transportasi/Sopir 1', value: 'Agus Driver' })
  })

  it('omits a field entirely when it has no resolvable value, rather than an empty-string entry', () => {
    const fields = bookingVariableFields(null, { package: 'Ijen Trek' } as BookingData)
    expect(fields.every((f) => f.value.trim() !== '')).toBe(true)
    expect(fields.find((f) => f.key === 'financialBalance')).toBeUndefined()
    expect(fields.find((f) => f.key === 'hotel:1')).toBeUndefined()
  })

  it('returns an empty list when there is neither a contact name nor booking data', () => {
    expect(bookingVariableFields(null, null)).toEqual([])
  })
})

describe('VARIABLE_FIELD_DEFS', () => {
  it('has no duplicate keys -- each key must uniquely resolve one field', () => {
    const keys = VARIABLE_FIELD_DEFS.map((d) => d.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
