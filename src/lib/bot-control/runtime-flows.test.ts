/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { EXISTING_BOT_FLOW_KEY } from './existing-flow-registry'
import {
  getActiveFlowConfig,
  getRuntimeFlows,
  getFlowText,
  invalidateRuntimeFlowCache,
  FLOW_CACHE_TTL_MS,
} from './runtime-flows'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function definition(overrides: Record<string, unknown> = {}) {
  return {
    key: EXISTING_BOT_FLOW_KEY,
    name: 'WhatsApp Existing Bot',
    editableLevel: 'SAFE_CONFIG',
    activeVersionId: 'ver_1',
    versions: [{ id: 'ver_1', version: 2, nodeConfig: { fallbackReply: 'Saya cek dulu ya.' } }],
    ...overrides,
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  invalidateRuntimeFlowCache()
  mockPrisma.botFlowDefinition.findMany.mockResolvedValue([definition()] as never)
})

describe('getActiveFlowConfig', () => {
  it('layers a published version over the static registry', async () => {
    const flow = await getActiveFlowConfig(EXISTING_BOT_FLOW_KEY)
    expect(flow).toMatchObject({
      editableLevel: 'SAFE_CONFIG',
      activeVersion: 2,
      source: 'database',
      config: { fallbackReply: 'Saya cek dulu ya.' },
    })
  })

  it('reads only PUBLISHED versions, never a draft', async () => {
    // A draft reaching the bot is the failure this whole workflow exists to prevent.
    await getActiveFlowConfig(EXISTING_BOT_FLOW_KEY)
    const select = mockPrisma.botFlowDefinition.findMany.mock.calls[0][0]?.select
    expect(select?.versions).toMatchObject({ where: { status: 'PUBLISHED' } })
  })

  it('falls back to the code defaults when the database is unreachable', async () => {
    // A turn that dies because a CONFIGURATION lookup failed is far worse than one running on
    // last week's wording.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.botFlowDefinition.findMany.mockRejectedValue(new Error('db down'))

    const flow = await getActiveFlowConfig(EXISTING_BOT_FLOW_KEY)
    expect(flow).toMatchObject({ source: 'code', config: {}, activeVersion: null })
  })

  it('does not cache the fallback, so recovery is immediate', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.botFlowDefinition.findMany.mockRejectedValueOnce(new Error('db down'))
    await getActiveFlowConfig(EXISTING_BOT_FLOW_KEY)

    mockPrisma.botFlowDefinition.findMany.mockResolvedValue([definition()] as never)
    expect((await getActiveFlowConfig(EXISTING_BOT_FLOW_KEY))?.source).toBe('database')
  })

  it('defaults an unseeded flow to READ_ONLY, failing closed', async () => {
    // Opening a flow for editing has to be a deliberate act.
    mockPrisma.botFlowDefinition.findMany.mockResolvedValue([] as never)
    expect((await getActiveFlowConfig(EXISTING_BOT_FLOW_KEY))?.editableLevel).toBe('READ_ONLY')
  })

  it('returns null for a key the registry does not implement', async () => {
    // A database row must not conjure a flow into existence: its config would configure nothing.
    expect(await getActiveFlowConfig('flow-hantu')).toBeNull()
  })

  it('ignores a database row whose key the registry does not know', async () => {
    mockPrisma.botFlowDefinition.findMany.mockResolvedValue([definition({ key: 'flow-hantu' })] as never)
    const flows = await getRuntimeFlows()
    expect(flows.some((flow) => flow.key === 'flow-hantu')).toBe(false)
  })

  it('falls back to code values when the stored config is a shape it cannot read', async () => {
    mockPrisma.botFlowDefinition.findMany.mockResolvedValue([
      definition({ versions: [{ id: 'ver_1', version: 3, nodeConfig: { branchingRules: [] } }] }),
    ] as never)

    const flow = await getActiveFlowConfig(EXISTING_BOT_FLOW_KEY)
    expect(flow).toMatchObject({ source: 'code', config: {} })
  })

  it('serves the cache within the TTL and refetches after it', async () => {
    const start = 1_000_000
    await getActiveFlowConfig(EXISTING_BOT_FLOW_KEY, start)
    await getActiveFlowConfig(EXISTING_BOT_FLOW_KEY, start + FLOW_CACHE_TTL_MS - 1)
    expect(mockPrisma.botFlowDefinition.findMany).toHaveBeenCalledTimes(1)

    await getActiveFlowConfig(EXISTING_BOT_FLOW_KEY, start + FLOW_CACHE_TTL_MS + 1)
    expect(mockPrisma.botFlowDefinition.findMany).toHaveBeenCalledTimes(2)
  })

  it('refetches immediately once the cache is invalidated', async () => {
    const start = 1_000_000
    await getActiveFlowConfig(EXISTING_BOT_FLOW_KEY, start)
    invalidateRuntimeFlowCache()
    await getActiveFlowConfig(EXISTING_BOT_FLOW_KEY, start)
    expect(mockPrisma.botFlowDefinition.findMany).toHaveBeenCalledTimes(2)
  })
})

describe('getFlowText', () => {
  it('returns the published wording when there is one', async () => {
    expect(await getFlowText(EXISTING_BOT_FLOW_KEY, 'fallbackReply', 'bawaan')).toBe('Saya cek dulu ya.')
  })

  it('treats an empty override as absent, not as "say nothing"', async () => {
    // Clearing a box means "go back to the code's wording"; making an operator retype the
    // original sentence to revert is how a typo becomes permanent.
    mockPrisma.botFlowDefinition.findMany.mockResolvedValue([
      definition({ versions: [{ id: 'ver_1', version: 2, nodeConfig: { fallbackReply: '   ' } }] }),
    ] as never)

    expect(await getFlowText(EXISTING_BOT_FLOW_KEY, 'fallbackReply', 'bawaan')).toBe('bawaan')
  })

  it('returns the caller default for a flow that does not exist', async () => {
    expect(await getFlowText('flow-hantu', 'greetingText', 'bawaan')).toBe('bawaan')
  })
})
