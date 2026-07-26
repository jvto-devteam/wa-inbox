import { verifySessionToken, type SessionPayload } from '@/lib/auth/session'

// Shared by every admin-only route (src/app/api/accounts/route.ts,
// src/app/api/accounts/[id]/route.ts, src/app/api/numbers/credentials/route.ts).
// Previously this cookie-parsing + role check was copy-pasted verbatim in
// each of those three files — security-sensitive logic like this belongs in
// one place so a future change (cookie name, rate limiting, audit logging)
// can't silently drift out of sync between copies.
export async function requireAdmin(req: Request): Promise<SessionPayload | null> {
  const token = req.headers.get('cookie')?.match(/wa_inbox_session=([^;]+)/)?.[1]
  const session = token ? await verifySessionToken(decodeURIComponent(token)) : null
  return session?.role === 'ADMIN' ? session : null
}
