/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { BOT_RULES, getBotRule, listBotRules, listRuleCategories } from './rule-registry'

// The ten rules the guidebook (section 9) makes mandatory, with the severity and editability it
// specifies for each. Written out independently of the registry so a rule that silently loses
// its CRITICAL severity — or, worse, becomes editable — fails here.
const REQUIRED_RULES: Array<{ key: string; severity: string; editable: boolean; category: string }> = [
  { key: 'channel.official_inbound_only', severity: 'CRITICAL', editable: false, category: 'Channel Policy' },
  { key: 'channel.unofficial_outbound_default', severity: 'CRITICAL', editable: true, category: 'Channel Policy' },
  { key: 'channel.official_reserved_for_capabilities', severity: 'HIGH', editable: true, category: 'Channel Policy' },
  { key: 'bot.no_invented_price', severity: 'CRITICAL', editable: false, category: 'Safety' },
  { key: 'bot.no_invented_url', severity: 'CRITICAL', editable: false, category: 'Safety' },
  { key: 'bot.handoff_on_human_request', severity: 'HIGH', editable: true, category: 'Handoff' },
  { key: 'bot.booking_context_first', severity: 'HIGH', editable: false, category: 'Decision' },
  { key: 'bot.skip_indonesian_numbers', severity: 'NORMAL', editable: true, category: 'Market Policy' },
  { key: 'bot.burst_debounce', severity: 'NORMAL', editable: false, category: 'Delivery Quality' },
  { key: 'bot.rate_limit', severity: 'HIGH', editable: false, category: 'Abuse Protection' },
]

describe('rule registry', () => {
  it('contains all ten mandatory rules, in the mandated order', () => {
    expect(BOT_RULES.map((r) => r.key)).toEqual(REQUIRED_RULES.map((r) => r.key))
  })

  it('gives each rule the mandated severity, editability and category', () => {
    for (const required of REQUIRED_RULES) {
      const rule = getBotRule(required.key)
      expect(rule, required.key).not.toBeNull()
      expect(rule?.severity, `${required.key} severity`).toBe(required.severity)
      expect(rule?.editable, `${required.key} editable`).toBe(required.editable)
      expect(rule?.category, `${required.key} category`).toBe(required.category)
    }
  })

  it('keeps the two anti-fabrication safety rules permanently locked', () => {
    // These two are the promise the bot makes to a customer who is about to pay money. A
    // future refactor that flips either to editable — exposing a toggle that lets an operator
    // turn off price/URL verification from a web form — must not pass review silently.
    for (const key of ['bot.no_invented_price', 'bot.no_invented_url']) {
      const rule = getBotRule(key)
      expect(rule?.editable, key).toBe(false)
      expect(rule?.enabled, key).toBe(true)
      expect(rule?.severity, key).toBe('CRITICAL')
    }
  })

  it('gives every rule a description and a source file that really exists', () => {
    const repoRoot = path.resolve(__dirname, '../../..')
    for (const rule of BOT_RULES) {
      expect(rule.description.length, `${rule.key} description`).toBeGreaterThan(40)
      expect(existsSync(path.join(repoRoot, rule.sourceFile)), `${rule.key} -> ${rule.sourceFile}`).toBe(true)
    }
  })

  it('has no duplicate keys', () => {
    expect(new Set(BOT_RULES.map((r) => r.key)).size).toBe(BOT_RULES.length)
  })

  it('marks a settings-backed rule so the API knows to read its live state', () => {
    // Without this pointer the Rules page would show the static default and tell an operator
    // the Indonesian-number filter is off while it is actually on.
    expect(getBotRule('bot.skip_indonesian_numbers')?.enabledFromSettingsKey).toBe('skipBotForIndonesianNumbers')
    expect(getBotRule('channel.unofficial_outbound_default')?.configFromSettingsKey).toBe('defaultChannel')
  })

  it('never points a code-enforced rule at a settings column', () => {
    // A rule with no settings key is enforced unconditionally, so claiming it is disabled
    // would be false. Enforced here rather than trusted.
    for (const rule of BOT_RULES) {
      if (rule.enabledFromSettingsKey === undefined) {
        expect(rule.enabled, `${rule.key} enabled`).toBe(true)
      }
    }
  })
})

describe('listBotRules', () => {
  it('returns copies, so a caller cannot mutate the shared registry', () => {
    // The route layers live Settings values onto these objects. On a long-lived server a
    // mutation would leak into every later request.
    const first = listBotRules()
    first[0].enabled = false
    expect(listBotRules()[0].enabled).toBe(true)
    expect(BOT_RULES[0].enabled).toBe(true)
  })
})

describe('listRuleCategories', () => {
  it('returns each category once, in first-appearance order', () => {
    expect(listRuleCategories()).toEqual([
      'Channel Policy',
      'Safety',
      'Handoff',
      'Decision',
      'Market Policy',
      'Delivery Quality',
      'Abuse Protection',
    ])
  })
})

describe('getBotRule', () => {
  it('returns null for an unknown key rather than throwing', () => {
    expect(getBotRule('nope')).toBeNull()
  })
})
