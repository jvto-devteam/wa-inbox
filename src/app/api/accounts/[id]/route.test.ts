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
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  // Default target for DELETE: an ordinary agent that isn't the caller, so the
  // self-delete and last-admin guards both pass and the existing cases below
  // exercise the paths they were written for.
  mockPrisma.account.findUnique.mockResolvedValue({ role: 'AGENT' } as never)
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
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
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

  it('refuses to let an admin delete their own account', async () => {
    const req = new Request('http://localhost', { method: 'DELETE', headers: { cookie: 'wa_inbox_session=tok' } })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'acc_admin' }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/akun Anda sendiri/i)
    expect(mockPrisma.account.delete).not.toHaveBeenCalled()
  })

  it('refuses to delete the last remaining admin, which would lock everyone out of user management', async () => {
    mockPrisma.account.findUnique.mockResolvedValue({ role: 'ADMIN' } as never)
    mockPrisma.account.count.mockResolvedValue(1)

    const req = new Request('http://localhost', { method: 'DELETE', headers: { cookie: 'wa_inbox_session=tok' } })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'acc_other_admin' }) })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/admin terakhir/i)
    expect(mockPrisma.account.count).toHaveBeenCalledWith({ where: { role: 'ADMIN' } })
    expect(mockPrisma.account.delete).not.toHaveBeenCalled()
  })

  it('allows deleting an admin while another admin remains', async () => {
    mockPrisma.account.findUnique.mockResolvedValue({ role: 'ADMIN' } as never)
    mockPrisma.account.count.mockResolvedValue(2)
    mockPrisma.account.delete.mockResolvedValue({} as never)

    const req = new Request('http://localhost', { method: 'DELETE', headers: { cookie: 'wa_inbox_session=tok' } })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'acc_other_admin' }) })

    expect(res.status).toBe(200)
    expect(mockPrisma.account.delete).toHaveBeenCalledWith({ where: { id: 'acc_other_admin' } })
  })

  it('does not count admins when deleting a plain agent', async () => {
    mockPrisma.account.delete.mockResolvedValue({} as never)
    const req = new Request('http://localhost', { method: 'DELETE', headers: { cookie: 'wa_inbox_session=tok' } })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'acc_2' }) })
    expect(res.status).toBe(200)
    expect(mockPrisma.account.count).not.toHaveBeenCalled()
  })

  it('404s when the target account does not exist', async () => {
    mockPrisma.account.findUnique.mockResolvedValue(null)
    const req = new Request('http://localhost', { method: 'DELETE', headers: { cookie: 'wa_inbox_session=tok' } })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'missing' }) })
    expect(res.status).toBe(404)
    expect(mockPrisma.account.delete).not.toHaveBeenCalled()
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
      data: { passwordHash: expect.any(String), tokenVersion: { increment: 1 } },
    })
  })

  it('bumps tokenVersion so the sessions issued under the old password are revoked', async () => {
    mockPrisma.account.update.mockResolvedValue({ id: 'acc_2' } as never)
    const req = new Request('http://localhost', {
      method: 'PATCH',
      headers: { cookie: 'wa_inbox_session=tok' },
      body: JSON.stringify({ password: 'NewPass123' }),
    })
    await PATCH(req, { params: Promise.resolve({ id: 'acc_2' }) })

    expect(mockPrisma.account.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tokenVersion: { increment: 1 } }) })
    )
  })

  it('rejects when the caller is not an admin', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
    const req = new Request('http://localhost', {
      method: 'PATCH',
      headers: { cookie: 'wa_inbox_session=tok' },
      body: JSON.stringify({ password: 'NewPass123' }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'acc_2' }) })
    expect(res.status).toBe(403)
    expect(mockPrisma.account.update).not.toHaveBeenCalled()
  })

  it('rejects when there is no session cookie at all', async () => {
    const req = new Request('http://localhost', {
      method: 'PATCH',
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
