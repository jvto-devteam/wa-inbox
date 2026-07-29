import { describe, it, expect } from 'vitest'
import { bookingVariableFields } from './variable-fields'
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

describe('bookingVariableFields', () => {
  it('leads with the WhatsApp contact name, distinct from the booking guest name', () => {
    const fields = bookingVariableFields('Jane WA Display Name', booking)
    expect(fields[0]).toEqual({ label: 'Nama Kontak (WhatsApp)', value: 'Jane WA Display Name' })
    expect(fields).toContainEqual({ label: 'Nama Kontak (Booking)', value: 'Jane Doe' })
  })

  it('includes package name, remaining balance, hotel, and crew -- exactly what the user asked for', () => {
    const fields = bookingVariableFields(null, booking)
    expect(fields).toContainEqual({ label: 'Nama Paket', value: 'Ijen Blue Fire Trekking' })
    expect(fields).toContainEqual({ label: 'Sisa Tagihan', value: formatIDR(350000) })
    expect(fields).toContainEqual({ label: 'Nama Hotel (Hari 1)', value: 'Luminor Hotel' })
    expect(fields).toContainEqual({ label: 'Nama Kru', value: 'Budi Guide' })
    expect(fields).toContainEqual({ label: 'Nama Transportasi/Sopir', value: 'Agus Driver' })
  })

  it('returns just the contact name when there is no booking data', () => {
    expect(bookingVariableFields('Jane', null)).toEqual([{ label: 'Nama Kontak (WhatsApp)', value: 'Jane' }])
  })

  it('returns an empty list when there is neither a contact name nor booking data', () => {
    expect(bookingVariableFields(null, null)).toEqual([])
  })

  it('surfaces a field with no known label using a humanized path, so unmapped API fields still show up', () => {
    const fields = bookingVariableFields(null, { booking_date: '2026-07-01', duration: '2D1N' } as BookingData)
    expect(fields).toContainEqual({ label: 'Tanggal Booking', value: '2026-07-01' })
    expect(fields).toContainEqual({ label: 'Durasi', value: '2D1N' })
  })

  it('does not list the same financial/hotel/guide/driver fields twice under a generic label', () => {
    const fields = bookingVariableFields(null, booking)
    const balanceEntries = fields.filter((f) => f.value === formatIDR(350000))
    expect(balanceEntries).toHaveLength(1)
  })

  it('skips a hotel/guide/driver entry with a blank name rather than inserting an empty value', () => {
    const fields = bookingVariableFields(null, { hotels: [{ day: '1', hotel: '' }], guides: [{ name: '' }] } as BookingData)
    expect(fields.find((f) => f.label.startsWith('Nama Hotel'))).toBeUndefined()
    expect(fields.find((f) => f.label === 'Nama Kru')).toBeUndefined()
  })
})
