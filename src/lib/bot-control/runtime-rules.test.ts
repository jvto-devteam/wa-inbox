/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { listBotRules } from './rule-registry'
import {
  getRuntimeRuleConfig,
  getRuntimeRule,
  isRuleEnabled,
  invalidateRuntimeRuleCache,
  RULE_CACHE_TTL_MS,
} from './runtime-rules'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  invalidateRuntimeRuleCache()
  mockPrisma.botRuleSetting.findMany.mockResolvedValue([] as never)
})

describe('getRuntimeRuleConfig', () => {
  it('falls back to the static registry when the database is unreachable', async () => {
    // The callers are resolveChannel, the orchestrator and the safety guard. A throw here does
    // not degrade the bot, it stops it — and a bot going silent because a CONFIGURATION lookup
    // failed is far worse than one running on last week's settings.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.botRuleSetting.findMany.mockRejectedValue(new Error('db down'))

    const config = await getRuntimeRuleConfig()
    expect(config.source).toBe('code')
    expect(Object.keys(config.rules)).toHaveLength(listBotRules().length)
  })

  it('does not cache the fallback, so recovery is immediate', async () => {
    // Caching a database blip would pin the process to static config for the next thirty
    // seconds after the database is already back.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.botRuleSetting.findMany.mockRejectedValueOnce(new Error('db down'))
    await getRuntimeRuleConfig()

    mockPrisma.botRuleSetting.findMany.mockResolvedValue([
      { key: 'bot.handoff_on_human_request', enabled: false, config: null },
    ] as never)
    expect((await getRuntimeRuleConfig()).source).toBe('database')
  })

  it('treats an empty table as un-seeded, not as "every rule is off"', async () => {
    // Reading emptiness as data would silently drop every rule the moment this shipped ahead
    // of its seed.
    const config = await getRuntimeRuleConfig()
    expect(config.source).toBe('code')
    expect(config.rules['bot.no_invented_price'].enabled).toBe(true)
  })

  it('lets a published row override enabled and config', async () => {
    mockPrisma.botRuleSetting.findMany.mockResolvedValue([
      { key: 'bot.handoff_on_human_request', enabled: false, config: { catatan: 'x' } },
    ] as never)

    const config = await getRuntimeRuleConfig()
    expect(config.source).toBe('database')
    expect(config.rules['bot.handoff_on_human_request'].enabled).toBe(false)
    expect(config.rules['bot.handoff_on_human_request'].config).toEqual({ catatan: 'x' })
  })

  it('reads only PUBLISHED rows, never a draft', async () => {
    await getRuntimeRuleConfig()
    expect(mockPrisma.botRuleSetting.findMany.mock.calls[0][0]?.where).toEqual({ status: 'PUBLISHED' })
  })

  it('ignores a stored row whose key the registry does not know', async () => {
    // That is a rule deleted from the code; honouring it would let the table resurrect
    // behaviour the code no longer implements.
    mockPrisma.botRuleSetting.findMany.mockResolvedValue([
      { key: 'bot.aturan_hantu', enabled: true, config: null },
    ] as never)

    expect((await getRuntimeRuleConfig()).rules['bot.aturan_hantu']).toBeUndefined()
  })

  it('keeps the registry config when a stored row has none', async () => {
    mockPrisma.botRuleSetting.findMany.mockResolvedValue([
      { key: 'channel.unofficial_outbound_default', enabled: true, config: null },
    ] as never)

    const rule = (await getRuntimeRuleConfig()).rules['channel.unofficial_outbound_default']
    expect(rule.config).toEqual({ policyDefaultChannel: 'UNOFFICIAL' })
  })

  it('never lets a stored row raise its own editable flag', async () => {
    // `editable` is a safety boundary. A database row that could unlock itself would make this
    // table a way around exactly the rules that were deliberately locked.
    mockPrisma.botRuleSetting.findMany.mockResolvedValue([
      { key: 'bot.no_invented_price', enabled: true, config: null },
    ] as never)

    expect((await getRuntimeRuleConfig()).rules['bot.no_invented_price'].editable).toBe(false)
  })

  it('serves the cache within the TTL and refetches after it', async () => {
    // resolveChannel runs on every send; without this the queue would put a database
    // round-trip in front of every outbound message, retries included.
    const start = 1_000_000
    await getRuntimeRuleConfig(start)
    await getRuntimeRuleConfig(start + RULE_CACHE_TTL_MS - 1)
    expect(mockPrisma.botRuleSetting.findMany).toHaveBeenCalledTimes(1)

    await getRuntimeRuleConfig(start + RULE_CACHE_TTL_MS + 1)
    expect(mockPrisma.botRuleSetting.findMany).toHaveBeenCalledTimes(2)
  })

  it('refetches immediately once the cache is invalidated', async () => {
    // What makes a publish visible while the operator is still looking at the screen.
    const start = 1_000_000
    await getRuntimeRuleConfig(start)
    invalidateRuntimeRuleCache()
    await getRuntimeRuleConfig(start)
    expect(mockPrisma.botRuleSetting.findMany).toHaveBeenCalledTimes(2)
  })
})

describe('getRuntimeRule and isRuleEnabled', () => {
  it('returns null for a key the registry does not have', async () => {
    expect(await getRuntimeRule('bot.tidak_ada')).toBeNull()
  })

  it('reports an unknown rule as ENABLED, failing to the safe side', async () => {
    // Every rule here is a restriction on the bot. An unrecognised key silently disabling one
    // would remove a safety property; staying restricted is the safe direction.
    expect(await isRuleEnabled('bot.tidak_ada')).toBe(true)
  })

  it('reports a stored disabled rule as off', async () => {
    mockPrisma.botRuleSetting.findMany.mockResolvedValue([
      { key: 'bot.skip_indonesian_numbers', enabled: false, config: null },
    ] as never)
    expect(await isRuleEnabled('bot.skip_indonesian_numbers')).toBe(false)
  })
})
