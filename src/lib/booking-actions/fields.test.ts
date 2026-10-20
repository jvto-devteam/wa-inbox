/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import type { BookingData } from '@/lib/booking/client'
import { changeGroup, normalizeFieldValue, readBookingField, usesBaliTransport } from './fields'

const surabaya: BookingData = {
  total_pax: 2,
  date: { start_ymd: '2026-11-03' },
  pickup: { meeting_point: 'Surabaya Airport', meeting_point_arrival: 'GA312', meeting_point_value: 'T1', pickup_time: '09:30' },
  dropoff: { drop_point: 'Surabaya Hotel', drop_point_arrival: '', drop_point_value: 'Hotel X', drop_time: '14:00' },
  hotels: [{ day: '1', hotel: 'Hotel A' }, { day: '2', hotel: 'Hotel B' }],
  tshirtSize: 'M x 2',
  itinerary: [{ day: '1', destination: 'Surabaya' }],
}

const bali: BookingData = {
  ...surabaya,
  pickup: { ...surabaya.pickup, meeting_point: 'Bali Hotel' },
}

describe('changeGroup', () => {
  it('Surabaya Airport -> Surabaya Hotel is AI', () => {
    expect(changeGroup('pickup_point', 'Surabaya Hotel', surabaya)).toBe('AI')
  })
  it('Surabaya Hotel -> Bali Hotel is HEAVY', () => {
    const b: BookingData = { ...surabaya, pickup: { meeting_point: 'Surabaya Hotel' } }
    expect(changeGroup('pickup_point', 'Bali Hotel', b)).toBe('HEAVY')
  })
  it('moving away from a Bali point is HEAVY', () => {
    expect(changeGroup('pickup_point', 'Surabaya Hotel', bali)).toBe('HEAVY')
  })
  it('date, pax, and hotel are HEAVY', () => {
    expect(changeGroup('travel_date', '2026-11-04', surabaya)).toBe('HEAVY')
    expect(changeGroup('total_pax', '5', surabaya)).toBe('HEAVY')
    expect(changeGroup('hotel', 'X', surabaya)).toBe('HEAVY')
  })
  it('drop_time on a Bali-transport booking is BALI, on Surabaya is AI', () => {
    expect(changeGroup('drop_time', '10:00', bali)).toBe('BALI')
    expect(changeGroup('drop_time', '10:00', surabaya)).toBe('AI')
  })
})

describe('usesBaliTransport', () => {
  it('detects Bali points and a day-1 itinerary in Bali', () => {
    expect(usesBaliTransport(surabaya)).toBe(false)
    expect(usesBaliTransport(bali)).toBe(true)
    expect(usesBaliTransport({ dropoff: { drop_point: 'Denpasar Airport' } })).toBe(true)
    expect(usesBaliTransport({ itinerary: [{ day: '1', destination: 'Ubud, Bali' }] })).toBe(true)
    expect(usesBaliTransport({})).toBe(false)
  })
})

describe('readBookingField', () => {
  it('reads each field from the booking shape', () => {
    expect(readBookingField(surabaya, 'pickup_point')).toBe('Surabaya Airport')
    expect(readBookingField(surabaya, 'pickup_detail')).toBe('T1')
    expect(readBookingField(surabaya, 'pickup_arrival')).toBe('GA312')
    expect(readBookingField(surabaya, 'pickup_time')).toBe('09:30')
    expect(readBookingField(surabaya, 'drop_detail')).toBe('Hotel X')
    expect(readBookingField(surabaya, 'drop_time')).toBe('14:00')
    expect(readBookingField(surabaya, 'tshirt_sizes')).toBe('M x 2')
    expect(readBookingField(surabaya, 'travel_date')).toBe('2026-11-03')
    expect(readBookingField(surabaya, 'total_pax')).toBe('2')
    expect(readBookingField(surabaya, 'hotel')).toBe('Hotel A, Hotel B')
  })
  it('returns null for empty or unknown', () => {
    expect(readBookingField(surabaya, 'drop_arrival')).toBeNull()
    expect(readBookingField(surabaya, 'note')).toBeNull()
    expect(readBookingField({}, 'pickup_point')).toBeNull()
  })
})

describe('normalizeFieldValue', () => {
  it('pickup_time accepts common forms', () => {
    const t = (s: string) => normalizeFieldValue('pickup_time', s)
    expect(t('9 pagi')).toBe('09:00')
    expect(t('09.00')).toBe('09:00')
    expect(t('9:30')).toBe('09:30')
    expect(t('14.10')).toBe('14:10')
    expect(t('2 pm')).toBe('14:00')
    expect(t('jam 2 siang')).toBe('14:00')
    expect(t('7 malam')).toBe('19:00')
  })
  it('pickup_time rejects text without digits and bad values', () => {
    expect(normalizeFieldValue('pickup_time', 'jam sembilan')).toBeNull()
    expect(normalizeFieldValue('pickup_time', '25:00')).toBeNull()
    expect(normalizeFieldValue('pickup_time', '2026-10-20')).toBeNull()
  })
  it('total_pax is an integer 1..60', () => {
    expect(normalizeFieldValue('total_pax', '5')).toBe('5')
    for (const bad of ['0', 'abc', '61', '2.5', '-1']) expect(normalizeFieldValue('total_pax', bad)).toBeNull()
  })
  it('points only accept POINT_VALUES (case-insensitive, canonicalised)', () => {
    expect(normalizeFieldValue('pickup_point', 'surabaya hotel')).toBe('Surabaya Hotel')
    expect(normalizeFieldValue('drop_point', 'Malang Station')).toBeNull()
  })
  it('travel_date needs a real YYYY-MM-DD', () => {
    expect(normalizeFieldValue('travel_date', '2026-11-04')).toBe('2026-11-04')
    expect(normalizeFieldValue('travel_date', '2026-13-40')).toBeNull()
    expect(normalizeFieldValue('travel_date', 'besok')).toBeNull()
  })
  it('free-text fields reject blanks', () => {
    expect(normalizeFieldValue('note', '  vegetarian  ')).toBe('vegetarian')
    expect(normalizeFieldValue('note', '   ')).toBeNull()
  })
})
