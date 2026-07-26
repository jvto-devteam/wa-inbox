import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { Prisma, type PrismaClient } from '@prisma/client'
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
    mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ coexistBaseUrl: 'http://x' } as never)
    mockPrisma.message.create.mockResolvedValue({} as never)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: null }) }))

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

  it('treats a concurrent duplicate create (P2002 unique constraint) as an idempotent skip', async () => {
    // Simulates two concurrent deliveries of the same Meta webhook retry both passing the
    // findUnique idempotency check (both see null) before either message.create() commits.
    // The DB's @unique constraint on externalId rejects the loser's insert with P2002; the
    // function must swallow that and report a clean skip instead of throwing/500ing.
    mockPrisma.message.findUnique.mockResolvedValue(null)
    mockPrisma.contact.upsert.mockResolvedValue({ id: 'contact_1', phone: '6281234567890', name: 'Bruno Figarola', avatarUrl: null, source: null, createdAt: new Date() })
    mockPrisma.conversation.upsert.mockResolvedValue({ id: 'conv_1', contactId: 'contact_1', botEnabled: true, assignedAgentId: null, status: 'OPEN', pipelineStage: 'new', bookingData: null, bookingCheckedAt: null, tripBrief: null, lastMessageAt: new Date(), createdAt: new Date() })
    mockPrisma.message.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`externalId`)', {
        code: 'P2002',
        clientVersion: '7.9.0',
      })
    )

    const result = await ingestMetaMessage(samplePayload)

    expect(result.skipped).toBe(true)
  })

  it('fetches and stores an avatar URL for a newly created contact', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null)
    mockPrisma.contact.upsert.mockResolvedValue({ id: 'contact_1', phone: '6281234567890', name: 'Bruno Figarola', avatarUrl: null, source: null, createdAt: new Date() })
    mockPrisma.conversation.upsert.mockResolvedValue({ id: 'conv_1' } as never)
    mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ coexistBaseUrl: 'http://localhost:4000' } as never)
    mockPrisma.message.create.mockResolvedValue({} as never)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: 'https://pic.example/x.jpg' }) }))

    await ingestMetaMessage(samplePayload)

    expect(fetch).toHaveBeenCalledWith('http://localhost:4000/api/contact/6281234567890@s.whatsapp.net/avatar')
    expect(mockPrisma.contact.update).toHaveBeenCalledWith({ where: { id: 'contact_1' }, data: { avatarUrl: 'https://pic.example/x.jpg' } })
  })
})
