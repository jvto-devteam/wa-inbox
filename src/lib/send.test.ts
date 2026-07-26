import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { sendMessage } from './send'
import { sendMetaText } from '@/lib/meta/messages'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/meta/messages', () => ({ sendMetaText: vi.fn() }))
const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
  mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
    id: 'conv_1', contact: { phone: '6281234567890' },
  } as never)
  mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({
    phoneNumberId: 'pnid', accessToken: 'tok',
  } as never)
})

describe('sendMessage', () => {
  it('sends via Official Graph API by default and records a SENT message', async () => {
    vi.mocked(sendMetaText).mockResolvedValue({ externalId: 'wamid.OUT1' })
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_1', deliveryStatus: 'SENT' } as never)

    const result = await sendMessage({ conversationId: 'conv_1', text: 'Halo!', sentBy: 'AGENT', agentId: 'acc_1' })

    expect(result.deliveryStatus).toBe('SENT')
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ channel: 'OFFICIAL', direction: 'OUTBOUND', sentBy: 'AGENT', externalId: 'wamid.OUT1' }),
    }))
  })

  it('records a FAILED message when the send throws, without throwing itself, and logs the error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sendError = new Error('rate limited')
    vi.mocked(sendMetaText).mockRejectedValue(sendError)
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_2', deliveryStatus: 'FAILED' } as never)

    const result = await sendMessage({ conversationId: 'conv_1', text: 'Halo!', sentBy: 'BOT' })

    expect(result.deliveryStatus).toBe('FAILED')
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ deliveryStatus: 'FAILED' }),
    }))
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('sendMessage'),
      expect.objectContaining({ conversationId: 'conv_1', error: sendError })
    )

    consoleErrorSpy.mockRestore()
  })
})
