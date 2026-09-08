import type { SessionPayload } from '@/lib/auth/session'

/**
 * Whether a role carries administrative authority over the whole app.
 *
 * Every privileged action in this app collapses onto this one question. There is no permission
 * matrix any more: only ADMIN and AGENT can actually be assigned (see
 * src/app/api/accounts/route.ts), so a table distinguishing five roles was describing accounts
 * nobody could hold. OWNER stays here because the enum value still exists and an OWNER, if one
 * is ever seeded directly, must not be locked out of admin-only routes.
 */
export function hasAdminPowers(role: SessionPayload['role'] | null | undefined): boolean {
  return role === 'ADMIN' || role === 'OWNER'
}
