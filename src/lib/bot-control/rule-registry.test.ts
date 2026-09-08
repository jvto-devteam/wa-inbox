/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { BOT_RULES, getBotRule, listBotRules, listRuleCategories } from './rule-registry'

// The ten rules the guidebook (section 9) makes mandatory, with the severity it specifies for
// each and the Settings column (if any) that switches it. Written out independently of the
// registry so a rule that silently loses its CRITICAL severity — or, worse, quietly acquires a
// switch — fails here.
type Required = { key: string; severity: string; category: string; settingsKey?: string }
const REQUIRED_RULES: Required[] = [
  { key: 'channel.official_inbound_only', severity: 'CRITICAL', category: 'Channel Policy' },
  // Default jalur kirim diatur di Pengaturan (Settings.defaultChannel, dibaca resolveChannel);
  // rute per-kemampuan adalah matriks statis di channel-capabilities.ts. Tidak satu pun dari
  // halaman Rules.
  { key: 'channel.unofficial_outbound_default', severity: 'CRITICAL', category: 'Channel Policy' },
  { key: 'channel.official_reserved_for_capabilities', severity: 'HIGH', category: 'Channel Policy' },
  { key: 'bot.no_invented_price', severity: 'CRITICAL', category: 'Safety' },
  { key: 'bot.no_invented_url', severity: 'CRITICAL', category: 'Safety' },
  {
    key: 'bot.handoff_on_human_request',
    severity: 'HIGH',
    category: 'Handoff',
    settingsKey: 'handoffOnHumanRequest',
  },
  { key: 'bot.booking_context_first', severity: 'HIGH', category: 'Decision' },
  {
    key: 'bot.skip_indonesian_numbers',
    severity: 'NORMAL',
    category: 'Market Policy',
    settingsKey: 'skipBotForIndonesianNumbers',
  },
  { key: 'bot.burst_debounce', severity: 'NORMAL', category: 'Delivery Quality' },
  { key: 'bot.rate_limit', severity: 'HIGH', category: 'Abuse Protection' },
]

describe('rule registry', () => {
  it('contains all ten mandatory rules, in the mandated order', () => {
    expect(BOT_RULES.map((r) => r.key)).toEqual(REQUIRED_RULES.map((r) => r.key))
  })

  it('gives each rule the mandated severity, category and switch', () => {
    for (const required of REQUIRED_RULES) {
      const rule = getBotRule(required.key)
      expect(rule, required.key).not.toBeNull()
      expect(rule?.severity, `${required.key} severity`).toBe(required.severity)
      expect(rule?.category, `${required.key} category`).toBe(required.category)
      expect(rule?.settingsKey, `${required.key} settingsKey`).toBe(required.settingsKey)
    }
  })

  it('gives exactly two rules a switch, and no others', () => {
    // The count is the assertion. Eight of these rules are hardcoded behaviour; a ninth
    // `settingsKey` appearing means somebody wired a column to a rule the code does not
    // actually consult, which is the "the UI says it is off but it is on" bug this file's
    // whole shape exists to prevent.
    expect(BOT_RULES.filter((r) => r.settingsKey !== undefined).map((r) => r.key)).toEqual([
      'bot.handoff_on_human_request',
      'bot.skip_indonesian_numbers',
    ])
  })

  it('keeps the two anti-fabrication safety rules unswitchable', () => {
    // These two are the promise the bot makes to a customer who is about to pay money. A
    // future refactor that gives either one a settings column — exposing a switch that lets an
    // operator turn off price/URL verification — must not pass review silently.
    for (const key of ['bot.no_invented_price', 'bot.no_invented_url']) {
      const rule = getBotRule(key)
      expect(rule?.settingsKey, key).toBeUndefined()
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

  it('points every rule an operator cannot change at the page that does control it', () => {
    // "Terkunci" on its own sends an operator hunting for a button that does not exist. A rule
    // with neither a switch nor a `managedIn` is code-enforced and says so; one that IS managed
    // elsewhere has to name where.
    expect(getBotRule('channel.unofficial_outbound_default')?.managedIn?.href).toBe('/settings')
    // And the capability rule points nowhere on purpose: which channel carries a template is a
    // static fact about the provider's API (channel-capabilities.ts), not a form an operator can
    // open. Naming a page for it would be inventing a key nobody holds.
    expect(getBotRule('channel.official_reserved_for_capabilities')?.managedIn).toBeUndefined()
  })

  it('never gives one rule both a switch and another page that manages it', () => {
    // Two writers for one behaviour is how the old rule layer went wrong: whichever wrote last
    // won, and the page showed the other one.
    for (const rule of BOT_RULES) {
      expect(rule.settingsKey !== undefined && rule.managedIn !== undefined, rule.key).toBe(false)
    }
  })
})

describe('listBotRules', () => {
  it('returns copies, so a caller cannot mutate the shared registry', () => {
    // The Rules page layers each rule's live Settings state onto these objects. On a
    // long-lived server a mutation would leak into every later request.
    const first = listBotRules()
    first[0].name = 'diubah'
    expect(listBotRules()[0].name).not.toBe('diubah')
    expect(BOT_RULES[0].name).not.toBe('diubah')
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
