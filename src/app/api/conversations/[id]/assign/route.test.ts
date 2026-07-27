import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { PATCH } from './route'

// `vi.mock` factories are hoisted above regular imports and `let`/`const`
// declarations, so the mock instance must be constructed inline inside the
// factory (referencing only the already-imported `mockDeep` and the erased
// `PrismaClient` type) rather than via an outer variable — otherwise the
// factory throws "Cannot access ... before initialization".
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
  mockPrisma.account.findUnique.mockResolvedValue({ id: 'acc_2' } as never)
})

describe('PATCH /api/conversations/[id]/assign', () => {
  it('assigns the conversation to an agent', async () => {
    mockPrisma.conversation.update.mockResolvedValue({ assignedAgentId: 'acc_2' } as never)
    const req = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ agentId: 'acc_2' }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'conv_1' }) })
    expect((await res.json()).assignedAgentId).toBe('acc_2')
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv_1' },
      data: { assignedAgentId: 'acc_2' },
    })
  })

  it('unassigns when agentId is null', async () => {
    mockPrisma.conversation.update.mockResolvedValue({ assignedAgentId: null } as never)
    const req = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ agentId: null }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'conv_1' }) })
    expect((await res.json()).assignedAgentId).toBeNull()
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv_1' },
      data: { assignedAgentId: null },
    })
  })

  it('rejects an invalid body', async () => {
    const req = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ agentId: 42 }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'conv_1' }) })
    expect(res.status).toBe(400)
    expect(mockPrisma.conversation.update).not.toHaveBeenCalled()
  })

  it('returns a clean 404 instead of a raw Prisma FK error when agentId is not a real account', async () => {
    mockPrisma.account.findUnique.mockResolvedValue(null)
    const req = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ agentId: 'acc_ghost' }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'conv_1' }) })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/Agen tidak ditemukan/i)
    expect(mockPrisma.conversation.update).not.toHaveBeenCalled()
  })

  it('skips the agent lookup entirely when unassigning', async () => {
    mockPrisma.conversation.update.mockResolvedValue({ assignedAgentId: null } as never)
    const req = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ agentId: null }) })
    await PATCH(req, { params: Promise.resolve({ id: 'conv_1' }) })
    expect(mockPrisma.account.findUnique).not.toHaveBeenCalled()
  })
})
