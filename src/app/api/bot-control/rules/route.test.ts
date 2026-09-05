/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const withCookie = new Request('http://localhost/api/bot-control/rules', {
  headers: { cookie: 'wa_inbox_session=tok' },
})

type RuleBody = {
  key: string
  enabled: boolean
  editable: boolean
  sourceFile: string
  config?: Record<string, unknown>
  liveStateUnavailable?: true
}

function settingsRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    defaultChannel: 'UNOFFICIAL',
    workingHoursStart: null,
    workingHoursEnd: null,
    offHoursAutoReply: null,
    botAutoReplyAll: true,
    skipBotForIndonesianNumbers: false,
    catalogSyncedAt: null,
    ollamaModel: 'gemma4:31b-cloud',
    ...overrides,
  } as never
}

async function rulesFrom(res: Response): Promise<RuleBody[]> {
  return (await res.json()).rules
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.settings.findUnique.mockResolvedValue(settingsRow())
})

describe('GET /api/bot-control/rules', () => {
  it('returns all ten rules under a `rules` key', async () => {
    const res = await GET(withCookie)
    expect(res.status).toBe(200)
    expect(await rulesFrom(res)).toHaveLength(10)
  })

  it('lets an AGENT read it', async () => {
    expect((await GET(withCookie)).status).toBe(200)
  })

  it('rejects a request with no session as 401 and the mandated { error } shape', async () => {
    const res = await GET(new Request('http://localhost/api/bot-control/rules'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Tidak terautentikasi' })
  })

  it('reports the Indonesian-number filter as ON when the settings row says it is on', async () => {
    // The registry's static default is `false`. Serving that while the filter is actually
    // running would tell an operator the bot replies to +62 numbers when it does not — the
    // exact lie this page exists to prevent.
    mockPrisma.settings.findUnique.mockResolvedValue(settingsRow({ skipBotForIndonesianNumbers: true }))

    const rule = (await rulesFrom(await GET(withCookie))).find((r) => r.key === 'bot.skip_indonesian_numbers')
    expect(rule?.enabled).toBe(true)
  })

  it('reports it as OFF when the settings row says it is off', async () => {
    const rule = (await rulesFrom(await GET(withCookie))).find((r) => r.key === 'bot.skip_indonesian_numbers')
    expect(rule?.enabled).toBe(false)
  })

  it('surfaces the configured default channel alongside the policy default, without overwriting it', async () => {
    // The two can genuinely disagree — the schema's column default is OFFICIAL while the
    // written policy is UNOFFICIAL — and that disagreement is the finding, not a glitch to
    // paper over.
    mockPrisma.settings.findUnique.mockResolvedValue(settingsRow({ defaultChannel: 'OFFICIAL' }))

    const rule = (await rulesFrom(await GET(withCookie))).find((r) => r.key === 'channel.unofficial_outbound_default')
    expect(rule?.config).toEqual({ policyDefaultChannel: 'UNOFFICIAL', configuredDefaultChannel: 'OFFICIAL' })
  })

  it('leaves code-enforced rules untouched by the settings row', async () => {
    mockPrisma.settings.findUnique.mockResolvedValue(settingsRow({ botAutoReplyAll: false }))

    const rules = await rulesFrom(await GET(withCookie))
    const priceRule = rules.find((r) => r.key === 'bot.no_invented_price')
    expect(priceRule?.enabled).toBe(true)
    expect(priceRule).not.toHaveProperty('liveStateUnavailable')
  })

  it('still returns every rule, flagged, when the settings row cannot be read', async () => {
    // Losing the whole rule list because one column read failed is far worse than a list that
    // is honest about which state it could not confirm.
    mockPrisma.settings.findUnique.mockRejectedValue(new Error('db down'))

    const rules = await rulesFrom(await GET(withCookie))
    expect(rules).toHaveLength(10)
    expect(rules.find((r) => r.key === 'bot.skip_indonesian_numbers')?.liveStateUnavailable).toBe(true)
    // A rule that never depended on settings is not flagged — the failure is scoped to what
    // actually became unknown.
    expect(rules.find((r) => r.key === 'bot.rate_limit')).not.toHaveProperty('liveStateUnavailable')
  })

  it('returns no settings row at all as unavailable rather than as "off"', async () => {
    mockPrisma.settings.findUnique.mockResolvedValue(null)

    const rules = await rulesFrom(await GET(withCookie))
    expect(rules.find((r) => r.key === 'bot.skip_indonesian_numbers')?.liveStateUnavailable).toBe(true)
  })

  it('never returns a rule whose source file field is missing', async () => {
    // Sebuah aturan tanpa sumber tidak bisa dicek ulang oleh siapa pun — itu klaim tanpa bukti.
    for (const rule of await rulesFrom(await GET(withCookie))) {
      expect(rule.sourceFile, rule.key).toBeTruthy()
    }
  })
})
