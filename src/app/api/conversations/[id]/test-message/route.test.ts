import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { scheduleBotRun } from '@/lib/inbound'
import { scheduleBookingExtraction } from '@/lib/booking-actions/schedule'
import { classifyAndStoreTopicLabels } from '@/lib/inbox/topic-labels'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))
vi.mock('@/lib/inbound', () => ({ scheduleBotRun: vi.fn() }))
vi.mock('@/lib/booking-actions/schedule', () => ({ scheduleBookingExtraction: vi.fn() }))
vi.mock('@/lib/inbox/topic-labels', () => ({ classifyAndStoreTopicLabels: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function req(body: unknown) {
  return new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(broadcast).mockReset()
  vi.mocked(scheduleBotRun).mockReset()
  vi.mocked(scheduleBookingExtraction).mockReset()
  vi.mocked(classifyAndStoreTopicLabels).mockReset().mockResolvedValue(null)
})

describe('POST /api/conversations/[id]/test-message', () => {
  it('rejects a conversation that is not isTest, without creating any message', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
      id: 'conv_1', isTest: false, botEnabled: true, contact: { name: 'Bruno' },
    } as never)

    const res = await POST(req({ text: 'halo' }), { params: Promise.resolve({ id: 'conv_1' }) })

    expect(res.status).toBe(403)
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
    expect(scheduleBotRun).not.toHaveBeenCalled()
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
    expect(scheduleBotRun).toHaveBeenCalledWith({ id: 'conv_test', contactName: null }, 'Halo bot')
  })

  it('does not run the bot when botEnabled is false', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
      id: 'conv_test', isTest: true, botEnabled: false, contact: { name: null },
    } as never)
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_1', createdAt: new Date() } as never)

    await POST(req({ text: 'halo' }), { params: Promise.resolve({ id: 'conv_test' }) })

    expect(scheduleBotRun).not.toHaveBeenCalled()
  })

  it('schedules booking extraction for the sandbox message (even with bot off) and survives a throwing scheduler', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
      id: 'conv_test', isTest: true, botEnabled: false, contact: { name: null },
    } as never)
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_1', createdAt: new Date() } as never)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(scheduleBookingExtraction).mockImplementation(() => {
      throw new Error('boom')
    })

    const res = await POST(req({ text: 'ganti hotel' }), { params: Promise.resolve({ id: 'conv_test' }) })

    expect(res.status).toBe(200)
    expect(scheduleBookingExtraction).toHaveBeenCalledWith('conv_test', { text: 'ganti hotel' })
  })

  it('does not schedule extraction for a non-test conversation', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
      id: 'conv_1', isTest: false, botEnabled: true, contact: { name: 'Bruno' },
    } as never)
    await POST(req({ text: 'halo' }), { params: Promise.resolve({ id: 'conv_1' }) })
    expect(scheduleBookingExtraction).not.toHaveBeenCalled()
  })

  it('rejects an empty body', async () => {
    const res = await POST(req({ text: '' }), { params: Promise.resolve({ id: 'conv_test' }) })
    expect(res.status).toBe(400)
    expect(mockPrisma.conversation.findUniqueOrThrow).not.toHaveBeenCalled()
  })

  it('mengklasifikasi pesan sandbox tanpa menunggu, juga saat bot mati', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
      id: 'conv_test', isTest: true, botEnabled: false, contact: { name: null },
    } as never)
    mockPrisma.message.create.mockResolvedValue({
      id: 'msg_1', conversationId: 'conv_test', content: 'Berapa harga Ijen?', createdAt: new Date('2026-08-01T00:00:00Z'),
    } as never)
    vi.mocked(classifyAndStoreTopicLabels).mockReturnValue(new Promise(() => {}))

    const res = await POST(req({ text: 'Berapa harga Ijen?' }), { params: Promise.resolve({ id: 'conv_test' }) })

    expect(res.status).toBe(200)
    expect(classifyAndStoreTopicLabels).toHaveBeenCalledWith('msg_1', 'auto')
  })

  it('kegagalan klasifikasi tidak menggagalkan route', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
      id: 'conv_test', isTest: true, botEnabled: false, contact: { name: null },
    } as never)
    mockPrisma.message.create.mockResolvedValue({
      id: 'msg_1', conversationId: 'conv_test', content: 'Berapa harga Ijen?', createdAt: new Date('2026-08-01T00:00:00Z'),
    } as never)
    vi.mocked(classifyAndStoreTopicLabels).mockRejectedValue(new Error('ollama down'))

    const res = await POST(req({ text: 'Berapa harga Ijen?' }), { params: Promise.resolve({ id: 'conv_test' }) })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(res.status).toBe(200)
    expect(errorSpy).toHaveBeenCalledWith(
      'classifyAndStoreTopicLabels (auto) gagal',
      expect.objectContaining({ messageId: 'msg_1' })
    )
    errorSpy.mockRestore()
  })
})
