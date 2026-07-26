import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { DELETE, PATCH } from './route'

// Same TDD-fix idiom as src/app/api/accounts/route.test.ts: construct the
// mock inline inside the factory rather than closing over an outer `let`
// reassigned in beforeEach, which throws a TDZ error under vi.mock hoisting.
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN' })
})

describe('DELETE /api/accounts/[id]', () => {
  it('deletes the account when called by an admin', async () => {
    mockPrisma.account.delete.mockResolvedValue({} as never)
    const req = new Request('http://localhost', { method: 'DELETE', headers: { cookie: 'wa_inbox_session=tok' } })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'acc_2' }) })
    expect(res.status).toBe(200)
    expect(mockPrisma.account.delete).toHaveBeenCalledWith({ where: { id: 'acc_2' } })
  })

  it('rejects when the caller is not an admin', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT' })
    const req = new Request('http://localhost', { method: 'DELETE', headers: { cookie: 'wa_inbox_session=tok' } })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'acc_2' }) })
    expect(res.status).toBe(403)
    expect(mockPrisma.account.delete).not.toHaveBeenCalled()
  })

  it('rejects when there is no session cookie at all', async () => {
    const req = new Request('http://localhost', { method: 'DELETE' })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'acc_2' }) })
    expect(res.status).toBe(403)
  })

  it('returns a clean 409 instead of a 500 when the account still has related records (FK constraint)', async () => {
    mockPrisma.account.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
        code: 'P2003',
        clientVersion: '6.0.0',
      })
    )
    const req = new Request('http://localhost', { method: 'DELETE', headers: { cookie: 'wa_inbox_session=tok' } })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'acc_2' }) })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/masih memiliki/i)
  })
})

describe('PATCH /api/accounts/[id]', () => {
  it('resets the password when called by an admin', async () => {
    mockPrisma.account.update.mockResolvedValue({ id: 'acc_2' } as never)
    const req = new Request('http://localhost', {
      method: 'PATCH',
      headers: { cookie: 'wa_inbox_session=tok' },
      body: JSON.stringify({ password: 'NewPass123' }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'acc_2' }) })
    expect(res.status).toBe(200)
    expect(mockPrisma.account.update).toHaveBeenCalledWith({
      where: { id: 'acc_2' },
      data: { passwordHash: expect.any(String) },
    })
  })

  it('rejects when the caller is not an admin', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT' })
    const req = new Request('http://localhost', {
      method: 'PATCH',
      headers: { cookie: 'wa_inbox_session=tok' },
      body: JSON.stringify({ password: 'NewPass123' }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'acc_2' }) })
    expect(res.status).toBe(403)
    expect(mockPrisma.account.update).not.toHaveBeenCalled()
  })

  it('rejects a too-short password with 400', async () => {
    const req = new Request('http://localhost', {
      method: 'PATCH',
      headers: { cookie: 'wa_inbox_session=tok' },
      body: JSON.stringify({ password: 'short' }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'acc_2' }) })
    expect(res.status).toBe(400)
  })
})
