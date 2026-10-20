/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import type { BookingData } from '@/lib/booking/client'
import { bookingTimeKnown, changeAlreadyApplied, findMismatches, type ActiveFact } from './compare'

const booking: BookingData = {
  total_pax: 4,
  date: { start_ymd: '2026-11-03' },
  pickup: { meeting_point: 'Surabaya Airport', meeting_point_arrival: 'TR296', meeting_point_value: 'Hotel Majapahit', pickup_time: '09:30' },
  dropoff: { drop_point: 'Surabaya Hotel', drop_time: '14:10' },
}

const fact = (field: ActiveFact['field'], value: string, id = 'f1'): ActiveFact => ({ id, field, value })

describe('findMismatches', () => {
  it('pax mismatch: fact 5 vs total_pax 4 -> 1 mismatch', () => {
    expect(findMismatches([fact('total_pax', '5')], booking)).toEqual([
      { field: 'total_pax', chatValue: '5', bookingValue: '4', factId: 'f1' },
    ])
  })
  it('no mismatch when pax equal', () => {
    expect(findMismatches([fact('total_pax', '4')], booking)).toEqual([])
  })
  it('no mismatch when booking time unknown (null, empty, or fake 07:00)', () => {
    for (const t of [undefined, '', '07:00']) {
      const b: BookingData = { ...booking, pickup: { ...booking.pickup, pickup_time: t } }
      expect(findMismatches([fact('pickup_time', '10:00')], b)).toEqual([])
    }
  })
  it('time mismatch when booking time is real', () => {
    expect(findMismatches([fact('pickup_time', '10:00')], booking)).toHaveLength(1)
  })
  it('time compare normalizes "14.10" == "14:10"', () => {
    expect(findMismatches([fact('drop_time', '14.10')], booking)).toEqual([])
  })
  it('flight number compare ignores case/spaces ("tr 296" == "TR296")', () => {
    expect(findMismatches([fact('pickup_arrival', 'tr 296')], booking)).toEqual([])
    expect(findMismatches([fact('pickup_arrival', 'tr 297')], booking)).toHaveLength(1)
  })
  it('detail compare is trimmed and case-insensitive', () => {
    expect(findMismatches([fact('pickup_detail', '  hotel majapahit ')], booking)).toEqual([])
  })
  it('never compares note', () => {
    expect(findMismatches([fact('note', 'vegetarian')], booking)).toEqual([])
  })
  it('missing booking value yields bookingValue null', () => {
    const r = findMismatches([fact('drop_detail', 'Hotel X')], booking)
    expect(r).toEqual([{ field: 'drop_detail', chatValue: 'Hotel X', bookingValue: null, factId: 'f1' }])
  })
})

describe('changeAlreadyApplied', () => {
  it('true when meeting_point_value equals proposed hotel (case-insensitive, trimmed)', () => {
    expect(changeAlreadyApplied({ field: 'pickup_detail', value: ' HOTEL majapahit ' }, booking)).toBe(true)
  })
  it('false when different or booking value missing', () => {
    expect(changeAlreadyApplied({ field: 'pickup_detail', value: 'Hotel Lain' }, booking)).toBe(false)
    expect(changeAlreadyApplied({ field: 'drop_detail', value: 'Hotel X' }, booking)).toBe(false)
  })
  it('note is never already applied', () => {
    expect(changeAlreadyApplied({ field: 'note', value: 'x' }, booking)).toBe(false)
  })
  it('time not applied when booking time unknown, applied when equal', () => {
    const b: BookingData = { ...booking, pickup: { ...booking.pickup, pickup_time: '07:00' } }
    expect(changeAlreadyApplied({ field: 'pickup_time', value: '07:00' }, b)).toBe(false)
    expect(changeAlreadyApplied({ field: 'drop_time', value: '14.10' }, booking)).toBe(true)
  })
})

describe('bookingTimeKnown', () => {
  it('null/undefined/empty are unknown', () => {
    expect(bookingTimeKnown(null)).toBe(false)
    expect(bookingTimeKnown(undefined)).toBe(false)
    expect(bookingTimeKnown('')).toBe(false)
    expect(bookingTimeKnown('  ')).toBe(false)
  })
  it("'07:00' (strtotime(null) fake) is unknown, '07:30' is known", () => {
    expect(bookingTimeKnown('07:00')).toBe(false)
    expect(bookingTimeKnown('07:30')).toBe(true)
  })
})
