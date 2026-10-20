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
  it('time applied when equal ("14.10" == "14:10")', () => {
    expect(changeAlreadyApplied({ field: 'drop_time', value: '14.10' }, booking)).toBe(true)
  })
  it("final review Important 3: '07:00' proposal on a booking showing '07:00' IS applied (no card loop); still never a MISMATCH", () => {
    const b: BookingData = { ...booking, pickup: { ...booking.pickup, pickup_time: '07:00' } }
    expect(changeAlreadyApplied({ field: 'pickup_time', value: '07:00' }, b)).toBe(true)
    expect(changeAlreadyApplied({ field: 'pickup_time', value: '7 pagi' }, b)).toBe(true)
    expect(changeAlreadyApplied({ field: 'pickup_time', value: '09:00' }, b)).toBe(false)
    // R2 tetap: jam 07:00 booking tidak memicu peringatan.
    expect(findMismatches([fact('pickup_time', '09:00')], b)).toEqual([])
  })
  it('empty booking time is never "applied"', () => {
    const b: BookingData = { ...booking, pickup: { ...booking.pickup, pickup_time: '' } }
    expect(changeAlreadyApplied({ field: 'pickup_time', value: '07:00' }, b)).toBe(false)
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

describe('hotel (Ruling R9)', () => {
  const b: BookingData = { ...booking, hotels: [{ day: '1', hotel: 'Hotel Majapahit' }, { day: '2', hotel: 'Bromo Permai' }] }
  it('cocok dengan salah satu nama hotel, trim + case-insensitive', () => {
    expect(findMismatches([fact('hotel', '  bromo permai ')], b)).toEqual([])
    expect(changeAlreadyApplied({ field: 'hotel', value: 'HOTEL MAJAPAHIT' }, b)).toBe(true)
  })
  it('hotel yang tidak ada di daftar tetap mismatch', () => {
    expect(findMismatches([fact('hotel', 'Hotel Lain')], b)).toHaveLength(1)
  })
})

describe('final review Important 4: tshirt sizes compared canonically', () => {
  const b: BookingData = { ...booking, tshirtSize: 'M x 2, L x 1' }
  it('reordered / lower-case / count-first forms match the backoffice string', () => {
    for (const v of ['L x 1, M x 2', 'm x 2, l x 1', '1 L, 2 M', 'L:1; M:2']) {
      expect(changeAlreadyApplied({ field: 'tshirt_sizes', value: v }, b)).toBe(true)
      expect(findMismatches([fact('tshirt_sizes', v)], b)).toEqual([])
    }
  })
  it('different counts still mismatch', () => {
    expect(changeAlreadyApplied({ field: 'tshirt_sizes', value: 'M x 1, L x 2' }, b)).toBe(false)
    expect(findMismatches([fact('tshirt_sizes', 'M x 3')], b)).toHaveLength(1)
  })
  it('backoffice-only sizes (XXXL) are read too', () => {
    const big: BookingData = { ...booking, tshirtSize: 'XL x 1, XXXL x 1' }
    expect(changeAlreadyApplied({ field: 'tshirt_sizes', value: '3XL x 1, XL x 1' }, big)).toBe(true)
  })
})
