import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { GET, POST } from './route'

// `vi.mock` factories are hoisted above regular imports and `let`/`const`
// declarations, so the mock instance must be constructed inline inside the
// factory (referencing only the already-imported `mockDeep` and the erased
// `PrismaClient` type) rather than via an outer variable — otherwise the
// factory throws "Cannot access ... before initialization".
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({
  verifySessionToken: vi.fn().mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 }),
}))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
})

describe('contact notes API', () => {
  it('GET lists notes for a contact ordered newest-first', async () => {
    mockPrisma.note.findMany.mockResolvedValue([
      { id: 'n2', body: 'Follow up minggu depan', author: { name: 'Admin' }, createdAt: new Date('2026-07-26T10:00:00Z') },
      { id: 'n1', body: 'Pelanggan lama', author: { name: 'Admin' }, createdAt: new Date('2026-07-20T10:00:00Z') },
    ] as never)

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: 'contact_1' }) })
    const body = await res.json()

    expect(body[0].body).toBe('Follow up minggu depan')
    expect(body[1].body).toBe('Pelanggan lama')
    expect(mockPrisma.note.findMany).toHaveBeenCalledWith({
      where: { contactId: 'contact_1' },
      include: { author: true },
      orderBy: { createdAt: 'desc' },
    })
  })

  it('POST creates a note tied to the current session', async () => {
    mockPrisma.note.create.mockResolvedValue({
      id: 'n2',
      body: 'Follow up minggu depan',
      author: { name: 'Admin' },
      createdAt: new Date('2026-07-26T10:00:00Z'),
    } as never)
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { cookie: 'wa_inbox_session=tok' },
      body: JSON.stringify({ body: 'Follow up minggu depan' }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'contact_1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.body).toBe('Follow up minggu depan')
    expect(mockPrisma.note.create).toHaveBeenCalledWith({
      data: { contactId: 'contact_1', authorId: 'acc_1', body: 'Follow up minggu depan' },
      include: { author: true },
    })
  })

  it('POST rejects an empty note body', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { cookie: 'wa_inbox_session=tok' },
      body: JSON.stringify({ body: '' }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'contact_1' }) })

    expect(res.status).toBe(400)
    expect(mockPrisma.note.create).not.toHaveBeenCalled()
  })

  it('POST rejects when no session is present', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ body: 'Tanpa sesi' }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'contact_1' }) })

    expect(res.status).toBe(401)
    expect(mockPrisma.note.create).not.toHaveBeenCalled()
  })
})
