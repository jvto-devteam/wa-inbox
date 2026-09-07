/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { writeBotAuditLog } from '@/lib/bot-control/audit'
import { DEFAULT_CHANNEL_POLICY, DEFAULT_CHANNEL_POLICY_KEY } from './channel-policy-config'
import {
  seedChannelPolicy,
  getChannelPolicyState,
  saveChannelPolicyDraft,
  transitionChannelPolicy,
  PolicyInvalidError,
  PolicyNotFoundError,
  PolicyTransitionError,
} from './channel-policy-workflow'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/bot-control/audit', () => ({ writeBotAuditLog: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const actor = { id: 'acc_1', name: 'Budi' }
const REASON = 'Provider unofficial sedang bermasalah sepanjang pagi'

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cp_1',
    key: DEFAULT_CHANNEL_POLICY_KEY,
    defaultOutbound: 'UNOFFICIAL',
    officialMode: 'INBOUND_AND_CAPABILITY',
    unofficialMode: 'PRIMARY_OUTBOUND',
    capabilityRules: DEFAULT_CHANNEL_POLICY.capabilityRules,
    safetyConfig: DEFAULT_CHANNEL_POLICY.safetyConfig,
    status: 'PUBLISHED',
    draftConfig: null,
    draftUpdatedAt: null,
    ...overrides,
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(writeBotAuditLog).mockResolvedValue('audit_1')
  mockPrisma.channelPolicySetting.findUnique.mockResolvedValue(row())
  mockPrisma.channelPolicySetting.create.mockResolvedValue({ id: 'cp_1' } as never)
  mockPrisma.channelPolicySetting.update.mockResolvedValue(row())
})

describe('seedChannelPolicy', () => {
  it('creates the SDD default row when nothing exists', async () => {
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue(null as never)

    expect(await seedChannelPolicy()).toEqual({ created: true })
    expect(mockPrisma.channelPolicySetting.create.mock.calls[0][0].data).toMatchObject({
      key: DEFAULT_CHANNEL_POLICY_KEY,
      defaultOutbound: 'UNOFFICIAL',
      status: 'PUBLISHED',
    })
  })

  it('never overwrites a policy somebody has already published', async () => {
    // A routine seed that reverted a published policy would be an unattributed rollback of the
    // single most consequential setting in the system.
    expect(await seedChannelPolicy()).toEqual({ created: false })
    expect(mockPrisma.channelPolicySetting.create).not.toHaveBeenCalled()
  })
})

describe('getChannelPolicyState', () => {
  it('reports the live policy and its warnings', async () => {
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue(row({ defaultOutbound: 'OFFICIAL' }))

    const state = await getChannelPolicyState()
    expect(state.active.defaultOutbound).toBe('OFFICIAL')
    expect(state.warnings.some((w) => w.includes('OFFICIAL'))).toBe(true)
  })

  it('warns about the DRAFT when there is one, not about what is live', async () => {
    // The warnings describe whatever the operator is about to ship.
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue(
      row({ draftConfig: { ...DEFAULT_CHANNEL_POLICY, defaultOutbound: 'OFFICIAL' } })
    )

    const state = await getChannelPolicyState()
    expect(state.active.defaultOutbound).toBe('UNOFFICIAL')
    expect(state.draft?.defaultOutbound).toBe('OFFICIAL')
    expect(state.warnings.some((w) => w.includes('OFFICIAL'))).toBe(true)
  })

  it('refuses when the row has not been seeded', async () => {
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue(null as never)
    await expect(getChannelPolicyState()).rejects.toBeInstanceOf(PolicyNotFoundError)
  })
})

describe('saveChannelPolicyDraft', () => {
  it('writes only the draft column, never the live ones', async () => {
    // "A draft has not changed the send path" has to be a property of the data.
    await saveChannelPolicyDraft({ config: DEFAULT_CHANNEL_POLICY, reason: REASON }, actor)

    const data = mockPrisma.channelPolicySetting.update.mock.calls[0][0].data
    expect(data).toMatchObject({ status: 'DRAFT', draftUpdatedBy: 'acc_1' })
    expect(data).not.toHaveProperty('defaultOutbound')
    expect(data).not.toHaveProperty('safetyConfig')
  })

  it('refuses a config that would disable a safety gate', async () => {
    await expect(
      saveChannelPolicyDraft(
        {
          config: {
            ...DEFAULT_CHANNEL_POLICY,
            safetyConfig: { ...DEFAULT_CHANNEL_POLICY.safetyConfig, campaignRatePerMinute: 0 },
          },
          reason: REASON,
        },
        actor
      )
    ).rejects.toBeInstanceOf(PolicyInvalidError)
    expect(mockPrisma.channelPolicySetting.update).not.toHaveBeenCalled()
  })

  it('sends an already-APPROVED policy back to DRAFT when it is edited', async () => {
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue(
      row({ status: 'APPROVED', draftConfig: DEFAULT_CHANNEL_POLICY, draftUpdatedAt: new Date() })
    )

    await saveChannelPolicyDraft({ config: DEFAULT_CHANNEL_POLICY, reason: REASON }, actor)
    expect(mockPrisma.channelPolicySetting.update.mock.calls[0][0].data.status).toBe('DRAFT')
  })
})

describe('transitionChannelPolicy', () => {
  it('sends a draft to review', async () => {
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue(
      row({ status: 'DRAFT', draftConfig: DEFAULT_CHANNEL_POLICY, draftUpdatedAt: new Date() })
    )

    await transitionChannelPolicy('REVIEW', actor, null)
    expect(writeBotAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REQUEST_REVIEW', entityType: 'CHANNEL_POLICY' })
    )
  })

  it('approves only from REVIEW', async () => {
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue(
      row({ status: 'DRAFT', draftConfig: DEFAULT_CHANNEL_POLICY })
    )
    await expect(transitionChannelPolicy('APPROVE', actor, null)).rejects.toBeInstanceOf(PolicyTransitionError)
  })

  it('refuses to review a DRAFT row that carries no draft config', async () => {
    // Letting an empty draft through would publish the values already live, as though a change
    // had been made. (A PUBLISHED row is refused one step earlier, by the status check.)
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue(row({ status: 'DRAFT', draftConfig: null }))
    await expect(transitionChannelPolicy('REVIEW', actor, null)).rejects.toThrow('Belum ada draft')
  })

  it('refuses to review straight from PUBLISHED', async () => {
    await expect(transitionChannelPolicy('REVIEW', actor, null)).rejects.toBeInstanceOf(PolicyTransitionError)
  })

  it('discards the draft outright on reject', async () => {
    // A handful of settings, not written prose: keeping a rejected one invites somebody to
    // approve it later without re-reading why it was refused.
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue(
      row({ status: 'REVIEW', draftConfig: DEFAULT_CHANNEL_POLICY })
    )

    await transitionChannelPolicy('REJECT', actor, 'Terlalu berisiko untuk sekarang')
    expect(mockPrisma.channelPolicySetting.update.mock.calls[0][0].data).toMatchObject({
      status: 'REJECTED',
      draftConfig: Prisma.DbNull,
      draftUpdatedAt: null,
    })
  })
})
