import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { GET, PATCH } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
})

describe('GET /api/settings', () => {
  it('returns the singleton settings row', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({
      id: 1,
      defaultChannel: 'OFFICIAL',
      workingHoursStart: null,
      workingHoursEnd: null,
      offHoursAutoReply: null,
      botKillSwitch: false,
      catalogSyncedAt: null,
    } as never)

    const res = await GET()

    expect((await res.json()).defaultChannel).toBe('OFFICIAL')
  })
})

describe('PATCH /api/settings', () => {
  it('updates defaultChannel', async () => {
    mockPrisma.settings.update.mockResolvedValue({ id: 1, defaultChannel: 'UNOFFICIAL' } as never)

    const req = new Request('http://localhost/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ defaultChannel: 'UNOFFICIAL' }),
    })
    const res = await PATCH(req)

    expect((await res.json()).defaultChannel).toBe('UNOFFICIAL')
  })

  it('rejects invalid payloads', async () => {
    const req = new Request('http://localhost/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ defaultChannel: 'NOT_A_CHANNEL' }),
    })
    const res = await PATCH(req)

    expect(res.status).toBe(400)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })
})
