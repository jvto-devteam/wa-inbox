import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { GET } from './route'
import { getCoexistStatus } from '@/lib/coexist/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/coexist/client', () => ({ getCoexistStatus: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(getCoexistStatus).mockReset()
})

describe('GET /api/numbers/status', () => {
  it('reports official token presence and unofficial connection status', async () => {
    mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({
      accessToken: 'tok',
      coexistBaseUrl: 'http://x',
      coexistApiKey: 'k',
      coexistNumberKey: 'n',
    } as never)
    vi.mocked(getCoexistStatus).mockResolvedValue({ connected: true })

    const res = await GET()
    const body = await res.json()

    expect(body).toEqual({ officialTokenValid: true, unofficialConnected: true })
  })

  it('reports invalid official token and disconnected unofficial channel', async () => {
    mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({
      accessToken: '',
      coexistBaseUrl: 'http://x',
      coexistApiKey: 'k',
      coexistNumberKey: 'n',
    } as never)
    vi.mocked(getCoexistStatus).mockResolvedValue({ connected: false })

    const res = await GET()
    const body = await res.json()

    expect(body).toEqual({ officialTokenValid: false, unofficialConnected: false })
  })
})
