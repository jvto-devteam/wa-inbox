import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { GET, POST, PATCH } from './route'

// `vi.mock` factories are hoisted above regular imports and `let`/`const`
// declarations, so the mock instance must be constructed inline inside the
// factory (referencing only the already-imported `mockDeep` and the erased
// `PrismaClient` type) rather than via an outer variable — otherwise the
// factory throws "Cannot access ... before initialization".
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
})

describe('contact reminders API', () => {
  it('GET lists reminders for a contact ordered by due date', async () => {
    mockPrisma.reminder.findMany.mockResolvedValue([
      { id: 'r1', contactId: 'contact_1', dueAt: new Date('2026-08-01T00:00:00Z'), note: 'Follow up', done: false },
    ] as never)

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: 'contact_1' }) })
    const body = await res.json()

    expect(body[0].note).toBe('Follow up')
    expect(mockPrisma.reminder.findMany).toHaveBeenCalledWith({
      where: { contactId: 'contact_1' },
      orderBy: { dueAt: 'asc' },
    })
  })

  it('POST creates a reminder', async () => {
    mockPrisma.reminder.create.mockResolvedValue({ id: 'r1', contactId: 'contact_1', dueAt: new Date('2026-08-01T00:00:00Z'), note: 'Follow up', done: false } as never)
    const req = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ dueAt: '2026-08-01T00:00:00Z', note: 'Follow up' }) })
    const res = await POST(req, { params: Promise.resolve({ id: 'contact_1' }) })

    expect(res.status).toBe(200)
    expect(mockPrisma.reminder.create).toHaveBeenCalledWith({
      data: { contactId: 'contact_1', dueAt: new Date('2026-08-01T00:00:00Z'), note: 'Follow up' },
    })
  })

  it('POST rejects an empty note', async () => {
    const req = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ dueAt: '2026-08-01T00:00:00Z', note: '' }) })
    const res = await POST(req, { params: Promise.resolve({ id: 'contact_1' }) })

    expect(res.status).toBe(400)
    expect(mockPrisma.reminder.create).not.toHaveBeenCalled()
  })

  it('PATCH marks a reminder done', async () => {
    mockPrisma.reminder.findUnique.mockResolvedValue({ id: 'r1', contactId: 'contact_1', done: false } as never)
    mockPrisma.reminder.update.mockResolvedValue({ id: 'r1', contactId: 'contact_1', done: true } as never)
    const req = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ reminderId: 'r1', done: true }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'contact_1' }) })

    expect((await res.json()).done).toBe(true)
    expect(mockPrisma.reminder.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { done: true } })
  })

  it('PATCH rejects a reminder that belongs to a different contact', async () => {
    mockPrisma.reminder.findUnique.mockResolvedValue({ id: 'r1', contactId: 'contact_OTHER', done: false } as never)
    const req = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ reminderId: 'r1', done: true }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'contact_1' }) })

    expect(res.status).toBe(404)
    expect(mockPrisma.reminder.update).not.toHaveBeenCalled()
  })

  it('PATCH rejects a reminder that does not exist', async () => {
    mockPrisma.reminder.findUnique.mockResolvedValue(null)
    const req = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ reminderId: 'nope', done: true }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'contact_1' }) })

    expect(res.status).toBe(404)
    expect(mockPrisma.reminder.update).not.toHaveBeenCalled()
  })
})
