import { describe, expect, it } from 'vitest'
import { canRevertBatch, canRevertValue } from './view'

describe('canRevertValue / canRevertBatch (shared by server and UI)', () => {
  it('refuses null, blank, and the fake 07:00 time; accepts real values', () => {
    expect(canRevertValue('pickup_time', null)).toBe(false)
    expect(canRevertValue('pickup_point', '  ')).toBe(false)
    expect(canRevertValue('drop_time', '07:00')).toBe(false)
    expect(canRevertValue('pickup_time', '10:30')).toBe(true)
    expect(canRevertValue('pickup_point', 'Surabaya Airport')).toBe(true)
  })

  it('a batch needs every member revertable and a non-empty previousDetail', () => {
    const ok = [{ field: 'pickup_point', oldValue: 'Surabaya Airport' }]
    expect(canRevertBatch(ok)).toBe(true)
    expect(canRevertBatch(ok, { pickup_detail: 'GA 300' })).toBe(true)
    expect(canRevertBatch(ok, { pickup_detail: null })).toBe(false)
    expect(canRevertBatch([...ok, { field: 'pickup_detail', oldValue: null }])).toBe(false)
    expect(canRevertBatch([])).toBe(false)
  })
})
