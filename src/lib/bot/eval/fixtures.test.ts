import { describe, expect, it } from 'vitest'
import { EVAL_CASES } from './fixtures'

// Guards the discipline fixtures.ts's own header demands: every case must cite a real,
// already-documented customer message, and must assert something a reply could actually fail.
// Runs in the normal suite -- no Ollama, no DB -- unlike run-eval.ts itself.
describe('EVAL_CASES', () => {
  it('every case cites where it came from and asserts something', () => {
    for (const c of EVAL_CASES) {
      expect(c.source, `${c.id} has no source`).toMatch(/\d{4}-\d{2}-\d{2}|this plan/)
      expect(c.mustContain.length + c.mustNotContain.length, `${c.id} asserts nothing`).toBeGreaterThan(0)
    }
  })

  it('uses lowercase assertions, since the runner lowercases the reply', () => {
    for (const c of EVAL_CASES) {
      for (const s of [...c.mustContain, ...c.mustNotContain]) expect(s).toBe(s.toLowerCase())
    }
  })

  it('has unique ids', () => {
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length)
  })
})
