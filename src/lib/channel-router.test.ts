import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { DEFAULT_CHANNEL_POLICY } from '@/lib/bot-control/channel-policy-config'
import { invalidateChannelPolicyCache } from '@/lib/bot-control/runtime-channel-policy'
import { resolveChannel, channelForCapabilityPolicy, isCapabilityDisabled } from './channel-router'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function policyRow(overrides: Record<string, unknown> = {}) {
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
  // Un-seeded by default, so the pre-Phase-H behaviour is what the first tests exercise.
  mockPrisma.channelPolicySetting.findUnique.mockResolvedValue(null as never)
})

describe('resolveChannel', () => {
  it('returns the explicit channel unchanged when provided', async () => {
    // An agent who picked a channel by hand must not be overridden by a policy, or the picker
    // is a suggestion box.
    expect(await resolveChannel('UNOFFICIAL')).toBe('UNOFFICIAL')
    expect(await resolveChannel('OFFICIAL')).toBe('OFFICIAL')
    expect(mockPrisma.channelPolicySetting.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.settings.findUnique).not.toHaveBeenCalled()
  })

  it('falls back to Settings.defaultChannel when no policy is published', async () => {
    // The Settings page still writes that column; removing the fallback would silently strip a
    // control an operator already uses.
    mockPrisma.settings.findUnique.mockResolvedValue({ defaultChannel: 'OFFICIAL' } as never)
    expect(await resolveChannel()).toBe('OFFICIAL')
  })

  it('lets a published policy win over Settings', async () => {
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue(policyRow({ defaultOutbound: 'OFFICIAL' }))
    mockPrisma.settings.findUnique.mockResolvedValue({ defaultChannel: 'UNOFFICIAL' } as never)

    expect(await resolveChannel()).toBe('OFFICIAL')
    // Settings is not even consulted once a policy exists.
    expect(mockPrisma.settings.findUnique).not.toHaveBeenCalled()
  })

  it('still returns a channel when Settings cannot be read', async () => {
    // This runs on every outbound message: an exception here does not degrade delivery, it
    // stops it.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.settings.findUnique.mockRejectedValue(new Error('db down'))

    expect(await resolveChannel()).toBe('UNOFFICIAL')
  })

  it('still returns a channel when there is no Settings row at all', async () => {
    mockPrisma.settings.findUnique.mockResolvedValue(null as never)
    expect(await resolveChannel()).toBe('UNOFFICIAL')
  })
})

describe('channelForCapabilityPolicy', () => {
  it('routes a template to OFFICIAL and plain text to UNOFFICIAL, per the default policy', async () => {
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue(policyRow())
    expect(await channelForCapabilityPolicy('send_template')).toBe('OFFICIAL')
    expect(await channelForCapabilityPolicy('send_text')).toBe('UNOFFICIAL')
  })

  it('treats UNOFFICIAL_LIMITED as Unofficial, because "limited" is a rate concern', async () => {
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue(policyRow())
    expect(await channelForCapabilityPolicy('campaign')).toBe('UNOFFICIAL')
  })

  it('returns null for a disabled capability rather than a channel', async () => {
    // "Do not send this" is not a routing answer, and every caller here is already committed to
    // sending something.
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue(
      policyRow({ capabilityRules: { ...DEFAULT_CHANNEL_POLICY.capabilityRules, send_media: 'DISABLED' } })
    )
    expect(await channelForCapabilityPolicy('send_media')).toBeNull()
  })
})

describe('isCapabilityDisabled', () => {
  it('is false for everything under the default policy', async () => {
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue(policyRow())
    expect(await isCapabilityDisabled('send_text')).toBe(false)
  })

  it('is true once a capability is switched off', async () => {
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue(
      policyRow({ capabilityRules: { ...DEFAULT_CHANNEL_POLICY.capabilityRules, send_carousel: 'DISABLED' } })
    )
    expect(await isCapabilityDisabled('send_carousel')).toBe(true)
  })
})
