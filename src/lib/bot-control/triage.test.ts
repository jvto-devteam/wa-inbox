/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { writeBotAuditLog } from '@/lib/bot-control/audit'
import { upsertTriage, DecisionNotFoundError, TriageForbiddenError, TRIAGE_ISSUE_TYPES } from './triage'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/bot-control/audit', () => ({ writeBotAuditLog: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const agent = { id: 'acc_agent', name: 'Budi', isAdmin: false }
const admin = { id: 'acc_admin', name: 'Admin Satu', isAdmin: true }

function triage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tri_1',
    decisionRunId: 'run_1',
    status: 'OPEN',
    issueType: null,
    severity: 'NORMAL',
    assignedTo: null,
    note: null,
    linkedEntityType: null,
    linkedEntityId: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(writeBotAuditLog).mockResolvedValue('audit_1')
  mockPrisma.botDecisionRun.findUnique.mockResolvedValue({ id: 'run_1' } as never)
  mockPrisma.botDecisionTriage.findUnique.mockResolvedValue(null as never)
  mockPrisma.botDecisionTriage.create.mockResolvedValue(triage())
  mockPrisma.botDecisionTriage.update.mockResolvedValue(triage())
})

describe('TRIAGE_ISSUE_TYPES', () => {
  it('carries exactly the eight the SDD lists', () => {
    // The filter dropdown and every writer read from this list; a silently-added ninth would be
    // unfilterable and effectively invisible.
    expect(TRIAGE_ISSUE_TYPES).toHaveLength(8)
    expect(TRIAGE_ISSUE_TYPES).toContain('KNOWLEDGE_GAP')
    expect(TRIAGE_ISSUE_TYPES).toContain('HALLUCINATION_BLOCKED')
  })
})

describe('upsertTriage', () => {
  it('creates one when the decision has none', async () => {
    await upsertTriage('run_1', { issueType: 'KNOWLEDGE_GAP' }, agent)
    expect(mockPrisma.botDecisionTriage.create).toHaveBeenCalled()
    expect(mockPrisma.botDecisionTriage.update).not.toHaveBeenCalled()
  })

  it('updates the existing one rather than making a second', async () => {
    // Two triages for one decision would make "has this been dealt with?" unanswerable, which
    // is the only thing the queue is for.
    mockPrisma.botDecisionTriage.findUnique.mockResolvedValue(triage())
    await upsertTriage('run_1', { note: 'sudah dicek' }, admin)
    expect(mockPrisma.botDecisionTriage.update).toHaveBeenCalled()
    expect(mockPrisma.botDecisionTriage.create).not.toHaveBeenCalled()
  })

  it('refuses a decision that does not exist', async () => {
    mockPrisma.botDecisionRun.findUnique.mockResolvedValue(null as never)
    await expect(upsertTriage('run_hantu', {}, agent)).rejects.toBeInstanceOf(DecisionNotFoundError)
  })

  it('lets an AGENT take the work themselves', async () => {
    // Taking a piece of work is not a claim about anyone else's time.
    await upsertTriage('run_1', { assignedTo: agent.id }, agent)
    expect(mockPrisma.botDecisionTriage.create.mock.calls[0][0].data).toMatchObject({
      assignedTo: 'acc_agent',
      status: 'ASSIGNED',
    })
  })

  it('refuses an AGENT assigning to somebody else', async () => {
    await expect(upsertTriage('run_1', { assignedTo: 'acc_lain' }, agent)).rejects.toBeInstanceOf(
      TriageForbiddenError
    )
    expect(mockPrisma.botDecisionTriage.create).not.toHaveBeenCalled()
  })

  it('refuses an AGENT closing a triage', async () => {
    // Declaring a customer-facing defect gone is a claim about whether it still exists.
    await expect(upsertTriage('run_1', { status: 'RESOLVED' }, agent)).rejects.toBeInstanceOf(TriageForbiddenError)
    await expect(upsertTriage('run_1', { status: 'IGNORED' }, agent)).rejects.toBeInstanceOf(TriageForbiddenError)
  })

  it('lets an ADMIN assign to anyone and close it', async () => {
    await upsertTriage('run_1', { assignedTo: 'acc_lain', status: 'RESOLVED' }, admin)
    expect(mockPrisma.botDecisionTriage.create.mock.calls[0][0].data).toMatchObject({
      assignedTo: 'acc_lain',
      status: 'RESOLVED',
    })
  })

  it('derives ASSIGNED from an assignment, so status cannot drift from the assignee column', async () => {
    // Otherwise every operator has to remember two clicks to express one intention.
    await upsertTriage('run_1', { assignedTo: agent.id }, agent)
    expect(mockPrisma.botDecisionTriage.create.mock.calls[0][0].data.status).toBe('ASSIGNED')
  })

  it('stamps who resolved it, and when', async () => {
    await upsertTriage('run_1', { status: 'RESOLVED' }, admin)
    const data = mockPrisma.botDecisionTriage.create.mock.calls[0][0].data
    expect(data.resolvedBy).toBe('acc_admin')
    expect(data.resolvedAt).toBeInstanceOf(Date)
  })

  it('clears the resolution when a triage is reopened', async () => {
    // A row saying "resolved by Budi" while sitting at OPEN is a row nobody can read.
    mockPrisma.botDecisionTriage.findUnique.mockResolvedValue(
      triage({ status: 'RESOLVED', resolvedBy: 'acc_admin', resolvedAt: new Date() })
    )

    await upsertTriage('run_1', { status: 'OPEN' }, admin)
    expect(mockPrisma.botDecisionTriage.update.mock.calls[0][0].data).toMatchObject({
      resolvedBy: null,
      resolvedAt: null,
    })
  })

  it('keeps the original resolver when an already-closed triage is edited', async () => {
    mockPrisma.botDecisionTriage.findUnique.mockResolvedValue(
      triage({ status: 'RESOLVED', resolvedBy: 'acc_pertama', resolvedAt: new Date('2026-09-01') })
    )

    await upsertTriage('run_1', { note: 'tambahan catatan' }, admin)
    expect(mockPrisma.botDecisionTriage.update.mock.calls[0][0].data.resolvedBy).toBe('acc_pertama')
  })

  it('leaves untouched fields alone rather than clearing them', async () => {
    // Omitting a field means "leave as is"; only an explicit null clears it.
    mockPrisma.botDecisionTriage.findUnique.mockResolvedValue(
      triage({ issueType: 'BAD_REPLY', note: 'catatan lama', severity: 'HIGH' })
    )

    await upsertTriage('run_1', { assignedTo: 'acc_lain' }, admin)
    expect(mockPrisma.botDecisionTriage.update.mock.calls[0][0].data).toMatchObject({
      issueType: 'BAD_REPLY',
      note: 'catatan lama',
      severity: 'HIGH',
    })
  })

  it('clears a field when null is sent explicitly', async () => {
    mockPrisma.botDecisionTriage.findUnique.mockResolvedValue(triage({ issueType: 'BAD_REPLY' }))
    await upsertTriage('run_1', { issueType: null }, admin)
    expect(mockPrisma.botDecisionTriage.update.mock.calls[0][0].data.issueType).toBeNull()
  })

  it('audits creation and update differently', async () => {
    await upsertTriage('run_1', { issueType: 'BAD_REPLY' }, agent)
    expect(writeBotAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE_DRAFT', entityType: 'DECISION_TRIAGE' })
    )

    mockPrisma.botDecisionTriage.findUnique.mockResolvedValue(triage())
    await upsertTriage('run_1', { note: 'x' }, agent)
    expect(writeBotAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE_DRAFT' }))
  })
})
