/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { listBotRules } from './rule-registry'
import { validateRuleDraft, ruleEditSurface, RULE_CONFIG_SPECS } from './rule-config'

describe('editable boundary', () => {
  it('locks exactly the rules the SDD says must stay locked', () => {
    // These are safety boundaries, not UI hints: flipping one from a web form would break a
    // promise made to customers or would require code changes to mean anything at all.
    const locked = [
      'bot.no_invented_price',
      'bot.no_invented_url',
      'bot.booking_context_first',
      'bot.rate_limit',
      'bot.burst_debounce',
    ]
    for (const key of locked) {
      expect(listBotRules().find((r) => r.key === key)?.editable, key).toBe(false)
      expect(validateRuleDraft(key, { enabled: false }).ok, key).toBe(false)
      expect(ruleEditSurface(key), key).toBeNull()
    }
  })

  it('opens exactly the rules the SDD says may be edited', () => {
    const open = [
      'channel.unofficial_outbound_default',
      'channel.official_reserved_for_capabilities',
      'bot.handoff_on_human_request',
      'bot.skip_indonesian_numbers',
    ]
    for (const key of open) {
      expect(listBotRules().find((r) => r.key === key)?.editable, key).toBe(true)
      expect(ruleEditSurface(key), key).not.toBeNull()
    }
  })

  it('gives every editable rule a config spec, so none falls through to "no schema"', () => {
    for (const rule of listBotRules().filter((r) => r.editable)) {
      expect(RULE_CONFIG_SPECS[rule.key], rule.key).toBeDefined()
    }
  })

  it('refuses a rule that is not in the registry at all', () => {
    const result = validateRuleDraft('bot.tidak_ada', { enabled: true })
    expect(result.ok).toBe(false)
  })
})

describe('validateRuleDraft', () => {
  it('accepts a valid channel default', () => {
    const result = validateRuleDraft('channel.unofficial_outbound_default', {
      enabled: true,
      config: { liveDefaultChannel: 'OFFICIAL' },
    })
    expect(result).toEqual({ ok: true, enabled: true, config: { liveDefaultChannel: 'OFFICIAL' } })
  })

  it('rejects a channel value outside the enum', () => {
    const result = validateRuleDraft('channel.unofficial_outbound_default', {
      enabled: true,
      config: { liveDefaultChannel: 'TELEGRAM' },
    })
    expect(result.ok).toBe(false)
  })

  it('rejects an unknown config key instead of storing it and ignoring it', () => {
    // A stored key that does nothing is indistinguishable, from the UI, from one that works.
    const result = validateRuleDraft('channel.unofficial_outbound_default', {
      enabled: true,
      config: { liveDefaultChannel: 'UNOFFICIAL', policyDefaultChannel: 'OFFICIAL' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('policyDefaultChannel')
  })

  it('refuses to switch off a rule whose enabled flag is not editable', () => {
    // CLAUDE.md's channel policy is not something a web form may repeal — only reconfigure.
    const result = validateRuleDraft('channel.unofficial_outbound_default', {
      enabled: false,
      config: { liveDefaultChannel: 'UNOFFICIAL' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('dinyalakan atau dimatikan')
  })

  it('allows toggling the rules whose whole edit surface is on/off', () => {
    expect(validateRuleDraft('bot.handoff_on_human_request', { enabled: false }).ok).toBe(true)
    expect(validateRuleDraft('bot.skip_indonesian_numbers', { enabled: true }).ok).toBe(true)
  })

  it('rejects any config on a rule whose surface is on/off only', () => {
    const result = validateRuleDraft('bot.handoff_on_human_request', { enabled: false, config: { apa: 'saja' } })
    expect(result.ok).toBe(false)
  })
})
