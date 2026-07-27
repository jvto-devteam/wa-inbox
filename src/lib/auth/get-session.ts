import { verifySessionToken, type SessionPayload } from '@/lib/auth/session'

export const SESSION_COOKIE_NAME = 'wa_inbox_session'

const COOKIE_PATTERN = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`)

/**
 * Reads the `wa_inbox_session` cookie off a request and verifies its JWT.
 * Returns the payload, or null when the cookie is missing, malformed, or the
 * signature/expiry doesn't check out.
 *
 * This exact cookie-regex + verify pair used to be copy-pasted in
 * src/middleware.ts, src/lib/auth/require-admin.ts, src/app/api/send/route.ts,
 * src/app/api/session/route.ts and src/app/api/contacts/[id]/notes/route.ts.
 * Security-critical parsing belongs in one place so that a future change
 * (cookie name, additional claim checks, audit logging) can't drift out of
 * sync between copies.
 *
 * Deliberately does NOT touch the database. The `tokenVersion` revocation
 * check needs a live account lookup and is done once per request in
 * src/middleware.ts, which every non-public path passes through.
 */
export async function getSession(req: Request): Promise<SessionPayload | null> {
  const token = req.headers.get('cookie')?.match(COOKIE_PATTERN)?.[1]
  if (!token) return null
  return verifySessionToken(decodeURIComponent(token))
}
