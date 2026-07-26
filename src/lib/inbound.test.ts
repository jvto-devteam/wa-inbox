import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { ingestMetaMessage } from './inbound'
import { decideAndRespond } from '@/lib/bot/orchestrator'
import { sendMessage } from '@/lib/send'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/bot/orchestrator', () => ({ decideAndRespond: vi.fn() }))
vi.mock('@/lib/send', () => ({ sendMessage: vi.fn() }))
const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
  // decideAndRespond/sendMessage are plain vi.fn() module mocks (not reset by mockReset(mockPrisma)
  // above), so without this their call history leaks across tests and, absent a default resolved
  // value, a pre-existing test with botEnabled: true would crash on `decision.mode` being undefined.
  // 'handoff' is a safe no-op default since it triggers no sendMessage call.
  vi.mocked(decideAndRespond).mockReset().mockResolvedValue({ mode: 'handoff', reason: 'default test stub' })
  vi.mocked(sendMessage).mockReset()
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

  it('calls the bot orchestrator and sends its reply when the conversation has botEnabled', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null)
    mockPrisma.contact.upsert.mockResolvedValue({ id: 'contact_1', avatarUrl: 'x' } as never)
    mockPrisma.conversation.upsert.mockResolvedValue({ id: 'conv_1', botEnabled: true } as never)
    mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ coexistBaseUrl: 'http://x' } as never)
    mockPrisma.message.create.mockResolvedValue({} as never)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: null }) }))
    ;(decideAndRespond as any).mockResolvedValue({ mode: 'faq', draft: 'Info paket...', sourceTopic: 'inclusions' })

    await ingestMetaMessage(samplePayload)

    expect(decideAndRespond).toHaveBeenCalledWith('conv_1', 'Halo, mau tanya paket Ijen')
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv_1', text: 'Info paket...', sentBy: 'BOT' }))
  })

  it('does not call the orchestrator when botEnabled is false', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null)
    mockPrisma.contact.upsert.mockResolvedValue({ id: 'contact_1', avatarUrl: 'x' } as never)
    mockPrisma.conversation.upsert.mockResolvedValue({ id: 'conv_1', botEnabled: false } as never)
    mockPrisma.message.create.mockResolvedValue({} as never)

    await ingestMetaMessage(samplePayload)

    expect(decideAndRespond).not.toHaveBeenCalled()
  })
})
