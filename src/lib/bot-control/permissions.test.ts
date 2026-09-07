/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import {
  roleCan,
  rolesAllowedTo,
  roleFromAccount,
  roleNameCan,
  hasAdminPowers,
  sessionCan,
  BOT_CONTROL_ACTIONS,
} from './permissions'

describe('permission matrix', () => {
  it('covers every action', () => {
    for (const action of BOT_CONTROL_ACTIONS) {
      expect(rolesAllowedTo(action).length, action).toBeGreaterThan(0)
    }
  })

  it('lets a BOT_MANAGER write a draft but not approve it', () => {
    // The separation of duties the review step exists to create: whoever writes the change is
    // not the one who waves it through.
    expect(roleCan('BOT_MANAGER', 'EDIT_RULE_DRAFT')).toBe(true)
    expect(roleCan('BOT_MANAGER', 'APPROVE')).toBe(false)
    expect(roleCan('BOT_MANAGER', 'PUBLISH')).toBe(false)
  })

  it('reserves overriding a failed test for OWNER alone', () => {
    // An ADMIN who could wave away a failing test would make the test gate advisory.
    expect(roleCan('OWNER', 'OVERRIDE_FAILED_TEST')).toBe(true)
    expect(roleCan('ADMIN', 'OVERRIDE_FAILED_TEST')).toBe(false)
  })

  it('keeps AGENT out of every configuration-changing action', () => {
    for (const action of ['EDIT_RULE_DRAFT', 'EDIT_FLOW_CONFIG', 'APPROVE', 'PUBLISH', 'ROLLBACK'] as const) {
      expect(roleCan('AGENT', action), action).toBe(false)
    }
  })

  it('keeps AGENT out of audit logs but lets them see Bot Control', () => {
    expect(roleCan('AGENT', 'VIEW_AUDIT_LOGS')).toBe(false)
    expect(roleCan('AGENT', 'VIEW_BOT_CONTROL')).toBe(true)
  })

  it('gives VIEWER nothing but reading Bot Control', () => {
    for (const action of BOT_CONTROL_ACTIONS) {
      expect(roleCan('VIEWER', action), action).toBe(action === 'VIEW_BOT_CONTROL')
    }
  })

  it('maps every role an account can hold', () => {
    // Phase H added OWNER and BOT_MANAGER to the enum; the exhaustive switch is what made the
    // compiler point at that mapping and at nothing else.
    expect(roleFromAccount('OWNER')).toBe('OWNER')
    expect(roleFromAccount('ADMIN')).toBe('ADMIN')
    expect(roleFromAccount('BOT_MANAGER')).toBe('BOT_MANAGER')
    expect(roleFromAccount('AGENT')).toBe('AGENT')
  })

  it('permits a null session nothing at all', () => {
    for (const action of BOT_CONTROL_ACTIONS) {
      expect(sessionCan(null, action), action).toBe(false)
    }
  })

  it('resolves a session through the matrix', () => {
    const admin = { accountId: 'a', role: 'ADMIN' as const, tokenVersion: 0 }
    const agent = { accountId: 'b', role: 'AGENT' as const, tokenVersion: 0 }
    expect(sessionCan(admin, 'EDIT_RULE_DRAFT')).toBe(true)
    expect(sessionCan(agent, 'EDIT_RULE_DRAFT')).toBe(false)
  })

  it('lets a BOT_MANAGER write every kind of draft and approve none of them', () => {
    // The separation of duties the review step exists to create, now actually enforceable.
    for (const action of ['EDIT_RULE_DRAFT', 'EDIT_KNOWLEDGE_DRAFT', 'EDIT_FLOW_CONFIG'] as const) {
      expect(roleCan('BOT_MANAGER', action), action).toBe(true)
    }
    for (const action of ['APPROVE', 'PUBLISH', 'ROLLBACK', 'OVERRIDE_FAILED_TEST'] as const) {
      expect(roleCan('BOT_MANAGER', action), action).toBe(false)
    }
  })

  it('gives OWNER everything ADMIN has, plus the test override', () => {
    for (const action of BOT_CONTROL_ACTIONS) {
      if (roleCan('ADMIN', action)) expect(roleCan('OWNER', action), action).toBe(true)
    }
    expect(roleCan('OWNER', 'OVERRIDE_FAILED_TEST')).toBe(true)
    expect(roleCan('ADMIN', 'OVERRIDE_FAILED_TEST')).toBe(false)
  })
})

describe('hasAdminPowers', () => {
  it('is true for OWNER as well as ADMIN', () => {
    // `role === 'ADMIN'` was a correct spelling of this question until Phase H and is now a
    // wrong one: an OWNER outranks an ADMIN everywhere, so a literal check would lock the most
    // privileged account out of settings, account management and every admin-only route.
    expect(hasAdminPowers('OWNER')).toBe(true)
    expect(hasAdminPowers('ADMIN')).toBe(true)
  })

  it('is false for the roles that do not administer the app', () => {
    expect(hasAdminPowers('BOT_MANAGER')).toBe(false)
    expect(hasAdminPowers('AGENT')).toBe(false)
    expect(hasAdminPowers(null)).toBe(false)
    expect(hasAdminPowers(undefined)).toBe(false)
  })
})

describe('roleNameCan', () => {
  it('resolves a bare role name through the matrix', () => {
    // Client components know the role from /api/session and hold no SessionPayload; without
    // this they fall back to admin-equality, and a BOT_MANAGER sees a page with no controls.
    expect(roleNameCan('BOT_MANAGER', 'EDIT_RULE_DRAFT')).toBe(true)
    expect(roleNameCan('BOT_MANAGER', 'APPROVE')).toBe(false)
  })

  it('permits nothing for a role that is not known yet', () => {
    expect(roleNameCan(null, 'VIEW_BOT_CONTROL')).toBe(false)
    expect(roleNameCan(undefined, 'EDIT_RULE_DRAFT')).toBe(false)
  })
})