import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { verifySessionToken } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { GET } from './route'

vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  vi.mocked(verifySessionToken).mockReset()
  mockReset(mockPrisma)
})

describe('GET /api/session', () => {
  it('returns the role and account name for a valid session cookie', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
    mockPrisma.account.findUnique.mockResolvedValue({ name: 'Admin Demo' } as never)
    const req = new Request('http://localhost', { headers: { cookie: 'wa_inbox_session=tok' } })
    const res = await GET(req)
    expect(res.status).toBe(200)
    // `role` is unchanged from before `name` was added — the Settings page reads it.
    expect(await res.json()).toEqual({ role: 'ADMIN', name: 'Admin Demo' })
  })

  it('looks the name up by the account id in the token, selecting nothing else', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 3 })
    mockPrisma.account.findUnique.mockResolvedValue({ name: 'Rina' } as never)
    const req = new Request('http://localhost', { headers: { cookie: 'wa_inbox_session=tok' } })

    await GET(req)

    // Never widen this select: the same row holds passwordHash, and this response is read by
    // a client component.
    expect(mockPrisma.account.findUnique).toHaveBeenCalledWith({
      where: { id: 'acc_agent' },
      select: { name: true },
    })
  })

  it('returns 401 when there is no session cookie', async () => {
    const req = new Request('http://localhost')
    const res = await GET(req)
    expect(res.status).toBe(401)
    expect(mockPrisma.account.findUnique).not.toHaveBeenCalled()
  })

  it('returns 401 when the session token is invalid', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null)
    const req = new Request('http://localhost', { headers: { cookie: 'wa_inbox_session=bad' } })
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 when the token is valid but the account no longer exists', async () => {
    // Deleted-after-issue: middleware rejects this case, so this route must not hand back a
    // session object with a missing name.
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_gone', role: 'ADMIN', tokenVersion: 0 })
    mockPrisma.account.findUnique.mockResolvedValue(null)
    const req = new Request('http://localhost', { headers: { cookie: 'wa_inbox_session=tok' } })

    const res = await GET(req)

    expect(res.status).toBe(401)
  })
})
