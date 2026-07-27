import { getSession } from '@/lib/auth/get-session'
import { type SessionPayload } from '@/lib/auth/session'

// Shared by every admin-only route (src/app/api/accounts/route.ts,
// src/app/api/accounts/[id]/route.ts, src/app/api/numbers/credentials/route.ts,
// src/app/api/settings/route.ts, src/app/api/numbers/relink/route.ts,
// src/app/api/bot/kill-switch/route.ts, src/app/api/bot/sync-catalog/route.ts,
// src/app/api/templates/route.ts, src/app/api/templates/[id]/route.ts).
//
// The cookie parsing itself now lives in getSession() so it is shared with the
// non-admin session consumers too — this file only adds the role check.
//
// The token's `role` claim is trusted here because it cannot go stale: every
// role change bumps Account.tokenVersion, and src/middleware.ts rejects any
// request whose token carries a tokenVersion other than the account's current
// one. A demoted admin's token is therefore dead before it ever reaches here.
export async function requireAdmin(req: Request): Promise<SessionPayload | null> {
  const session = await getSession(req)
  return session?.role === 'ADMIN' ? session : null
}
