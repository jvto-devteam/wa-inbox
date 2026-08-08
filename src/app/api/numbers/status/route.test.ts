import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
})

describe('GET /api/numbers/status', () => {
  it('reports official token presence and unofficial configuration', async () => {
    mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({
      accessToken: 'tok',
      coexistBaseUrl: 'http://x',
      coexistApiKey: 'k',
      coexistNumberKey: 'n',
    } as never)

    const res = await GET()
    const body = await res.json()

    expect(body).toEqual({ officialTokenValid: true, unofficialConfigured: true })
  })

  it('reports invalid official token and unconfigured unofficial channel', async () => {
    mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({
      accessToken: '',
      coexistBaseUrl: '',
      coexistApiKey: '',
      coexistNumberKey: '',
    } as never)

    const res = await GET()
    const body = await res.json()

    expect(body).toEqual({ officialTokenValid: false, unofficialConfigured: false })
  })
})
