import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
import { GET } from './route'

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(requireAdmin).mockReset().mockResolvedValue({ accountId: 'a', role: 'ADMIN' } as never)
  vi.stubEnv('GMAIL_PUBSUB_TOPIC', 'projects/p/topics/t')
})
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/mail-accounts', () => {
  it('bukan admin: 403', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null)
    expect((await GET(new Request('https://h/api/mail-accounts'))).status).toBe(403)
  })

  it('refresh token TIDAK PERNAH ada di respons, walau database mengembalikannya', async () => {
    mockPrisma.mailAccount.findMany.mockResolvedValue([{
      id: 'mail_1', emailAddress: 'hello@x.com', refreshToken: 'rt-rahasia-sekali', historyId: '1',
      watchExpiresAt: null, lastSyncAt: null, lastSyncError: 'AUTH_REVOKED', createdAt: new Date('2026-09-28T00:00:00Z'),
    }] as never)

    const res = await GET(new Request('https://h/api/mail-accounts'))
    const text = await res.text()
    expect(text).not.toContain('rt-rahasia-sekali')
    expect(text).not.toContain('refreshToken')
    expect(JSON.parse(text)).toEqual({
      pushConfigured: true,
      items: [{ id: 'mail_1', emailAddress: 'hello@x.com', watchExpiresAt: null, lastSyncAt: null, lastSyncError: 'AUTH_REVOKED', createdAt: '2026-09-28T00:00:00.000Z' }],
    })
  })
})
