/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getPausedProviders, isProviderPaused, pauseProvider, resumeProvider } from './provider-pause'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  mockPrisma.settings.findUnique.mockResolvedValue({ pausedProviders: [] } as never)
  mockPrisma.settings.update.mockResolvedValue({ id: 1 } as never)
})

describe('getPausedProviders', () => {
  it('reads the shared row, not a process-local flag', async () => {
    // A module variable would pause the process that received the request and nothing else, and
    // would be cleared by a redeploy — the one control whose whole point is to be trusted.
    await getPausedProviders()
    expect(mockPrisma.settings.findUnique.mock.calls[0][0]?.where).toEqual({ id: 1 })
  })

  it('is NOT cached, so a pause takes effect immediately', async () => {
    // Every other loader caches for thirty seconds; a thirty-second delay on an emergency stop
    // is not a performance win.
    await getPausedProviders()
    await getPausedProviders()
    expect(mockPrisma.settings.findUnique).toHaveBeenCalledTimes(2)
  })

  it('fails OPEN when the row cannot be read', async () => {
    // A database blip must not silently halt every outbound message in the account.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.settings.findUnique.mockRejectedValue(new Error('db down'))
    expect(await getPausedProviders()).toEqual([])
  })

  it('ignores stored values that are not real providers', async () => {
    mockPrisma.settings.findUnique.mockResolvedValue({
      pausedProviders: ['COEXIST', 'TELEGRAM', 42],
    } as never)
    expect(await getPausedProviders()).toEqual(['COEXIST'])
  })

  it('treats a non-array stored value as nothing paused', async () => {
    mockPrisma.settings.findUnique.mockResolvedValue({ pausedProviders: 'COEXIST' } as never)
    expect(await getPausedProviders()).toEqual([])
  })
})

describe('pauseProvider / resumeProvider', () => {
  it('adds and removes one provider without disturbing the other', async () => {
    mockPrisma.settings.findUnique.mockResolvedValue({ pausedProviders: ['META'] } as never)
    expect(await pauseProvider('COEXIST')).toEqual(['META', 'COEXIST'])

    mockPrisma.settings.findUnique.mockResolvedValue({ pausedProviders: ['META', 'COEXIST'] } as never)
    expect(await resumeProvider('META')).toEqual(['COEXIST'])
  })

  it('berlaku langsung: menulis kolomnya sendiri, tanpa draft dan tanpa publish', async () => {
    // The whole reason this is not part of any saved configuration object. A pause used to sit
    // next to a policy row that had a draft → approve → publish cycle, and the danger was never
    // the cycle itself — it was that publishing an unrelated knowledge change rewrote that row
    // and could lift a pause somebody set mid-incident. One column, one write, live at once.
    mockPrisma.settings.findUnique.mockResolvedValue({ pausedProviders: [] } as never)

    await pauseProvider('COEXIST')

    expect(mockPrisma.settings.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { pausedProviders: ['COEXIST'] },
    })
  })

  it('writes nothing when the state already matches', async () => {
    mockPrisma.settings.findUnique.mockResolvedValue({ pausedProviders: ['COEXIST'] } as never)
    await pauseProvider('COEXIST')
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()

    mockPrisma.settings.findUnique.mockResolvedValue({ pausedProviders: [] } as never)
    await resumeProvider('COEXIST')
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })
})

describe('isProviderPaused', () => {
  it('answers per provider', async () => {
    mockPrisma.settings.findUnique.mockResolvedValue({ pausedProviders: ['COEXIST'] } as never)
    expect(await isProviderPaused('COEXIST')).toBe(true)
    expect(await isProviderPaused('META')).toBe(false)
  })
})
