import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { checkAndRecordRateLimit, __resetRateLimiterForTests } from './rate-limiter'

describe('checkAndRecordRateLimit', () => {
  beforeEach(() => __resetRateLimiterForTests())
  afterEach(() => vi.useRealTimers())

  it('allows a normal conversation through', () => {
    for (let i = 0; i < 20; i++) expect(checkAndRecordRateLimit('c1')).toBe(true)
  })

  it('blocks the 21st turn inside the window', () => {
    for (let i = 0; i < 20; i++) checkAndRecordRateLimit('c1')
    expect(checkAndRecordRateLimit('c1')).toBe(false)
  })

  it('scopes the budget per conversation, so one spammer cannot starve another chat', () => {
    for (let i = 0; i < 21; i++) checkAndRecordRateLimit('spammer')
    expect(checkAndRecordRateLimit('someone-else')).toBe(true)
  })

  it('lets the conversation through again once the window has rolled past', () => {
    vi.useFakeTimers()
    for (let i = 0; i < 20; i++) checkAndRecordRateLimit('c1')
    expect(checkAndRecordRateLimit('c1')).toBe(false)
    vi.advanceTimersByTime(10 * 60 * 1000 + 1)
    expect(checkAndRecordRateLimit('c1')).toBe(true)
  })
})
