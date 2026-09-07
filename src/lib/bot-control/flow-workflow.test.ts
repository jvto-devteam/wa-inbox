/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { writeBotAuditLog } from '@/lib/bot-control/audit'
import { EXISTING_BOT_FLOW_KEY } from './existing-flow-registry'
import {
  saveFlowDraft,
  transitionFlow,
  FlowNotEditableError,
  FlowNotFoundError,
  FlowTransitionError,
} from './flow-workflow'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/bot-control/audit', () => ({ writeBotAuditLog: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const actor = { id: 'acc_1', name: 'Budi' }
const REASON = 'Kalimat fallback lama terdengar menyalahkan customer'
const CONFIG = { fallbackReply: 'Saya cek dulu ya.' }

function definition(overrides: Record<string, unknown> = {}) {
  return {
    id: 'flow_1',
    key: EXISTING_BOT_FLOW_KEY,
    editableLevel: 'SAFE_CONFIG',
    status: 'PUBLISHED',
    ...overrides,
  } as never
}

function version(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ver_1',
    flowId: 'flow_1',
    version: 1,
    status: 'DRAFT',
    nodeConfig: CONFIG,
    changeReason: null,
    ...overrides,
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(writeBotAuditLog).mockResolvedValue('audit_1')
  mockPrisma.botFlowDefinition.findUnique.mockResolvedValue(definition())
  mockPrisma.botFlowVersion.findFirst.mockResolvedValue(null as never)
  mockPrisma.botFlowVersion.create.mockResolvedValue(version())
  mockPrisma.botFlowVersion.update.mockResolvedValue(version())
})

describe('saveFlowDraft', () => {
  it('creates version 1 when the flow has only ever run on code values', async () => {
    const result = await saveFlowDraft(EXISTING_BOT_FLOW_KEY, { config: CONFIG, reason: REASON }, actor)
    expect(mockPrisma.botFlowVersion.create.mock.calls[0][0].data).toMatchObject({ version: 1, status: 'DRAFT' })
    expect(result.version).toBe(1)
  })

  it('edits the pending version in place rather than bumping the number on every typo', async () => {
    mockPrisma.botFlowVersion.findFirst.mockResolvedValue(version({ status: 'DRAFT' }))
    await saveFlowDraft(EXISTING_BOT_FLOW_KEY, { config: CONFIG, reason: REASON }, actor)
    expect(mockPrisma.botFlowVersion.update).toHaveBeenCalled()
    expect(mockPrisma.botFlowVersion.create).not.toHaveBeenCalled()
  })

  it('creates a NEW version when the latest is published', async () => {
    // Editing a published version would change the past: a release snapshot naming it would
    // describe a configuration the bot never actually ran.
    mockPrisma.botFlowVersion.findFirst.mockResolvedValue(version({ status: 'PUBLISHED', version: 3 }))
    await saveFlowDraft(EXISTING_BOT_FLOW_KEY, { config: CONFIG, reason: REASON }, actor)
    expect(mockPrisma.botFlowVersion.create.mock.calls[0][0].data).toMatchObject({ version: 4, status: 'DRAFT' })
  })

  it('sends an already-APPROVED version back to DRAFT when it is edited', async () => {
    mockPrisma.botFlowVersion.findFirst.mockResolvedValue(version({ status: 'APPROVED' }))
    await saveFlowDraft(EXISTING_BOT_FLOW_KEY, { config: CONFIG, reason: REASON }, actor)
    expect(mockPrisma.botFlowVersion.update.mock.calls[0][0].data).toMatchObject({
      status: 'DRAFT',
      reviewedBy: null,
      reviewedAt: null,
    })
  })

  it('refuses a READ_ONLY flow', async () => {
    mockPrisma.botFlowDefinition.findUnique.mockResolvedValue(definition({ editableLevel: 'READ_ONLY' }))
    await expect(
      saveFlowDraft(EXISTING_BOT_FLOW_KEY, { config: CONFIG, reason: REASON }, actor)
    ).rejects.toBeInstanceOf(FlowNotEditableError)
    expect(mockPrisma.botFlowVersion.create).not.toHaveBeenCalled()
  })

  it('refuses a field the level does not permit', async () => {
    mockPrisma.botFlowDefinition.findUnique.mockResolvedValue(definition({ editableLevel: 'TEXT_ONLY' }))
    await expect(
      saveFlowDraft(EXISTING_BOT_FLOW_KEY, { config: { maxClarificationAttempts: 3 }, reason: REASON }, actor)
    ).rejects.toBeInstanceOf(FlowNotEditableError)
  })

  it('refuses branching config outright', async () => {
    // Branching is `if` statements in the orchestrator. Editing it from a form would mean
    // building an interpreter for it.
    await expect(
      saveFlowDraft(EXISTING_BOT_FLOW_KEY, { config: { edgeConfig: [{ from: 'a', to: 'b' }] }, reason: REASON }, actor)
    ).rejects.toBeInstanceOf(FlowNotEditableError)
  })

  it('refuses a key the registry does not implement, even with a row present', async () => {
    await expect(saveFlowDraft('flow-hantu', { config: CONFIG, reason: REASON }, actor)).rejects.toBeInstanceOf(
      FlowNotFoundError
    )
    expect(mockPrisma.botFlowDefinition.findUnique).not.toHaveBeenCalled()
  })

  it('refuses a flow with no definition row', async () => {
    mockPrisma.botFlowDefinition.findUnique.mockResolvedValue(null as never)
    await expect(
      saveFlowDraft(EXISTING_BOT_FLOW_KEY, { config: CONFIG, reason: REASON }, actor)
    ).rejects.toBeInstanceOf(FlowNotFoundError)
  })

  it('refuses an archived flow', async () => {
    mockPrisma.botFlowDefinition.findUnique.mockResolvedValue(definition({ status: 'ARCHIVED' }))
    await expect(
      saveFlowDraft(EXISTING_BOT_FLOW_KEY, { config: CONFIG, reason: REASON }, actor)
    ).rejects.toBeInstanceOf(FlowNotEditableError)
  })

  it('audits the change with its reason', async () => {
    await saveFlowDraft(EXISTING_BOT_FLOW_KEY, { config: CONFIG, reason: REASON }, actor)
    expect(writeBotAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE_DRAFT', entityType: 'FLOW', reason: REASON })
    )
  })
})

