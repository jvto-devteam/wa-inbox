import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { GET } from './route'

// Same TDD-fix idiom used throughout this plan: construct the mock inline
// inside the factory rather than closing over an outer `let` reassigned in
// beforeEach, which throws a TDZ error under vi.mock hoisting.
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN' })
})

describe('GET /api/numbers/credentials', () => {
  it('reports presence of accessToken/coexistApiKey without ever returning their values', async () => {
    mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({
      accessToken: 'super-secret-token',
      coexistApiKey: 'super-secret-key',
      coexistBaseUrl: 'http://localhost:4000',
    } as never)

    const req = new Request('http://localhost', { headers: { cookie: 'wa_inbox_session=tok' } })
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      coexistBaseUrl: 'http://localhost:4000',
      accessTokenSet: true,
      coexistApiKeySet: true,
    })
    expect(JSON.stringify(body)).not.toContain('super-secret-token')
    expect(JSON.stringify(body)).not.toContain('super-secret-key')
  })

  it('reports false when the credentials are empty strings', async () => {
    mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({
      accessToken: '',
      coexistApiKey: '',
      coexistBaseUrl: 'http://localhost:4000',
    } as never)

    const req = new Request('http://localhost', { headers: { cookie: 'wa_inbox_session=tok' } })
    const res = await GET(req)
    const body = await res.json()

    expect(body).toEqual({
      coexistBaseUrl: 'http://localhost:4000',
      accessTokenSet: false,
      coexistApiKeySet: false,
    })
  })

  it('rejects non-admin callers with 403', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT' })
    const req = new Request('http://localhost', { headers: { cookie: 'wa_inbox_session=tok' } })
    const res = await GET(req)
    expect(res.status).toBe(403)
    expect(mockPrisma.waNumber.findFirstOrThrow).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated callers with 403', async () => {
    const req = new Request('http://localhost')
    const res = await GET(req)
    expect(res.status).toBe(403)
  })
})
