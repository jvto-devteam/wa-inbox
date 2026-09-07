/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { DEFAULT_CHANNEL_POLICY_KEY } from '@/lib/bot-control/channel-policy-config'
import { getPausedProviders, isProviderPaused, pauseProvider, resumeProvider } from './provider-pause'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  mockPrisma.channelPolicySetting.findUnique.mockResolvedValue({ pausedProviders: [] } as never)
  mockPrisma.channelPolicySetting.update.mockResolvedValue({ id: 'cp_1' } as never)
})

describe('getPausedProviders', () => {
  it('reads the shared row, not a process-local flag', async () => {
    // A module variable would pause the process that received the request and nothing else, and
    // would be cleared by a redeploy — the one control whose whole point is to be trusted.
    await getPausedProviders()
    expect(mockPrisma.channelPolicySetting.findUnique.mock.calls[0][0]?.where).toEqual({
      key: DEFAULT_CHANNEL_POLICY_KEY,
    })
  })

  it('is NOT cached, so a pause takes effect immediately', async () => {
    // Every other loader caches for thirty seconds; a thirty-second delay on an emergency stop
    // is not a performance win.
    await getPausedProviders()
    await getPausedProviders()
    expect(mockPrisma.channelPolicySetting.findUnique).toHaveBeenCalledTimes(2)
  })

  it('fails OPEN when the row cannot be read', async () => {
    // A database blip must not silently halt every outbound message in the account.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.channelPolicySetting.findUnique.mockRejectedValue(new Error('db down'))
    expect(await getPausedProviders()).toEqual([])
  })

  it('ignores stored values that are not real providers', async () => {
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue({
      pausedProviders: ['COEXIST', 'TELEGRAM', 42],
    } as never)
    expect(await getPausedProviders()).toEqual(['COEXIST'])
  })

  it('treats a non-array stored value as nothing paused', async () => {
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue({ pausedProviders: 'COEXIST' } as never)
    expect(await getPausedProviders()).toEqual([])
  })
})

describe('pauseProvider / resumeProvider', () => {
  it('adds and removes one provider without disturbing the other', async () => {
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue({ pausedProviders: ['META'] } as never)
    expect(await pauseProvider('COEXIST')).toEqual(['META', 'COEXIST'])

    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue({ pausedProviders: ['META', 'COEXIST'] } as never)
    expect(await resumeProvider('META')).toEqual(['COEXIST'])
  })

  it('writes nothing when the state already matches', async () => {
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue({ pausedProviders: ['COEXIST'] } as never)
    await pauseProvider('COEXIST')
    expect(mockPrisma.channelPolicySetting.update).not.toHaveBeenCalled()

    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue({ pausedProviders: [] } as never)
    await resumeProvider('COEXIST')
    expect(mockPrisma.channelPolicySetting.update).not.toHaveBeenCalled()
  })
})

describe('isProviderPaused', () => {
  it('answers per provider', async () => {
    mockPrisma.channelPolicySetting.findUnique.mockResolvedValue({ pausedProviders: ['COEXIST'] } as never)
    expect(await isProviderPaused('COEXIST')).toBe(true)
    expect(await isProviderPaused('META')).toBe(false)
  })
})
