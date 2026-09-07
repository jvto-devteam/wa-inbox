/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { writeBotAuditLog } from '@/lib/bot-control/audit'
import { EXISTING_FLOWS, EXISTING_BOT_FLOW_KEY } from './existing-flow-registry'
import { seedBotFlowDefinitions } from './flow-seed'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/bot-control/audit', () => ({ writeBotAuditLog: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function inSync() {
  const flow = EXISTING_FLOWS[0]
  return {
    id: 'flow_1',
    key: flow.key,
    name: flow.name,
    description: flow.description,
    category: 'WhatsApp',
    editableLevel: 'SAFE_CONFIG',
    activeVersionId: 'ver_9',
    runtimeSource: 'database',
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(writeBotAuditLog).mockResolvedValue('audit_1')
  mockPrisma.botFlowDefinition.findUnique.mockResolvedValue(null as never)
  mockPrisma.botFlowDefinition.create.mockResolvedValue({ id: 'flow_1' } as never)
  mockPrisma.botFlowDefinition.update.mockResolvedValue({ id: 'flow_1' } as never)
})

describe('seedBotFlowDefinitions', () => {
  it('creates a row for every flow in the registry', async () => {
    const result = await seedBotFlowDefinitions()
    expect(result.created).toBe(EXISTING_FLOWS.length)
  })

  it('opens the existing WhatsApp bot at SAFE_CONFIG', async () => {
    await seedBotFlowDefinitions()
    const data = mockPrisma.botFlowDefinition.create.mock.calls[0][0].data
    expect(data).toMatchObject({ key: EXISTING_BOT_FLOW_KEY, editableLevel: 'SAFE_CONFIG', runtimeSource: 'code' })
  })

  it('starts at runtimeSource "code", because nothing has been published yet', async () => {
    // Saying "database" before anything is published is a lie the loader would repeat.
    await seedBotFlowDefinitions()
    expect(mockPrisma.botFlowDefinition.create.mock.calls[0][0].data.runtimeSource).toBe('code')
  })

  it('leaves a seeded row alone on re-run', async () => {
    mockPrisma.botFlowDefinition.findUnique.mockResolvedValue(inSync())
    const result = await seedBotFlowDefinitions()
    expect(result).toMatchObject({ created: 0, updated: 0, unchanged: EXISTING_FLOWS.length })
  })

  it('never touches activeVersionId or runtimeSource on an existing row', async () => {
    // Those are what an operator published; a routine seed that reverted them would be an
    // unattributed rollback.
    mockPrisma.botFlowDefinition.findUnique.mockResolvedValue({
      ...(inSync() as unknown as Record<string, unknown>),
      name: 'Nama lama',
    } as never)

    await seedBotFlowDefinitions()
    const data = mockPrisma.botFlowDefinition.update.mock.calls[0][0].data
    expect(data).not.toHaveProperty('activeVersionId')
    expect(data).not.toHaveProperty('runtimeSource')
    expect(data).not.toHaveProperty('status')
  })

  it('re-asserts editableLevel, so a stale one cannot unlock a restricted flow', async () => {
    // A stale FLOW_BUILDER_V1 would offer controls the runtime does not honour.
    mockPrisma.botFlowDefinition.findUnique.mockResolvedValue({
      ...(inSync() as unknown as Record<string, unknown>),
      editableLevel: 'FLOW_BUILDER_V1',
    } as never)

    await seedBotFlowDefinitions()
    expect(mockPrisma.botFlowDefinition.update.mock.calls[0][0].data).toMatchObject({ editableLevel: 'SAFE_CONFIG' })
  })

  it('audits every created row as `system`', async () => {
    await seedBotFlowDefinitions()
    expect(writeBotAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE_DRAFT', entityType: 'FLOW', actorId: 'system' })
    )
  })
})
