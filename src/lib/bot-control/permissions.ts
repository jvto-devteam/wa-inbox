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
 * `AccountRole` in prisma/schema.prisma currently has two members: ADMIN and AGENT. OWNER,
 * BOT_MANAGER and VIEWER are named in the SDD but nobody can hold them yet, so the matrix
 * below is written in full and `roleFromAccount` maps today's two onto it.
 *
 * The consequence is worth stating rather than hiding: with only ADMIN, the person who writes
 * a rule draft is also the person who approves it. The draft → review → approve workflow is
 * real and audited, but the SEPARATION OF DUTIES it exists to create does not exist until
 * BOT_MANAGER does. Adding the enum members is what turns this file from documentation into
 * enforcement; nothing else here has to change when that happens.
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
 * Written as an exhaustive switch on the CURRENT enum so that adding OWNER, BOT_MANAGER or
 * VIEWER to `AccountRole` makes TypeScript fail here — a loud compile error at the one place
 * that has to be updated, rather than a silent fall-through that quietly denies a new role
 * everything or grants it too much.
 */
export function roleFromAccount(role: SessionPayload['role']): BotControlRole {
  switch (role) {
    case 'ADMIN':
      return 'ADMIN'
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
