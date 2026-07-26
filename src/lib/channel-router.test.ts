import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { resolveChannel } from './channel-router'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
})

describe('resolveChannel', () => {
  it('returns the explicit channel unchanged when provided', async () => {
    expect(await resolveChannel('UNOFFICIAL')).toBe('UNOFFICIAL')
    expect(mockPrisma.settings.findUniqueOrThrow).not.toHaveBeenCalled()
  })

  it('falls back to Settings.defaultChannel when no explicit channel is given', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ defaultChannel: 'UNOFFICIAL' } as never)
    expect(await resolveChannel()).toBe('UNOFFICIAL')
  })
})
