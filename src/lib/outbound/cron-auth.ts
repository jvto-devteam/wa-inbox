/**
 * Shared-secret authentication for the machine-callable outbound worker endpoint.
 *
 * --- Why this exists ---
 *
 * `POST /api/outbound-jobs/process` drives the retry ladder (attempts 2-4 at +30s, +2m and
 * +10m). Nothing in this app calls it: Next.js route handlers only run when something hits
 * them, and there is no background runner. The caller therefore has to be a scheduler — and a
 * cron job cannot hold a browser session cookie, which is what `requireAdmin` and
 * src/middleware.ts both require. Shipped as admin-only, the retry ladder could never fire in
 * production at all.
 *
 * --- Safety properties, each of which is load-bearing ---
 *
 * 1. An unset or blank `OUTBOUND_CRON_SECRET` makes this ALWAYS return false. The dangerous
 *    version of this function is one where "no secret configured" degrades into "every request
 *    matches" — that would turn a forgotten env var into an open, unauthenticated endpoint.
 * 2. The comparison is timing-safe. The endpoint is reachable by anyone who can talk to the
 *    server, so a plain `===` leaks the secret one byte at a time to a patient attacker.
 * 3. A length mismatch is rejected before the comparison, because `timingSafeEqual` throws on
 *    buffers of different lengths rather than returning false.
 * 4. The secret is required to be reasonably long, so an operator cannot accidentally protect
 *    the endpoint with something guessable like "cron".
 */
import { timingSafeEqual } from 'node:crypto'

export const CRON_SECRET_HEADER = 'x-cron-secret'
export const CRON_SECRET_ENV = 'OUTBOUND_CRON_SECRET'

/** Below this, a secret is treated as unconfigured rather than as weak protection. */
export const MIN_SECRET_LENGTH = 24

export function hasValidCronSecret(req: Request): boolean {
  const expected = process.env[CRON_SECRET_ENV]
  // No secret, or one too short to be meaningful, means this authentication path is simply
  // not available. It never means "let it through".
  if (!expected || expected.length < MIN_SECRET_LENGTH) return false

  const provided = req.headers.get(CRON_SECRET_HEADER)
  if (!provided) return false

  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  // Length is not secret (it is fixed by configuration), so returning early here leaks
  // nothing that matters, and it keeps timingSafeEqual from throwing.
  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}
