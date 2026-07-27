import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { relinkCoexist } from '@/lib/coexist/client'
import { POST } from './route'

// `vi.mock` factories are hoisted above regular imports and `let`/`const`
// declarations, so the mock instance must be constructed inline inside the
// factory rather than via an outer variable.
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/coexist/client', () => ({ relinkCoexist: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function request(withCookie = true) {
  return new Request('http://localhost/api/numbers/relink', {
    method: 'POST',
    headers: withCookie ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(relinkCoexist).mockReset()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
})

describe('POST /api/numbers/relink', () => {
  it('re-links the coexist number when called by an admin', async () => {
    mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ id: 'wa_1', coexistNumberKey: 'k' } as never)
    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(relinkCoexist).toHaveBeenCalled()
  })

  it('rejects when the caller is not an admin', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
    const res = await POST(request())
    expect(res.status).toBe(403)
    expect(relinkCoexist).not.toHaveBeenCalled()
  })

  it('rejects when there is no session cookie at all', async () => {
    const res = await POST(request(false))
    expect(res.status).toBe(403)
    expect(relinkCoexist).not.toHaveBeenCalled()
  })

  // Without this the route produced a bare unhandled 500 and the Settings page
  // showed the admin nothing at all.
  it('returns 502 with Indonesian copy when wa-coexist rejects the relink', async () => {
    mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ id: 'wa_1', coexistNumberKey: 'k' } as never)
    vi.mocked(relinkCoexist).mockRejectedValue(new Error('Relink failed'))

    const res = await POST(request())

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'Gagal menyambungkan ulang — periksa wa-coexist' })
  })

  it('returns 502 when the relink request times out', async () => {
    mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ id: 'wa_1', coexistNumberKey: 'k' } as never)
    vi.mocked(relinkCoexist).mockRejectedValue(
      new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    )

    const res = await POST(request())

    expect(res.status).toBe(502)
  })
})