describe('transitionFlow', () => {
  it('sends a draft to review', async () => {
    mockPrisma.botFlowVersion.findFirst.mockResolvedValue(version({ status: 'DRAFT' }))
    mockPrisma.botFlowVersion.update.mockResolvedValue(version({ status: 'REVIEW' }))

    await transitionFlow(EXISTING_BOT_FLOW_KEY, 'REVIEW', actor, null)
    expect(writeBotAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'REQUEST_REVIEW' }))
  })

  it('records who reviewed it, and when, on approve', async () => {
    mockPrisma.botFlowVersion.findFirst.mockResolvedValue(version({ status: 'REVIEW' }))
    mockPrisma.botFlowVersion.update.mockResolvedValue(version({ status: 'APPROVED' }))

    await transitionFlow(EXISTING_BOT_FLOW_KEY, 'APPROVE', actor, null)
    expect(mockPrisma.botFlowVersion.update.mock.calls[0][0].data).toMatchObject({
      status: 'APPROVED',
      reviewedBy: 'acc_1',
    })
  })

  it('approves only from REVIEW', async () => {
    mockPrisma.botFlowVersion.findFirst.mockResolvedValue(version({ status: 'DRAFT' }))
    await expect(transitionFlow(EXISTING_BOT_FLOW_KEY, 'APPROVE', actor, null)).rejects.toBeInstanceOf(
      FlowTransitionError
    )
  })

  it('KEEPS a rejected version, which usually explains the current wording', async () => {
    mockPrisma.botFlowVersion.findFirst.mockResolvedValue(version({ status: 'REVIEW' }))
    mockPrisma.botFlowVersion.update.mockResolvedValue(version({ status: 'REJECTED' }))

    await transitionFlow(EXISTING_BOT_FLOW_KEY, 'REJECT', actor, 'Terlalu formal untuk customer kami')

    const data = mockPrisma.botFlowVersion.update.mock.calls[0][0].data
    expect(data).toMatchObject({ status: 'REJECTED' })
    expect(data).not.toHaveProperty('nodeConfig')
  })

  it('refuses a flow with no version at all', async () => {
    await expect(transitionFlow(EXISTING_BOT_FLOW_KEY, 'REVIEW', actor, null)).rejects.toBeInstanceOf(
      FlowNotFoundError
    )
  })
})
