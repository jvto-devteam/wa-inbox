import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { GET, POST } from './route'

// `vi.mock` factories are hoisted above regular imports and `let`/`const`
// declarations, so the mock instance must be constructed inline inside the
// factory (referencing only the already-imported `mockDeep` and the erased
// `PrismaClient` type) rather than via an outer variable — otherwise the
// factory throws "Cannot access ... before initialization".
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN' })
})

describe('GET /api/accounts', () => {
  it('lists accounts with id, name, email, and role — excluding passwordHash', async () => {
    mockPrisma.account.findMany.mockResolvedValue([
      { id: 'acc_1', name: 'Rina', email: 'rina@jvto.com', role: 'AGENT' },
    ] as never)

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual([{ id: 'acc_1', name: 'Rina', email: 'rina@jvto.com', role: 'AGENT' }])
    expect(mockPrisma.account.findMany).toHaveBeenCalledWith({
      select: { id: true, name: true, email: true, role: true },
    })
  })
})

describe('POST /api/accounts', () => {
  it('creates a new agent account when called by an admin', async () => {
    mockPrisma.account.create.mockResolvedValue({ id: 'acc_new', email: 'agen2@jvto.com', name: 'Agen 2', role: 'AGENT' } as never)
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { cookie: 'wa_inbox_session=tok' },
      body: JSON.stringify({ email: 'agen2@jvto.com', name: 'Agen 2', password: 'Rahasia123', role: 'AGENT' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect((await res.json()).email).toBe('agen2@jvto.com')
  })

  it('rejects the request when the caller is not an admin', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT' })
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { cookie: 'wa_inbox_session=tok' },
      body: JSON.stringify({ email: 'x@jvto.com', name: 'X', password: 'x', role: 'AGENT' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('rejects the request when there is no session cookie at all', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null)
    const req = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ email: 'x@jvto.com', name: 'X', password: 'password1', role: 'AGENT' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('rejects invalid input with 400', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { cookie: 'wa_inbox_session=tok' },
      body: JSON.stringify({ email: 'not-an-email', name: '', password: 'short', role: 'AGENT' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
