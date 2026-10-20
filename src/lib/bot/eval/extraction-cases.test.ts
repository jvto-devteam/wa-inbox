import { describe, expect, it } from 'vitest'
import { EXTRACTION_CASES } from './extraction-cases'

describe('EXTRACTION_CASES', () => {
  it('has the five golden cases with unique ids, a source, and something to assert', () => {
    expect(EXTRACTION_CASES).toHaveLength(5)
    expect(new Set(EXTRACTION_CASES.map((c) => c.id)).size).toBe(5)
    for (const c of EXTRACTION_CASES) {
      expect(c.source, `${c.id} has no source`).toMatch(/\d{4}-\d{2}-\d{2}|this plan/)
      expect(c.guestMessages.length).toBeGreaterThan(0)
      expect(c.expectChanges.length + c.expectFacts.length > 0 || c.expectNone, `${c.id} asserts nothing`).toBe(true)
    }
  })
})
