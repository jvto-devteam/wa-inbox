/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { writeBotAuditLog } from '@/lib/bot-control/audit'
import { listBotRules } from './rule-registry'
import { seedBotRuleSettings, SEED_ACTOR_ID } from './rule-seed'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/bot-control/audit', () => ({ writeBotAuditLog: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

/** A stored row that already matches the registry entry for `key`. */
function inSync(key: string) {
  const rule = listBotRules().find((r) => r.key === key)
  if (!rule) throw new Error(`unknown rule ${key}`)
  return {
    id: `brs_${key}`,
    key,
    name: rule.name,
    category: rule.category,
    description: rule.description,
    severity: rule.severity,
    editable: rule.editable,
    enabled: rule.enabled,
    config: rule.config ?? null,
    status: 'PUBLISHED',
    draftUpdatedAt: null,
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(writeBotAuditLog).mockResolvedValue('audit_1')
  mockPrisma.botRuleSetting.findUnique.mockResolvedValue(null as never)
  mockPrisma.botRuleSetting.create.mockResolvedValue({ id: 'brs_1' } as never)
  mockPrisma.botRuleSetting.update.mockResolvedValue({ id: 'brs_1' } as never)
})

describe('seedBotRuleSettings', () => {
  it('creates a row for every rule in the registry', async () => {
    const result = await seedBotRuleSettings()
    expect(result.created).toBe(listBotRules().length)
    expect(result.updated).toBe(0)
  })

  it('starts each row saying exactly what the code already does', async () => {
    // A baseline that differed from live behaviour would be a change nobody asked for,
    // published by a seed script.
    await seedBotRuleSettings()

    const priceRule = mockPrisma.botRuleSetting.create.mock.calls
      .map(([args]) => args.data)
      .find((data) => data.key === 'bot.no_invented_price')
    expect(priceRule).toMatchObject({ enabled: true, editable: false, status: 'PUBLISHED', runtimeSource: 'code' })
  })

  it('audits every created row as `system`', async () => {
    // The seed is the first thing that ever writes these rows; without this their earliest
    // history would read as though they had always been that way.
    await seedBotRuleSettings()

    expect(writeBotAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE_DRAFT', entityType: 'RULE', actorId: SEED_ACTOR_ID })
    )
    expect(vi.mocked(writeBotAuditLog).mock.calls).toHaveLength(listBotRules().length)
  })

  it('leaves a customised row alone on re-run', async () => {
    // Re-running must never revert an operator's published change back to the code default —
    // that would make a routine seed a silent, unattributed rollback.
    mockPrisma.botRuleSetting.findUnique.mockImplementation((args) => inSync(args.where.key as string))

    const result = await seedBotRuleSettings()
    expect(result.created).toBe(0)
    expect(result.unchanged).toBe(listBotRules().length)
    expect(mockPrisma.botRuleSetting.update).not.toHaveBeenCalled()
  })

  it('never overwrites config or enabled on an existing row', async () => {
    // The operator's state is theirs; only the registry's metadata is re-asserted.
    mockPrisma.botRuleSetting.findUnique.mockImplementation((args) => ({
      ...(inSync(args.where.key as string) as unknown as Record<string, unknown>),
      name: 'Nama lama yang berubah',
      enabled: false,
      config: { dikustom: true },
    }) as never)

    await seedBotRuleSettings()

    for (const [args] of mockPrisma.botRuleSetting.update.mock.calls) {
      expect(args.data).not.toHaveProperty('enabled')
      expect(args.data).not.toHaveProperty('config')
      expect(args.data).not.toHaveProperty('status')
    }
  })

  it('re-asserts editable from the registry, so a stale true cannot unlock a rule', async () => {
    // A stored `editable: true` on a rule the code has since locked would make it look
    // changeable in the UI.
    mockPrisma.botRuleSetting.findUnique.mockImplementation((args) => ({
      ...(inSync(args.where.key as string) as unknown as Record<string, unknown>),
      editable: true,
    }) as never)

    await seedBotRuleSettings()

    const priceUpdate = mockPrisma.botRuleSetting.update.mock.calls
      .find(([args]) => args.where.key === 'bot.no_invented_price')?.[0]
    expect(priceUpdate?.data).toMatchObject({ editable: false })
  })

  it('audits a metadata sync as UPDATE_DRAFT', async () => {
    mockPrisma.botRuleSetting.findUnique.mockImplementation((args) => ({
      ...(inSync(args.where.key as string) as unknown as Record<string, unknown>),
      description: 'Deskripsi lama',
    }) as never)

    await seedBotRuleSettings()
    expect(writeBotAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE_DRAFT' }))
  })
})
