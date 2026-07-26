import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { POST, DELETE } from './route'

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

describe('conversation labels API', () => {
  it('POST attaches a label to a conversation', async () => {
    mockPrisma.labelOnConversation.create.mockResolvedValue({} as never)

    const req = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ labelId: 'lbl_1' }) })
    const res = await POST(req, { params: Promise.resolve({ id: 'conv_1' }) })

    expect(res.status).toBe(200)
    expect(mockPrisma.labelOnConversation.create).toHaveBeenCalledWith({ data: { conversationId: 'conv_1', labelId: 'lbl_1' } })
  })

  it('POST rejects a missing labelId', async () => {
    const req = new Request('http://localhost', { method: 'POST', body: JSON.stringify({}) })
    const res = await POST(req, { params: Promise.resolve({ id: 'conv_1' }) })

    expect(res.status).toBe(400)
    expect(mockPrisma.labelOnConversation.create).not.toHaveBeenCalled()
  })

  it('DELETE detaches a label', async () => {
    mockPrisma.labelOnConversation.delete.mockResolvedValue({} as never)

    const req = new Request('http://localhost', { method: 'DELETE', body: JSON.stringify({ labelId: 'lbl_1' }) })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'conv_1' }) })

    expect(res.status).toBe(200)
    expect(mockPrisma.labelOnConversation.delete).toHaveBeenCalledWith({
      where: { labelId_conversationId: { conversationId: 'conv_1', labelId: 'lbl_1' } },
    })
  })

  it('DELETE rejects a missing labelId', async () => {
    const req = new Request('http://localhost', { method: 'DELETE', body: JSON.stringify({}) })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'conv_1' }) })

    expect(res.status).toBe(400)
    expect(mockPrisma.labelOnConversation.delete).not.toHaveBeenCalled()
  })
})
