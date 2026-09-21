import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { hashApiKey } from '@/lib/api-clients/auth'
import { GET, POST } from './route'
import { POST as REVOKE } from './[id]/revoke/route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const headers = { cookie: 'wa_inbox_session=tok' }

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
})

describe('POST /api/api-clients', () => {
  it('returns the raw key once and stores only its hash', async () => {
    mockPrisma.apiClient.create.mockImplementation(((args: { data: { name: string; keyPrefix: string } }) =>
      Promise.resolve({ id: 'c1', name: args.data.name, keyPrefix: args.data.keyPrefix })) as never)

    const res = await POST(new Request('http://x', { method: 'POST', headers, body: JSON.stringify({ name: 'jvto' }) }))
    expect(res.status).toBe(201)
    const { key } = await res.json()

    const stored = mockPrisma.apiClient.create.mock.calls[0][0].data
    expect(stored.keyHash).toBe(hashApiKey(key))
    expect(JSON.stringify(stored)).not.toContain(key)
  })

  it('is admin-only', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'a', role: 'AGENT', tokenVersion: 0 })
    const res = await POST(new Request('http://x', { method: 'POST', headers, body: JSON.stringify({ name: 'jvto' }) }))
    expect(res.status).toBe(403)
  })
})

describe('GET /api/api-clients', () => {
  it('never selects the key hash', async () => {
    mockPrisma.apiClient.findMany.mockResolvedValue([])
    await GET(new Request('http://x', { headers }))
    const select = mockPrisma.apiClient.findMany.mock.calls[0][0]?.select
    expect(select).not.toHaveProperty('keyHash')
  })
})

describe('POST /api/api-clients/[id]/revoke', () => {
  const revoke = (id = 'c1') => REVOKE(new Request('http://x', { method: 'POST', headers }), { params: Promise.resolve({ id }) })

  it('revokes an active key', async () => {
    mockPrisma.apiClient.findUnique.mockResolvedValue({ id: 'c1', revokedAt: null } as never)
    mockPrisma.apiClient.update.mockResolvedValue({ id: 'c1', revokedAt: new Date() } as never)

    expect((await revoke()).status).toBe(200)
    expect(mockPrisma.apiClient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1' }, data: { revokedAt: expect.any(Date) } })
    )
  })

  it('refuses to revoke twice and 404s an unknown id', async () => {
    mockPrisma.apiClient.findUnique.mockResolvedValue({ id: 'c1', revokedAt: new Date() } as never)
    expect((await revoke()).status).toBe(409)

    mockPrisma.apiClient.findUnique.mockResolvedValue(null)
    expect((await revoke('nope')).status).toBe(404)
  })
})
