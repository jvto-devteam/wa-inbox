import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { GET } from './route'

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

describe('GET /api/conversations', () => {
  it('returns conversations ordered by lastMessageAt desc, with contact + last message + labels', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([{
      id: 'conv_1',
      botEnabled: true,
      status: 'OPEN',
      pipelineStage: 'nego',
      lastMessageAt: new Date('2026-07-25T10:00:00Z'),
      contact: { name: 'Bruno Figarola', phone: '6281234567890' },
      messages: [{ content: 'Halo!', sentBy: 'CUSTOMER', createdAt: new Date() }],
      labels: [{ label: { id: 'lbl_1', name: 'Confirmed Booking', color: '#3C6B42' } }],
    }] as never)

    const res = await GET(new Request('http://localhost/api/conversations'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body[0]).toEqual(expect.objectContaining({
      id: 'conv_1',
      contactName: 'Bruno Figarola',
      contactPhone: '6281234567890',
      lastMessage: 'Halo!',
      lastMessageSentBy: 'CUSTOMER',
      botEnabled: true,
      pipelineStage: 'nego',
      labels: [{ id: 'lbl_1', name: 'Confirmed Booking', color: '#3C6B42' }],
    }))
  })

  it('surfaces the last message sender as null when a conversation has no messages yet', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([{
      id: 'conv_2',
      botEnabled: true,
      status: 'OPEN',
      lastMessageAt: new Date('2026-07-25T10:00:00Z'),
      contact: { name: null, phone: '6281234567891' },
      messages: [],
      labels: [],
    }] as never)

    const res = await GET(new Request('http://localhost/api/conversations'))
    const body = await res.json()

    expect(body[0]).toEqual(expect.objectContaining({ lastMessage: null, lastMessageSentBy: null }))
  })

  it('filters by a search query matching contact name or message content', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([] as never)
    await GET(new Request('http://localhost/api/conversations?q=ijen'))
    expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          expect.objectContaining({ contact: expect.objectContaining({ name: { contains: 'ijen', mode: 'insensitive' } }) }),
          expect.objectContaining({ messages: expect.objectContaining({ some: { content: { contains: 'ijen', mode: 'insensitive' } } }) }),
        ]),
      }),
    }))
  })

  it('treats a whitespace-only q as no search, returning the unfiltered list', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([] as never)
    await GET(new Request('http://localhost/api/conversations?q=%20%20'))
    expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: undefined,
    }))
  })

  it('includes each conversation\'s unread inbound message count, counted since its own lastReadAt', async () => {
    const lastReadAt = new Date('2026-07-26T00:00:00Z')
    mockPrisma.conversation.findMany.mockResolvedValue([
      { id: 'conv_1', botEnabled: true, status: 'OPEN', lastMessageAt: new Date(), lastReadAt, contact: { name: 'A', phone: '1' }, messages: [], labels: [] },
      { id: 'conv_2', botEnabled: true, status: 'OPEN', lastMessageAt: new Date(), lastReadAt: null, contact: { name: 'B', phone: '2' }, messages: [], labels: [] },
    ] as never)
    mockPrisma.message.count.mockResolvedValueOnce(2).mockResolvedValueOnce(0)

    const res = await GET(new Request('http://localhost/api/conversations'))
    const body = await res.json()

    expect(body[0].unreadCount).toBe(2)
    expect(body[1].unreadCount).toBe(0)
    expect(mockPrisma.message.count).toHaveBeenNthCalledWith(1, {
      where: { conversationId: 'conv_1', direction: 'INBOUND', createdAt: { gt: lastReadAt } },
    })
    // A conversation never opened before (lastReadAt: null) must count every inbound message,
    // not silently report zero -- `gt: null` in Prisma would match nothing.
    expect(mockPrisma.message.count).toHaveBeenNthCalledWith(2, {
      where: { conversationId: 'conv_2', direction: 'INBOUND', createdAt: { gt: expect.any(Date) } },
    })
  })
})
