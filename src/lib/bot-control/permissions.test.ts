/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { hasAdminPowers } from './permissions'

describe('hasAdminPowers', () => {
  it('is true for OWNER as well as ADMIN', () => {
    // A literal `role === 'ADMIN'` would lock an OWNER — the only role that outranks ADMIN in
    // the enum — out of settings, account management and every admin-only route.
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
