import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { POST } from './route'

// `vi.mock` factories are hoisted above regular imports and `let`/`const`
// declarations, so the mock instance must be constructed inline inside the
// factory (referencing only the already-imported `mockDeep` and the erased
// `PrismaClient` type) rather than via an outer variable — otherwise the
// factory throws "Cannot access ... before initialization".
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
  process.env.SESSION_SECRET = 'a'.repeat(64)
})

describe('POST /api/auth/login', () => {
  it('returns 401 for unknown email', async () => {
    mockPrisma.account.findUnique.mockResolvedValue(null)
    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'nobody@jvto.com', password: 'x' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 for malformed body', async () => {
    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'not-an-email' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  // `bodySchema.safeParse(await req.json())` reads as if it handles a bad body, but
  // req.json() throws before safeParse runs — a login form posting a truncated or
  // non-JSON body produced an unhandled 500 with a stack trace, on an unauthenticated
  // endpoint, instead of this app's mandated { error } 4xx.
  it('returns a clean { error } 400 — not a 500 — when the body is not JSON at all', async () => {
    const req = new Request('http://localhost/api/auth/login', { method: 'POST', body: 'not json at all' })

    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Email atau kata sandi tidak valid' })
  })

  it('returns 400 for an empty body', async () => {
    const req = new Request('http://localhost/api/auth/login', { method: 'POST', body: '' })

    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Email atau kata sandi tidak valid' })
  })
})
