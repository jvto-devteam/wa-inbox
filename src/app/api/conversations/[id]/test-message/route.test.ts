import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { runBotForConversation } from '@/lib/inbound'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))
vi.mock('@/lib/inbound', () => ({ runBotForConversation: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function req(body: unknown) {
  return new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(broadcast).mockReset()
  vi.mocked(runBotForConversation).mockReset().mockResolvedValue(undefined)
})

describe('POST /api/conversations/[id]/test-message', () => {
  it('rejects a conversation that is not isTest, without creating any message', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
      id: 'conv_1', isTest: false, botEnabled: true, contact: { name: 'Bruno' },
    } as never)

    const res = await POST(req({ text: 'halo' }), { params: Promise.resolve({ id: 'conv_1' }) })

    expect(res.status).toBe(403)
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
    expect(runBotForConversation).not.toHaveBeenCalled()
  })

  it('creates an INBOUND CUSTOMER message and runs the bot when the conversation is isTest and botEnabled', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
      id: 'conv_test', isTest: true, botEnabled: true, contact: { name: null },
    } as never)
    mockPrisma.message.create.mockResolvedValue({
      id: 'msg_1', conversationId: 'conv_test', direction: 'INBOUND', content: 'Halo bot', createdAt: new Date('2026-08-01T00:00:00Z'),
    } as never)

    const res = await POST(req({ text: 'Halo bot' }), { params: Promise.resolve({ id: 'conv_test' }) })

    expect(res.status).toBe(200)
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ conversationId: 'conv_test', direction: 'INBOUND', sentBy: 'CUSTOMER', content: 'Halo bot' }),
    }))
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'message.created', conversationId: 'conv_test' }))
    expect(runBotForConversation).toHaveBeenCalledWith({ id: 'conv_test', contactName: null }, 'Halo bot')
  })

  it('does not run the bot when botEnabled is false', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
      id: 'conv_test', isTest: true, botEnabled: false, contact: { name: null },
    } as never)
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_1', createdAt: new Date() } as never)

    await POST(req({ text: 'halo' }), { params: Promise.resolve({ id: 'conv_test' }) })

    expect(runBotForConversation).not.toHaveBeenCalled()
  })

  it('rejects an empty body', async () => {
    const res = await POST(req({ text: '' }), { params: Promise.resolve({ id: 'conv_test' }) })
    expect(res.status).toBe(400)
    expect(mockPrisma.conversation.findUniqueOrThrow).not.toHaveBeenCalled()
  })
})
