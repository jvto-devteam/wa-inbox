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

  it('opens exactly the rules that have a runtime consumer', () => {
    const open = ['bot.handoff_on_human_request', 'bot.skip_indonesian_numbers']
    for (const key of open) {
      expect(listBotRules().find((r) => r.key === key)?.editable, key).toBe(true)
      expect(ruleEditSurface(key), key).not.toBeNull()
    }
  })

  it('mengunci dua rule Channel Policy yang tidak punya pembaca (regresi Temuan 3)', () => {
    // Keduanya dulu `editable: true` dengan permukaan edit yang menulis baris yang tidak
    // dibaca siapa pun: `liveDefaultChannel` ditimpa ChannelPolicySetting.defaultOutbound
    // sebelum sempat berarti, dan toggle kapabilitas Official tidak punya pembaca sama sekali.
    // Sekarang perilakunya benar-benar ditegakkan dari halaman Channel Policy.
    for (const key of ['channel.unofficial_outbound_default', 'channel.official_reserved_for_capabilities']) {
      const rule = listBotRules().find((r) => r.key === key)
      expect(rule?.editable, key).toBe(false)
      expect(ruleEditSurface(key), key).toBeNull()
      expect(validateRuleDraft(key, { enabled: true }).ok, key).toBe(false)
      // Operator harus tahu ke mana perginya, bukan cuma melihat gembok.
      expect(rule?.managedIn?.href, key).toBe('/bot-control/channel-policy')
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
  it('rejects an unknown config key instead of storing it and ignoring it', () => {
    // A stored key that does nothing is indistinguishable, from the UI, from one that works.
    const result = validateRuleDraft('bot.handoff_on_human_request', {
      enabled: true,
      config: { adaKunciAsing: true },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('adaKunciAsing')
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
