/**
 * The Bot Control permission matrix, SDD Manage Second §13.
 *
 * --- Why this is a table and not a pile of `role === 'ADMIN'` checks ---
 *
 * The matrix has five roles and eleven actions, and the interesting cells are the ones where
 * two roles differ by exactly one capability: a BOT_MANAGER may edit a draft but not approve
 * it; an OWNER may override a failed test and an ADMIN may not. Scattered inline checks lose
 * exactly those distinctions, because each site only ever asks "am I admin?" and the answer
 * looks right until the day a second privileged role exists.
 *
 * --- What is actually enforceable today, and what is not ---
 *
 * `AccountRole` in prisma/schema.prisma now has OWNER, ADMIN, BOT_MANAGER and AGENT. VIEWER is
 * described by the SDD and nobody can hold it yet; its row is written anyway, so it is already
 * correct when it lands.
 *
 * Phase H is where this file stopped being documentation and became enforcement. Until then
 * every privileged role collapsed onto ADMIN, which meant the person who wrote a draft was
 * also the person who approved it — the workflow was real and audited, but the SEPARATION OF
 * DUTIES it exists to create was not. A BOT_MANAGER can now write and send to review and go no
 * further; an OWNER, and only an OWNER, can publish over a failing test suite.
 */
import type { SessionPayload } from '@/lib/auth/session'

/** Every role the matrix describes, including the ones no account can hold yet. */
export const BOT_CONTROL_ROLES = ['OWNER', 'ADMIN', 'BOT_MANAGER', 'AGENT', 'VIEWER'] as const
export type BotControlRole = (typeof BOT_CONTROL_ROLES)[number]

export const BOT_CONTROL_ACTIONS = [
  'VIEW_BOT_CONTROL',
  'EDIT_RULE_DRAFT',
  'EDIT_KNOWLEDGE_DRAFT',
  'EDIT_FLOW_CONFIG',
  'CREATE_TEST_CASE',
  'RUN_TEST',
  'APPROVE',
  'PUBLISH',
  'ROLLBACK',
  'OVERRIDE_FAILED_TEST',
  'VIEW_AUDIT_LOGS',
] as const
export type BotControlAction = (typeof BOT_CONTROL_ACTIONS)[number]

/** SDD Manage Second §13, transcribed row for row. */
const MATRIX: Record<BotControlAction, readonly BotControlRole[]> = {
  VIEW_BOT_CONTROL: ['OWNER', 'ADMIN', 'BOT_MANAGER', 'AGENT', 'VIEWER'],
  EDIT_RULE_DRAFT: ['OWNER', 'ADMIN', 'BOT_MANAGER'],
  // AGENT is "Limited" in the matrix rather than a plain yes. Until the narrower rule is
  // specified (Phase D), the safe reading of "limited" is "not yet" — granting broadly now and
  // tightening later is the direction that leaks.
  EDIT_KNOWLEDGE_DRAFT: ['OWNER', 'ADMIN', 'BOT_MANAGER'],
  EDIT_FLOW_CONFIG: ['OWNER', 'ADMIN', 'BOT_MANAGER'],
  CREATE_TEST_CASE: ['OWNER', 'ADMIN', 'BOT_MANAGER', 'AGENT'],
  RUN_TEST: ['OWNER', 'ADMIN', 'BOT_MANAGER', 'AGENT'],
  // Deliberately excludes BOT_MANAGER: whoever writes the change may not be the one who waves
  // it through. That is the whole point of the review step.
  APPROVE: ['OWNER', 'ADMIN'],
  PUBLISH: ['OWNER', 'ADMIN'],
  ROLLBACK: ['OWNER', 'ADMIN'],
  // Owner only. An ADMIN who could wave away a failing test would make the test gate advisory.
  OVERRIDE_FAILED_TEST: ['OWNER'],
  VIEW_AUDIT_LOGS: ['OWNER', 'ADMIN', 'BOT_MANAGER'],
}

/**
 * Maps a stored account role onto the matrix.
 *
 * Still written as an exhaustive switch: adding a further member to `AccountRole` must fail
 * compilation here rather than fall through and silently deny the new role everything, or
 * grant it too much. That is exactly what happened when OWNER and BOT_MANAGER were added in
 * Phase H — the compiler pointed at this function and at nothing else.
 *
 * VIEWER is in the matrix but not in the enum: it is described by the SDD and nobody can hold
 * it yet. Listing it costs nothing and means the row is already written when it lands.
 */
export function roleFromAccount(role: SessionPayload['role']): BotControlRole {
  switch (role) {
    case 'OWNER':
      return 'OWNER'
    case 'ADMIN':
      return 'ADMIN'
    case 'BOT_MANAGER':
      return 'BOT_MANAGER'
    case 'AGENT':
      return 'AGENT'
  }
}

export function roleCan(role: BotControlRole, action: BotControlAction): boolean {
  return MATRIX[action].includes(role)
}

/** The check every route actually calls. A null session is never permitted anything. */
export function sessionCan(session: SessionPayload | null, action: BotControlAction): boolean {
  if (!session) return false
  return roleCan(roleFromAccount(session.role), action)
}

/** Roles allowed to perform an action — used by tests and by error copy. */
export function rolesAllowedTo(action: BotControlAction): readonly BotControlRole[] {
  return MATRIX[action]
}

/**
 * The matrix check, for callers holding a role name rather than a session.
 *
 * Client components need this: they know the role from `/api/session` and have no
 * `SessionPayload`. Asking them to reconstruct one, or to fall back to `hasAdminPowers`, is how
 * a BOT_MANAGER ends up looking at a page with no edit controls on it even though the API would
 * accept every one of their requests.
 */
export function roleNameCan(role: SessionPayload['role'] | null | undefined, action: BotControlAction): boolean {
  if (!role) return false
  return roleCan(roleFromAccount(role), action)
}

/**
 * Whether a role carries administrative authority over the whole app.
 *
 * Exists because `role === 'ADMIN'` was, until Phase H, a correct spelling of that question and
 * is now a WRONG one: an OWNER outranks an ADMIN everywhere in the matrix, so a literal
 * equality check would lock the most privileged account out of settings, account management and
 * every admin-only route. Every such site reads this instead.
 *
 * Deliberately not derived from the matrix: the matrix is about Bot Control, and this answers a
 * broader question about the rest of the app, where there is no matrix to consult.
 */
export function hasAdminPowers(role: SessionPayload['role'] | null | undefined): boolean {
  return role === 'ADMIN' || role === 'OWNER'
}
