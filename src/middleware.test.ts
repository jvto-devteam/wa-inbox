/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { middleware } from './middleware'

// `vi.mock` factories are hoisted above regular imports and `let`/`const`
// declarations, so the mock instance must be constructed inline inside the
// factory (referencing only the already-imported `mockDeep` and the erased
// `PrismaClient` type) rather than via an outer variable — otherwise the
// factory throws "Cannot access ... before initialization".
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function request(path: string, cookie?: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: cookie ? { cookie } : {},
  })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 3 })
  mockPrisma.account.findUnique.mockResolvedValue({ tokenVersion: 3 } as never)
})

describe('middleware — public paths', () => {
  it.each(['/login', '/api/auth/login', '/api/webhooks/meta'])('lets %s through without a session', async (path) => {
    const res = await middleware(request(path))
    expect(res.status).toBe(200)
    expect(mockPrisma.account.findUnique).not.toHaveBeenCalled()
  })
})

describe('middleware — valid session', () => {
  it('allows an API request whose tokenVersion matches the account', async () => {
    const res = await middleware(request('/api/conversations', 'wa_inbox_session=tok'))
    expect(res.status).toBe(200)
    expect(mockPrisma.account.findUnique).toHaveBeenCalledWith({
      where: { id: 'acc_1' },
      select: { tokenVersion: true },
    })
  })
})

describe('middleware — tokenVersion revocation', () => {
  it('rejects an API request whose token carries a stale tokenVersion', async () => {
    // The account's password was reset (or its role changed) after this token
    // was issued, bumping tokenVersion from 3 to 4.
    mockPrisma.account.findUnique.mockResolvedValue({ tokenVersion: 4 } as never)

    const res = await middleware(request('/api/conversations', 'wa_inbox_session=tok'))

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  it('redirects a page request whose token carries a stale tokenVersion to /login', async () => {
    mockPrisma.account.findUnique.mockResolvedValue({ tokenVersion: 4 } as never)

    const res = await middleware(request('/inbox', 'wa_inbox_session=tok'))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost/login')
  })
})

describe('middleware — deleted account', () => {
  it('treats a missing account row as an invalid session rather than throwing', async () => {
    mockPrisma.account.findUnique.mockResolvedValue(null)

    const res = await middleware(request('/api/conversations', 'wa_inbox_session=tok'))

    expect(res.status).toBe(401)
  })

  it('redirects to /login on a page request when the account no longer exists', async () => {
    mockPrisma.account.findUnique.mockResolvedValue(null)

    const res = await middleware(request('/inbox', 'wa_inbox_session=tok'))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost/login')
  })
})

describe('middleware — no or invalid session', () => {
  it('401s an API request with no cookie at all and never queries the database', async () => {
    const res = await middleware(request('/api/conversations'))
    expect(res.status).toBe(401)
    expect(mockPrisma.account.findUnique).not.toHaveBeenCalled()
  })

  it('401s an API request whose token fails signature verification', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null)
    const res = await middleware(request('/api/conversations', 'wa_inbox_session=bad'))
    expect(res.status).toBe(401)
    expect(mockPrisma.account.findUnique).not.toHaveBeenCalled()
  })

  it('redirects an unauthenticated page request to /login', async () => {
    const res = await middleware(request('/inbox'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost/login')
  })
})
