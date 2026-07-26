import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { ingestMetaMessage } from './inbound'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
})

const samplePayload = {
  entry: [{
    changes: [{
      value: {
        contacts: [{ profile: { name: 'Bruno Figarola' }, wa_id: '6281234567890' }],
        messages: [{
          id: 'wamid.ABC123',
          from: '6281234567890',
          timestamp: '1700000000',
          type: 'text',
          text: { body: 'Halo, mau tanya paket Ijen' },
        }],
      },
    }],
  }],
}

describe('ingestMetaMessage', () => {
  it('creates Contact, Conversation, and Message when none exist', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null)
    mockPrisma.contact.upsert.mockResolvedValue({ id: 'contact_1', phone: '6281234567890', name: 'Bruno Figarola', avatarUrl: null, source: null, createdAt: new Date() })
    mockPrisma.conversation.upsert.mockResolvedValue({ id: 'conv_1', contactId: 'contact_1', botEnabled: true, assignedAgentId: null, status: 'OPEN', pipelineStage: 'new', bookingData: null, bookingCheckedAt: null, tripBrief: null, lastMessageAt: new Date(), createdAt: new Date() })
    mockPrisma.message.create.mockResolvedValue({} as never)

    const result = await ingestMetaMessage(samplePayload)

    expect(result.skipped).toBe(false)
    expect(mockPrisma.contact.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { phone: '6281234567890' },
    }))
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ externalId: 'wamid.ABC123', direction: 'INBOUND', sentBy: 'CUSTOMER' }),
    }))
  })

  it('skips a message already ingested (retry from Meta)', async () => {
    mockPrisma.message.findUnique.mockResolvedValue({ id: 'msg_existing' } as never)

    const result = await ingestMetaMessage(samplePayload)

    expect(result.skipped).toBe(true)
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
  })
})
