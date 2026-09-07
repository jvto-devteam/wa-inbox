/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { DEFAULT_CHANNEL_POLICY, DEFAULT_CHANNEL_POLICY_KEY } from './channel-policy-config'
import {
  getChannelPolicy,
  getSafetyConfig,
  invalidateChannelPolicyCache,
  CHANNEL_POLICY_CACHE_TTL_MS,
} from './runtime-channel-policy'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function row(overrides: Record<string, unknown> = {}) {
  return {
    defaultOutbound: 'UNOFFICIAL',
    officialMode: 'INBOUND_AND_CAPABILITY',
    unofficialMode: 'PRIMARY_OUTBOUND',
    capabilityRules: DEFAULT_CHANNEL_POLICY.capabilityRules,
    safetyConfig: DEFAULT_CHANNEL_POLICY.safetyConfig,
    ...overrides,
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  invalidateChannelPolicyCache()
  mockPrisma.channelPolicySetting.findUnique.mockResolvedValue(row())
})

describe('getChannelPolicy', () => {
  it('reads the seeded row', async () => {
    const policy = await getChannelPolicy()
    expect(policy.source).toBe('database')
    expect(policy.defaultOutbound).toBe('UNOFFICIAL')
    expect(mockPrisma.channelPolicySetting.findUnique.mock.calls[0][0]?.where).toEqual({
      key: DEFAULT_CHANNEL_POLICY_KEY,
    })
  })

  it('serves the code default when nothing is seeded', async () => {
    // No row is the un-seeded state, not "no policy" — reading it as data would leave the send
    // path with no default channel at all.
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue(null as never)

    const policy = await getChannelPolicy()
    expect(policy.source).toBe('code')
    expect(policy.defaultOutbound).toBe('UNOFFICIAL')
  })

  it('falls back rather than throwing when the database is unreachable', async () => {
    // This sits in front of EVERY send: a throw would stop delivery for the whole account.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.channelPolicySetting.findUnique.mockRejectedValue(new Error('db down'))

    expect((await getChannelPolicy()).source).toBe('code')
  })

  it('falls back on a stored shape it cannot read', async () => {
    // A policy that cannot be parsed must not be able to silently disable the duplicate guard.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue(row({ safetyConfig: { bentuk: 'asing' } }))

    const policy = await getChannelPolicy()
    expect(policy.source).toBe('code')
    expect(policy.safetyConfig).toEqual(DEFAULT_CHANNEL_POLICY.safetyConfig)
  })

  it('does not cache a failure, so recovery is immediate', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.channelPolicySetting.findUnique.mockRejectedValueOnce(new Error('db down'))
    await getChannelPolicy()

    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue(row())
    expect((await getChannelPolicy()).source).toBe('database')
  })

  it('serves the cache within the TTL and refetches after it', async () => {
    const start = 1_000_000
    await getChannelPolicy(start)
    await getChannelPolicy(start + CHANNEL_POLICY_CACHE_TTL_MS - 1)
    expect(mockPrisma.channelPolicySetting.findUnique).toHaveBeenCalledTimes(1)

    await getChannelPolicy(start + CHANNEL_POLICY_CACHE_TTL_MS + 1)
    expect(mockPrisma.channelPolicySetting.findUnique).toHaveBeenCalledTimes(2)
  })

  it('refetches immediately once invalidated', async () => {
    const start = 1_000_000
    await getChannelPolicy(start)
    invalidateChannelPolicyCache()
    await getChannelPolicy(start)
    expect(mockPrisma.channelPolicySetting.findUnique).toHaveBeenCalledTimes(2)
  })

  it('carries a published OFFICIAL default through', async () => {
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue(row({ defaultOutbound: 'OFFICIAL' }))
    expect((await getChannelPolicy()).defaultOutbound).toBe('OFFICIAL')
  })
})

describe('getSafetyConfig', () => {
  it('returns the published numbers', async () => {
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue(
      row({ safetyConfig: { ...DEFAULT_CHANNEL_POLICY.safetyConfig, campaignRatePerMinute: 40 } })
    )
    expect((await getSafetyConfig()).campaignRatePerMinute).toBe(40)
  })

  it('returns the code defaults when nothing is published', async () => {
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue(null as never)
    expect(await getSafetyConfig()).toEqual(DEFAULT_CHANNEL_POLICY.safetyConfig)
  })
})
