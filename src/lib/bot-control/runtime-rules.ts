/**
 * Reads the live rule configuration, for code that has to act on it.
 *
 * --- Fail open, always ---
 *
 * Every path through this module ends in a usable config. If the database is unreachable, if
 * the table is empty because the seed has never run, if a row holds a shape this build does
 * not understand — the answer is the static registry, logged, not an exception. The callers
 * are `resolveChannel`, the orchestrator and the safety guard: a throw here does not degrade
 * the bot, it stops it, and a bot that goes silent because a CONFIGURATION LOOKUP failed is a
 * far worse outcome than one running on last week's settings.
 *
 * That is also why the return type has no "unavailable" variant. A caller handed an optional
 * config would have to invent a fallback of its own, and three callers inventing three
 * fallbacks is how a system ends up with three different ideas of what the default channel is.
 * The fallback lives here, once. `source` says which one you got.
 *
 * --- Why it is cached, and why the cache is short ---
 *
 * `resolveChannel` runs on every single send. Without a cache this would put a database
 * round-trip in front of every outbound message, including the retry ladder's. Thirty seconds
 * (SDD Manage Second §18.1) is long enough to erase that cost and short enough that an
 * operator who publishes a release sees it take effect while they are still looking at the
 * screen — which matters, because a change that appears not to work gets published again.
 *
 * The cache is per-process and deliberately not shared. It holds no secrets, and a stale entry
 * in one Node process for at most thirty seconds is a smaller problem than a cache invalidation
 * protocol between processes.
 */
import { prisma } from '@/lib/db'
import { listBotRules, type BotRule } from '@/lib/bot-control/rule-registry'

/** SDD Manage Second §18.1: "cache pendek, misalnya 30-60 detik". */
export const RULE_CACHE_TTL_MS = 30_000

export type RuntimeRule = {
  key: string
  name: string
  category: string
  severity: string
  editable: boolean
  enabled: boolean
  config: Record<string, unknown>
}

export type RuntimeRuleConfig = {
  rules: Record<string, RuntimeRule>
  /** 'database' when published rows were read, 'code' when this is the static fallback. */
  source: 'database' | 'code'
  loadedAt: number
}

type CacheEntry = { value: RuntimeRuleConfig; expiresAt: number }
let cache: CacheEntry | null = null

/** Drops the cache. Called after a publish so an operator sees their change immediately. */
export function invalidateRuntimeRuleCache(): void {
  cache = null
}

function staticConfig(): RuntimeRuleConfig {
  const rules: Record<string, RuntimeRule> = {}
  for (const rule of listBotRules()) {
    rules[rule.key] = toRuntimeRule(rule, rule.enabled, rule.config ?? {})
  }
  return { rules, source: 'code', loadedAt: Date.now() }
}

function toRuntimeRule(rule: BotRule, enabled: boolean, config: Record<string, unknown>): RuntimeRule {
  return {
    key: rule.key,
    name: rule.name,
    category: rule.category,
    severity: rule.severity,
    editable: rule.editable,
    enabled,
    config,
  }
}

function asConfigRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/**
 * The live rule config, merged over the static registry.
 *
 * The registry is the base layer, not a last resort: it decides which rules EXIST and what
 * `editable` means for each. A published database row may override only `enabled` and
 * `config`. A database row whose key is not in the registry is ignored entirely — that is a
 * rule that was deleted from the code, and honouring it would let the table resurrect
 * behaviour the code no longer implements.
 */
export async function getRuntimeRuleConfig(now: number = Date.now()): Promise<RuntimeRuleConfig> {
  if (cache && cache.expiresAt > now) return cache.value

  const fallback = staticConfig()

  // The WHOLE body is guarded, not just the query. This module's contract is "never throws",
  // and a try that covers only the await leaves every line after it able to break a bot turn —
  // which is exactly what happened when `findMany` returned something other than an array and
  // `.length` threw straight through the decision path.
  try {
    const published = await prisma.botRuleSetting.findMany({
      where: { status: 'PUBLISHED' },
      select: { key: true, enabled: true, config: true },
    })

    // An empty table is the un-seeded state, not "every rule is off". Treating it as data would
    // silently drop every rule the moment this shipped ahead of its seed. A non-array is the
    // same situation seen through a broken client: fall back rather than guess.
    if (!Array.isArray(published) || published.length === 0) {
      cache = { value: fallback, expiresAt: now + RULE_CACHE_TTL_MS }
      return fallback
    }

    const rules = { ...fallback.rules }
    for (const row of published) {
      const base = rules[row.key]
      if (!base) continue
      const config = asConfigRecord(row.config)
      rules[row.key] = { ...base, enabled: row.enabled, config: config ?? base.config }
    }

    const value: RuntimeRuleConfig = { rules, source: 'database', loadedAt: now }
    cache = { value, expiresAt: now + RULE_CACHE_TTL_MS }
    return value
  } catch (error) {
    // Logged, not thrown, and NOT cached: a database blip must not pin the process to static
    // config for the next thirty seconds after the database comes back.
    console.error('getRuntimeRuleConfig: gagal membaca BotRuleSetting, memakai registry statis', { error })
    return fallback
  }
}

/** One rule, or null when the key is not in the registry. */
export async function getRuntimeRule(key: string): Promise<RuntimeRule | null> {
  return (await getRuntimeRuleConfig()).rules[key] ?? null
}

/**
 * Whether a rule is currently on.
 *
 * Defaults to TRUE for an unknown key rather than false. Every rule in this system is a
 * restriction on the bot ("may not invent a price", "hand off when asked for a human"), so an
 * unrecognised key silently disabling one would remove a safety property. Failing to the safe
 * side means staying restricted.
 */
export async function isRuleEnabled(key: string): Promise<boolean> {
  return (await getRuntimeRule(key))?.enabled ?? true
}
