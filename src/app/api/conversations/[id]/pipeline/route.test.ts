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
})

describe('PATCH /api/conversations/[id]/pipeline', () => {
  it('updates the pipeline stage', async () => {
    mockPrisma.conversation.update.mockResolvedValue({ pipelineStage: 'nego' } as never)
    const req = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ stage: 'nego' }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'conv_1' }) })
    expect((await res.json()).pipelineStage).toBe('nego')
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv_1' },
      data: { pipelineStage: 'nego' },
    })
  })

  it('rejects an unknown stage value', async () => {
    const req = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ stage: 'made-up' }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'conv_1' }) })
    expect(res.status).toBe(400)
    expect(mockPrisma.conversation.update).not.toHaveBeenCalled()
  })
})
