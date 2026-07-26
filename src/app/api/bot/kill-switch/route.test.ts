import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
})

describe('POST /api/bot/kill-switch', () => {
  it('flips botKillSwitch', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ botKillSwitch: false } as never)
    mockPrisma.settings.update.mockResolvedValue({ botKillSwitch: true } as never)
    const res = await POST()
    expect((await res.json()).botKillSwitch).toBe(true)
  })
})
