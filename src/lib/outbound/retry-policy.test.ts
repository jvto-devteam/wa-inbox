/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { RETRY_DELAYS_MS, MAX_ATTEMPTS, delayForNextAttempt, nextAttemptAt, canRetry } from './retry-policy'

describe('retry ladder', () => {
  it('matches the guidebook exactly: immediate, 30s, 2m, 10m', () => {
    expect(RETRY_DELAYS_MS).toEqual([0, 30_000, 120_000, 600_000])
    expect(MAX_ATTEMPTS).toBe(4)
  })

  it('makes the first attempt immediate, so the queue adds no latency to a healthy send', () => {
    expect(delayForNextAttempt(0)).toBe(0)
  })

  it('walks the ladder as attempts accumulate', () => {
    expect(delayForNextAttempt(1)).toBe(30_000)
    expect(delayForNextAttempt(2)).toBe(120_000)
    expect(delayForNextAttempt(3)).toBe(600_000)
  })

  it('returns null once the ladder is exhausted rather than inventing a delay', () => {
    expect(delayForNextAttempt(4)).toBeNull()
    expect(delayForNextAttempt(99)).toBeNull()
    expect(canRetry(4)).toBe(false)
    expect(canRetry(3)).toBe(true)
  })

  it('respects a per-job maxAttempts lower than the ladder', () => {
    expect(delayForNextAttempt(2, 2)).toBeNull()
    expect(canRetry(1, 2)).toBe(true)
  })

  it('keeps the longest delay when maxAttempts is raised beyond the ladder', () => {
    // Without the fallback this would index off the end and return undefined, which would
    // become an Invalid Date and quietly park the job forever.
    expect(delayForNextAttempt(5, 8)).toBe(600_000)
  })

  it('treats corrupted attempt counts as "no attempts yet"', () => {
    expect(delayForNextAttempt(-3)).toBe(0)
    expect(delayForNextAttempt(Number.NaN)).toBe(0)
  })
})

describe('nextAttemptAt', () => {
  it('adds the delay to the supplied clock', () => {
    const now = new Date('2026-09-05T04:00:00.000Z')
    expect(nextAttemptAt(1, 4, now)).toEqual(new Date('2026-09-05T04:00:30.000Z'))
    expect(nextAttemptAt(3, 4, now)).toEqual(new Date('2026-09-05T04:10:00.000Z'))
  })

  it('is null when there is no attempt left', () => {
    expect(nextAttemptAt(4)).toBeNull()
  })
})
