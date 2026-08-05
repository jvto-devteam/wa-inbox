import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function req() {
  return new Request('http://localhost', { method: 'POST' })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(broadcast).mockReset()
})

describe('POST /api/conversations/[id]/clear', () => {
  it('rejects a conversation that is not isTest, without deleting any message', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({ id: 'conv_1', isTest: false } as never)

    const res = await POST(req(), { params: Promise.resolve({ id: 'conv_1' }) })

    expect(res.status).toBe(403)
    expect(mockPrisma.message.deleteMany).not.toHaveBeenCalled()
    expect(mockPrisma.conversation.update).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('deletes every message and resets tripBrief/botEnabled/lastReadAt when the conversation is isTest', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({ id: 'conv_test', isTest: true } as never)

    const res = await POST(req(), { params: Promise.resolve({ id: 'conv_test' }) })

    expect(res.status).toBe(200)
    expect(mockPrisma.message.deleteMany).toHaveBeenCalledWith({ where: { conversationId: 'conv_test' } })
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv_test' },
      data: { tripBrief: {}, botEnabled: true, lastReadAt: null },
    })
    expect(broadcast).toHaveBeenCalledWith({ type: 'conversation.cleared', conversationId: 'conv_test' })
  })
})
