/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { writeBotAuditLog } from '@/lib/bot-control/audit'
import {
  saveRuleDraft,
  transitionRule,
  RuleNotEditableError,
  RuleNotFoundError,
  RuleTransitionError,
} from './rule-workflow'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/bot-control/audit', () => ({ writeBotAuditLog: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const actor = { id: 'acc_1', name: 'Budi' }
const REASON = 'Menjaga outbound harian tetap lewat coexistence'

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'brs_1',
    key: 'bot.handoff_on_human_request',
    status: 'PUBLISHED',
    enabled: true,
    config: null,
    draftEnabled: null,
    draftConfig: null,
    draftUpdatedAt: null,
    draftUpdatedBy: null,
    ...overrides,
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(writeBotAuditLog).mockResolvedValue('audit_1')
  mockPrisma.botRuleSetting.findUnique.mockResolvedValue(row())
  mockPrisma.botRuleSetting.update.mockResolvedValue(row({ status: 'DRAFT', draftEnabled: false }))
})

describe('saveRuleDraft', () => {
  it('writes only the draft columns, never the live ones', async () => {
    // "A draft has not changed the bot's behaviour" has to be a property of the data, not
    // something every reader remembers.
    await saveRuleDraft('bot.handoff_on_human_request', { enabled: false, reason: REASON }, actor)

    const data = mockPrisma.botRuleSetting.update.mock.calls[0][0].data
    expect(data).toMatchObject({ status: 'DRAFT', draftEnabled: false, draftUpdatedBy: 'acc_1' })
    expect(data).not.toHaveProperty('enabled')
    expect(data).not.toHaveProperty('config')
  })

  it('refuses a rule the registry has locked', async () => {
    mockPrisma.botRuleSetting.findUnique.mockResolvedValue(row({ key: 'bot.no_invented_price' }))

    await expect(
      saveRuleDraft('bot.no_invented_price', { enabled: false, reason: REASON }, actor)
    ).rejects.toBeInstanceOf(RuleNotEditableError)
    expect(mockPrisma.botRuleSetting.update).not.toHaveBeenCalled()
  })

  it('refuses a rule the database has but the registry does not', async () => {
    mockPrisma.botRuleSetting.findUnique.mockResolvedValue(row({ key: 'bot.aturan_hantu' }))

    await expect(
      saveRuleDraft('bot.aturan_hantu', { enabled: false, reason: REASON }, actor)
    ).rejects.toBeInstanceOf(RuleNotEditableError)
  })

  it('refuses a key with no row at all', async () => {
    mockPrisma.botRuleSetting.findUnique.mockResolvedValue(null as never)
    await expect(
      saveRuleDraft('bot.handoff_on_human_request', { enabled: false, reason: REASON }, actor)
    ).rejects.toBeInstanceOf(RuleNotFoundError)
  })

  it('rejects an invalid config rather than storing it', async () => {
    mockPrisma.botRuleSetting.findUnique.mockResolvedValue(row({ key: 'channel.unofficial_outbound_default' }))

    await expect(
      saveRuleDraft(
        'channel.unofficial_outbound_default',
        { enabled: true, config: { liveDefaultChannel: 'TELEGRAM' }, reason: REASON },
        actor
      )
    ).rejects.toBeInstanceOf(RuleNotEditableError)
  })

  it('sends an already-APPROVED draft back to DRAFT when it is edited again', async () => {
    // Approval was given for particular values; carrying it across to different ones publishes
    // something nobody reviewed.
    mockPrisma.botRuleSetting.findUnique.mockResolvedValue(
      row({ status: 'APPROVED', draftEnabled: false, draftUpdatedAt: new Date() })
    )

    await saveRuleDraft('bot.handoff_on_human_request', { enabled: true, reason: REASON }, actor)
    expect(mockPrisma.botRuleSetting.update.mock.calls[0][0].data.status).toBe('DRAFT')
  })

  it('audits a first draft as CREATE_DRAFT and a later one as UPDATE_DRAFT', async () => {
    await saveRuleDraft('bot.handoff_on_human_request', { enabled: false, reason: REASON }, actor)
    expect(writeBotAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE_DRAFT', entityKey: 'bot.handoff_on_human_request', reason: REASON })
    )

    mockPrisma.botRuleSetting.findUnique.mockResolvedValue(row({ status: 'DRAFT', draftUpdatedAt: new Date() }))
    await saveRuleDraft('bot.handoff_on_human_request', { enabled: true, reason: REASON }, actor)
    expect(writeBotAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE_DRAFT' }))
  })
})

describe('transitionRule', () => {
  it('sends a DRAFT to REVIEW', async () => {
    mockPrisma.botRuleSetting.findUnique.mockResolvedValue(row({ status: 'DRAFT', draftUpdatedAt: new Date() }))
    mockPrisma.botRuleSetting.update.mockResolvedValue(row({ status: 'REVIEW' }))

    await transitionRule('bot.handoff_on_human_request', 'REVIEW', actor, null)
    expect(mockPrisma.botRuleSetting.update.mock.calls[0][0].data).toMatchObject({ status: 'REVIEW' })
    expect(writeBotAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'REQUEST_REVIEW' }))
  })

  it('approves only from REVIEW', async () => {
    // Approving something nobody sent to review would make the review step optional.
    mockPrisma.botRuleSetting.findUnique.mockResolvedValue(row({ status: 'DRAFT', draftUpdatedAt: new Date() }))
    await expect(
      transitionRule('bot.handoff_on_human_request', 'APPROVE', actor, null)
    ).rejects.toBeInstanceOf(RuleTransitionError)

    mockPrisma.botRuleSetting.findUnique.mockResolvedValue(row({ status: 'REVIEW', draftUpdatedAt: new Date() }))
    mockPrisma.botRuleSetting.update.mockResolvedValue(row({ status: 'APPROVED' }))
    await transitionRule('bot.handoff_on_human_request', 'APPROVE', actor, null)
    expect(writeBotAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'APPROVE' }))
  })

  it('refuses to review or approve a rule with no draft', async () => {
    // Letting an empty draft through would publish the values already live, as though a change
    // had been made.
    mockPrisma.botRuleSetting.findUnique.mockResolvedValue(row({ status: 'DRAFT', draftUpdatedAt: null }))
    await expect(
      transitionRule('bot.handoff_on_human_request', 'REVIEW', actor, null)
    ).rejects.toThrow('belum punya draft')
  })

  it('discards the draft outright on reject', async () => {
    // Keeping a rejected draft invites somebody to approve it later without re-reading why it
    // was rejected.
    mockPrisma.botRuleSetting.findUnique.mockResolvedValue(row({ status: 'REVIEW', draftUpdatedAt: new Date() }))
    mockPrisma.botRuleSetting.update.mockResolvedValue(row({ status: 'REJECTED' }))

    await transitionRule('bot.handoff_on_human_request', 'REJECT', actor, 'Tidak sesuai kebijakan channel')

    expect(mockPrisma.botRuleSetting.update.mock.calls[0][0].data).toMatchObject({
      status: 'REJECTED',
      draftEnabled: null,
      draftConfig: Prisma.DbNull,
      draftUpdatedAt: null,
      draftUpdatedBy: null,
    })
  })

  it('refuses to re-review an already APPROVED draft', async () => {
    mockPrisma.botRuleSetting.findUnique.mockResolvedValue(row({ status: 'APPROVED', draftUpdatedAt: new Date() }))
    await expect(
      transitionRule('bot.handoff_on_human_request', 'REVIEW', actor, null)
    ).rejects.toBeInstanceOf(RuleTransitionError)
  })

  it('refuses any transition on a key with no row', async () => {
    mockPrisma.botRuleSetting.findUnique.mockResolvedValue(null as never)
    await expect(
      transitionRule('bot.handoff_on_human_request', 'APPROVE', actor, null)
    ).rejects.toBeInstanceOf(RuleNotFoundError)
  })
})
