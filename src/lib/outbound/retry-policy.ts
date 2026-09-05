/**
 * When a failed outbound job may be tried again.
 *
 * The ladder is guidebook §16.1's, verbatim:
 *
 *   attempt 1 — immediate
 *   attempt 2 — after 30 seconds
 *   attempt 3 — after 2 minutes
 *   attempt 4 — after 10 minutes
 *   then FAILED
 *
 * The shape (short, then widening) is what a transient provider blip actually needs: most
 * wa-coexist failures clear within seconds, so waiting ten minutes on the first retry would
 * make a customer wait ten minutes for a message that could have gone out immediately. The
 * widening tail then stops a genuinely-down provider from being hammered.
 */

/** Delay before attempt N (1-indexed). Index 0 is attempt 1 and is always immediate. */
export const RETRY_DELAYS_MS = [0, 30_000, 120_000, 600_000] as const

export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length

/**
 * Milliseconds to wait before the attempt that follows `attemptsSoFar`.
 *
 * Returns null when the ladder is exhausted — the caller must then mark the job FAILED rather
 * than inventing a delay. A number is never returned for an attempt that should not happen.
 */
export function delayForNextAttempt(attemptsSoFar: number, maxAttempts: number = MAX_ATTEMPTS): number | null {
  // A negative or fractional attempt count can only come from corrupted data; treat it as "no
  // attempts yet" rather than indexing off the end of the ladder.
  const attempts = Number.isFinite(attemptsSoFar) ? Math.max(0, Math.floor(attemptsSoFar)) : 0
  if (attempts >= maxAttempts) return null
  // A job whose maxAttempts an operator raised beyond the ladder keeps the longest delay
  // rather than falling off the end into `undefined`.
  return RETRY_DELAYS_MS[attempts] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]
}

/** The timestamp of the next attempt, or null when the job is out of attempts. */
export function nextAttemptAt(attemptsSoFar: number, maxAttempts: number = MAX_ATTEMPTS, now: Date = new Date()): Date | null {
  const delay = delayForNextAttempt(attemptsSoFar, maxAttempts)
  return delay === null ? null : new Date(now.getTime() + delay)
}

/** True when a job that just failed still has an attempt left. */
export function canRetry(attemptsSoFar: number, maxAttempts: number = MAX_ATTEMPTS): boolean {
  return delayForNextAttempt(attemptsSoFar, maxAttempts) !== null
}
