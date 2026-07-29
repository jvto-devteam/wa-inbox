import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { ingestMetaMessage, type MetaWebhookPayload } from './inbound'
import { decideAndRespond } from '@/lib/bot/orchestrator'
import { sendMessage } from '@/lib/send'
import { broadcast } from '@/lib/realtime'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/bot/orchestrator', () => ({ decideAndRespond: vi.fn() }))
vi.mock('@/lib/send', () => ({ sendMessage: vi.fn() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))
const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
  // decideAndRespond/sendMessage are plain vi.fn() module mocks (not reset by mockReset(mockPrisma)
  // above), so without this their call history leaks across tests and, absent a default resolved
  // value, a pre-existing test with botEnabled: true would crash on `decision.mode` being undefined.
  // 'handoff' is a safe no-op default since it triggers no sendMessage call.
  vi.mocked(decideAndRespond).mockReset().mockResolvedValue({ mode: 'handoff', reason: 'default test stub' })
  vi.mocked(sendMessage).mockReset()
  vi.mocked(broadcast).mockReset()
  // Read by defaultBotEnabled() whenever a new conversation is created, so a brand-new
  // conversation starts in whatever state the global bot mode currently dictates.
  mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ botAutoReplyAll: true } as never)
  // vi.stubGlobal('fetch', ...) is not undone between tests by default, so a leaked stub from a
  // previous test would silently satisfy an avatar fetch a later test never meant to allow.
  vi.unstubAllGlobals()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

const contactRow = {
  id: 'contact_1',
  phone: '6281234567890',
  name: 'Bruno Figarola',
  avatarUrl: null,
  avatarCheckedAt: null,
  source: null,
  createdAt: new Date(),
}

const conversationRow = {
  id: 'conv_1',
  contactId: 'contact_1',
  botEnabled: true,
  assignedAgentId: null,
  status: 'OPEN' as const,
  pipelineStage: 'new',
  bookingData: null,
  bookingCheckedAt: null,
  orderChannel: null,
  tripBrief: null,
  lastMessageAt: new Date(),
  lastReadAt: null,
  createdAt: new Date(),
}

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

/** Stubs the happy path everything-exists case so individual tests only override what they care about. */
function stubHappyPath(overrides: { contact?: object; conversation?: object } = {}) {
  mockPrisma.message.findUnique.mockResolvedValue(null)
  mockPrisma.contact.upsert.mockResolvedValue({ ...contactRow, avatarUrl: 'x', ...overrides.contact } as never)
  mockPrisma.conversation.upsert.mockResolvedValue({ ...conversationRow, ...overrides.conversation } as never)
  mockPrisma.message.create.mockResolvedValue({ id: 'msg_new' } as never)
}

describe('ingestMetaMessage', () => {
  it('creates Contact, Conversation, and Message when none exist', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null)
    mockPrisma.contact.upsert.mockResolvedValue(contactRow)
    mockPrisma.conversation.upsert.mockResolvedValue(conversationRow)
    mockPrisma.waNumber.findFirst.mockResolvedValue({ coexistBaseUrl: 'http://x' } as never)
    mockPrisma.message.create.mockResolvedValue({} as never)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: null }) }))

    const result = await ingestMetaMessage(samplePayload)

    expect(result).toEqual({ processed: 1, skipped: 0, statusUpdates: 0, templateStatusUpdates: 0, echoed: 0 })
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

    expect(result).toEqual({ processed: 0, skipped: 1, statusUpdates: 0, templateStatusUpdates: 0, echoed: 0 })
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
  })

  it('treats a concurrent duplicate create (P2002 unique constraint) as an idempotent skip', async () => {
    // Simulates two concurrent deliveries of the same Meta webhook retry both passing the
    // findUnique idempotency check (both see null) before either message.create() commits.
    // The DB's @unique constraint on externalId rejects the loser's insert with P2002; the
    // function must swallow that and report a clean skip instead of throwing/500ing.
    mockPrisma.message.findUnique.mockResolvedValue(null)
    mockPrisma.contact.upsert.mockResolvedValue({ ...contactRow, avatarUrl: 'x' })
    mockPrisma.conversation.upsert.mockResolvedValue(conversationRow)
    mockPrisma.message.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`externalId`)', {
        code: 'P2002',
        clientVersion: '7.9.0',
      })
    )

    const result = await ingestMetaMessage(samplePayload)

    expect(result).toEqual({ processed: 0, skipped: 1, statusUpdates: 0, templateStatusUpdates: 0, echoed: 0 })
  })
})

describe('ingestMetaMessage batching', () => {
  // Meta's Cloud API batches: entry, changes and messages are all arrays and a single
  // webhook delivery routinely carries several messages. Reading index [0] at each level
  // dropped everything after the first while still answering 200 -- so Meta never retried
  // and the extra customer messages were lost permanently and invisibly.
  const twoMessagePayload = {
    entry: [{
      changes: [{
        value: {
          contacts: [{ profile: { name: 'Bruno Figarola' }, wa_id: '6281234567890' }],
          messages: [
            { id: 'wamid.ONE', from: '6281234567890', timestamp: '1700000000', type: 'text', text: { body: 'Halo' } },
            { id: 'wamid.TWO', from: '6281234567890', timestamp: '1700000005', type: 'text', text: { body: 'Masih ada slot?' } },
          ],
        },
      }],
    }],
  }

  it('ingests every message in a batched delivery, not just the first', async () => {
    stubHappyPath({ conversation: { botEnabled: false } })

    const result = await ingestMetaMessage(twoMessagePayload)

    expect(result).toEqual({ processed: 2, skipped: 0, statusUpdates: 0, templateStatusUpdates: 0, echoed: 0 })
    const externalIds = mockPrisma.message.create.mock.calls.map((c) => (c[0] as { data: { externalId?: string } }).data.externalId)
    expect(externalIds).toEqual(['wamid.ONE', 'wamid.TWO'])
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ externalId: 'wamid.TWO', content: 'Masih ada slot?', direction: 'INBOUND' }),
    }))
  })

  it('iterates multiple entries and multiple changes, sourcing the profile name from each change', async () => {
    stubHappyPath({ conversation: { botEnabled: false } })

    const result = await ingestMetaMessage({
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ profile: { name: 'Bruno' }, wa_id: '628111' }],
                messages: [{ id: 'wamid.A', from: '628111', timestamp: '1700000000', type: 'text', text: { body: 'a' } }],
              },
            },
            {
              value: {
                contacts: [{ profile: { name: 'Ayu' }, wa_id: '628222' }],
                messages: [{ id: 'wamid.B', from: '628222', timestamp: '1700000001', type: 'text', text: { body: 'b' } }],
              },
            },
          ],
        },
        {
          changes: [
            {
              value: {
                contacts: [{ profile: { name: 'Citra' }, wa_id: '628333' }],
                messages: [{ id: 'wamid.C', from: '628333', timestamp: '1700000002', type: 'text', text: { body: 'c' } }],
              },
            },
          ],
        },
      ],
    })

    expect(result.processed).toBe(3)
    // The profile name must come from the SAME change as the message -- a hoisted
    // contacts[0] would label every contact 'Bruno'.
    expect(mockPrisma.contact.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { phone: '628222' },
      create: { phone: '628222', name: 'Ayu' },
    }))
    expect(mockPrisma.contact.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { phone: '628333' },
      create: { phone: '628333', name: 'Citra' },
    }))
  })

  it('tolerates a payload with no entry/changes/messages at all', async () => {
    const result = await ingestMetaMessage({})
    expect(result).toEqual({ processed: 0, skipped: 0, statusUpdates: 0, templateStatusUpdates: 0, echoed: 0 })
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
  })
})

describe('ingestMetaMessage timestamp handling', () => {
  it('falls back to the current time when the Meta timestamp is missing or garbage', async () => {
    // Number(undefined) / Number('not-a-number') is NaN -> `Invalid Date`, which Prisma
    // rejects on write, failing ingestion of an otherwise perfectly good message.
    stubHappyPath({ conversation: { botEnabled: false } })

    const before = Date.now()
    await ingestMetaMessage({
      entry: [{ changes: [{ value: { messages: [{ id: 'wamid.BAD', from: '628111', timestamp: 'garbage', type: 'text', text: { body: 'hi' } }] } }] }],
    })

    const createdAt = (mockPrisma.message.create.mock.calls[0][0] as { data: { createdAt: Date } }).data.createdAt
    expect(Number.isNaN(createdAt.getTime())).toBe(false)
    expect(createdAt.getTime()).toBeGreaterThanOrEqual(before)
  })
})

describe('ingestMetaMessage media messages', () => {
  it('stores mediaId, mimeType, and the caption as content for an inbound image', async () => {
    stubHappyPath({ conversation: { botEnabled: false } })

    await ingestMetaMessage({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.IMG1',
              from: '6281234567890',
              timestamp: '1700000000',
              type: 'image',
              image: { id: 'media_123', mime_type: 'image/jpeg', caption: 'Ini paketnya ya' },
            }],
          },
        }],
      }],
    })

    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'image',
        content: 'Ini paketnya ya',
        mediaId: 'media_123',
        mimeType: 'image/jpeg',
        fileName: null,
      }),
    }))
  })

  it('stores the filename for an inbound document, with null content when there is no caption', async () => {
    stubHappyPath({ conversation: { botEnabled: false } })

    await ingestMetaMessage({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.DOC1',
              from: '6281234567890',
              timestamp: '1700000000',
              type: 'document',
              document: { id: 'media_456', mime_type: 'application/pdf', filename: 'itinerary.pdf' },
            }],
          },
        }],
      }],
    })

    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'document',
        content: null,
        mediaId: 'media_456',
        mimeType: 'application/pdf',
        fileName: 'itinerary.pdf',
      }),
    }))
  })

  it('does not invoke the bot for an image message even when it has a caption', async () => {
    // Wave 2's `botCanAnswer` check is keyed off `message.type === 'text'`; a captioned photo
    // must not be treated as a question the bot should answer.
    stubHappyPath({ conversation: { botEnabled: true } })

    await ingestMetaMessage({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.IMG2',
              from: '6281234567890',
              timestamp: '1700000000',
              type: 'image',
              image: { id: 'media_789', mime_type: 'image/jpeg', caption: 'Paket Ijen berapa harganya?' },
            }],
          },
        }],
      }],
    })

    expect(decideAndRespond).not.toHaveBeenCalled()
  })

  it('leaves mediaId/mimeType/fileName null for an ordinary text message', async () => {
    stubHappyPath({ conversation: { botEnabled: false } })

    await ingestMetaMessage(samplePayload)

    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mediaId: null, mimeType: null, fileName: null }),
    }))
  })
})

describe('ingestMetaMessage quoted replies', () => {
  it('resolves context.id to the local parent message and stores it as replyToId', async () => {
    stubHappyPath({ conversation: { botEnabled: false } })
    mockPrisma.message.findUnique
      .mockResolvedValueOnce(null) // idempotency check for the new message itself
      .mockResolvedValueOnce({ id: 'msg_parent' } as never) // lookup of the quoted parent

    await ingestMetaMessage({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.REPLY1',
              from: '6281234567890',
              timestamp: '1700000000',
              type: 'text',
              text: { body: 'Iya benar' },
              context: { id: 'wamid.PARENT' },
            }],
          },
        }],
      }],
    })

    expect(mockPrisma.message.findUnique).toHaveBeenCalledWith({ where: { externalId: 'wamid.PARENT' } })
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ replyToId: 'msg_parent' }),
      include: { replyTo: true },
    }))
  })

  it('stores a null replyToId when the quoted parent was never ingested locally', async () => {
    stubHappyPath({ conversation: { botEnabled: false } })
    mockPrisma.message.findUnique
      .mockResolvedValueOnce(null) // idempotency check
      .mockResolvedValueOnce(null) // parent lookup: not found

    await ingestMetaMessage({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.REPLY2',
              from: '6281234567890',
              timestamp: '1700000000',
              type: 'text',
              text: { body: 'Balasan ke pesan lama' },
              context: { id: 'wamid.UNKNOWN' },
            }],
          },
        }],
      }],
    })

    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ replyToId: null }),
    }))
  })

  it('does not look up a parent at all for an ordinary (non-reply) message', async () => {
    stubHappyPath({ conversation: { botEnabled: false } })

    await ingestMetaMessage(samplePayload)

    // Only the idempotency check -- no second findUnique for a context that doesn't exist.
    expect(mockPrisma.message.findUnique).toHaveBeenCalledTimes(1)
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ replyToId: null }),
    }))
  })
})

describe('ingestMetaMessage avatar enrichment', () => {
  it('fetches and stores an avatar URL for a newly created contact', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null)
    mockPrisma.contact.upsert.mockResolvedValue(contactRow)
    mockPrisma.conversation.upsert.mockResolvedValue({ ...conversationRow, botEnabled: false })
    mockPrisma.waNumber.findFirst.mockResolvedValue({ coexistBaseUrl: 'http://localhost:4000' } as never)
    mockPrisma.message.create.mockResolvedValue({} as never)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: 'https://pic.example/x.jpg' }) }))

    await ingestMetaMessage(samplePayload)

    expect(fetch).toHaveBeenCalledWith('http://localhost:4000/api/contact/6281234567890@s.whatsapp.net/avatar')
    expect(mockPrisma.contact.update).toHaveBeenCalledWith({
      where: { id: 'contact_1' },
      data: expect.objectContaining({ avatarUrl: 'https://pic.example/x.jpg', avatarCheckedAt: expect.any(Date) }),
    })
  })

  it('still ingests the message when no WaNumber row exists (un-seeded environment)', async () => {
    // Regression: the WaNumber lookup used to be a findFirstOrThrow OUTSIDE the try/catch
    // that was supposed to make avatar enrichment non-fatal, so a fresh environment 500'd
    // every inbound webhook and never ingested a single message.
    mockPrisma.message.findUnique.mockResolvedValue(null)
    mockPrisma.contact.upsert.mockResolvedValue(contactRow)
    mockPrisma.conversation.upsert.mockResolvedValue({ ...conversationRow, botEnabled: false })
    mockPrisma.waNumber.findFirst.mockResolvedValue(null)
    mockPrisma.message.create.mockResolvedValue({} as never)

    const result = await ingestMetaMessage(samplePayload)

    expect(result.processed).toBe(1)
    expect(mockPrisma.message.create).toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalled()
  })

  it('does not store an avatar (and warns) when wa-coexist answers non-OK', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null)
    mockPrisma.contact.upsert.mockResolvedValue(contactRow)
    mockPrisma.conversation.upsert.mockResolvedValue({ ...conversationRow, botEnabled: false })
    mockPrisma.waNumber.findFirst.mockResolvedValue({ coexistBaseUrl: 'http://x' } as never)
    mockPrisma.message.create.mockResolvedValue({} as never)
    // A 404 HTML error page: res.json() would throw and be swallowed with zero operator signal.
    const jsonSpy = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: jsonSpy }))

    const result = await ingestMetaMessage(samplePayload)

    expect(result.processed).toBe(1)
    expect(jsonSpy).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalled()
    expect(mockPrisma.contact.update).toHaveBeenCalledWith({
      where: { id: 'contact_1' },
      data: { avatarCheckedAt: expect.any(Date) },
    })
  })

  it('ignores a malformed avatar response body instead of writing garbage to the DB', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null)
    mockPrisma.contact.upsert.mockResolvedValue(contactRow)
    mockPrisma.conversation.upsert.mockResolvedValue({ ...conversationRow, botEnabled: false })
    mockPrisma.waNumber.findFirst.mockResolvedValue({ coexistBaseUrl: 'http://x' } as never)
    mockPrisma.message.create.mockResolvedValue({} as never)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: { nested: 'not a string' } }) }))

    await ingestMetaMessage(samplePayload)

    expect(mockPrisma.contact.update).toHaveBeenCalledWith({
      where: { id: 'contact_1' },
      data: { avatarCheckedAt: expect.any(Date) },
    })
  })

  it('does not re-check a contact whose avatar was checked recently (negative cache)', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null)
    mockPrisma.contact.upsert.mockResolvedValue({ ...contactRow, avatarUrl: null, avatarCheckedAt: new Date(Date.now() - 60_000) })
    mockPrisma.conversation.upsert.mockResolvedValue({ ...conversationRow, botEnabled: false })
    mockPrisma.message.create.mockResolvedValue({} as never)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await ingestMetaMessage(samplePayload)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mockPrisma.contact.update).not.toHaveBeenCalled()
  })

  it('re-checks a contact whose avatar check is older than the 24h window', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null)
    mockPrisma.contact.upsert.mockResolvedValue({
      ...contactRow,
      avatarUrl: null,
      avatarCheckedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    })
    mockPrisma.conversation.upsert.mockResolvedValue({ ...conversationRow, botEnabled: false })
    mockPrisma.waNumber.findFirst.mockResolvedValue({ coexistBaseUrl: 'http://x' } as never)
    mockPrisma.message.create.mockResolvedValue({} as never)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: 'https://pic.example/new.jpg' }) }))

    await ingestMetaMessage(samplePayload)

    expect(fetch).toHaveBeenCalled()
  })
})

describe('ingestMetaMessage bot dispatch', () => {
  it('calls the bot orchestrator and sends its reply when the conversation has botEnabled', async () => {
    stubHappyPath()
    vi.mocked(decideAndRespond).mockResolvedValue({ mode: 'faq', draft: 'Info paket...', sourceTopic: 'inclusions' })

    await ingestMetaMessage(samplePayload)

    expect(decideAndRespond).toHaveBeenCalledWith('conv_1', 'Halo, mau tanya paket Ijen')
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv_1', text: 'Info paket...', sentBy: 'BOT' }))
  })

  it('does not call the orchestrator when botEnabled is false', async () => {
    stubHappyPath({ conversation: { botEnabled: false } })

    await ingestMetaMessage(samplePayload)

    expect(decideAndRespond).not.toHaveBeenCalled()
  })

  it('does not invoke the bot for a non-text message', async () => {
    // A photo/audio/location message carries no question. Passing '' to the orchestrator
    // made Mode 3 (booking_context) generate an LLM answer to an empty prompt -- an
    // automated reply to a message the bot never actually read.
    stubHappyPath()

    const result = await ingestMetaMessage({
      entry: [{
        changes: [{
          value: {
            contacts: [{ profile: { name: 'Bruno Figarola' }, wa_id: '6281234567890' }],
            messages: [{ id: 'wamid.IMG', from: '6281234567890', timestamp: '1700000000', type: 'image' }],
          },
        }],
      }],
    })

    // The message itself is still ingested and broadcast -- it shows up in the inbox
    // like any other unanswered customer message.
    expect(result.processed).toBe(1)
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ externalId: 'wamid.IMG', type: 'image', direction: 'INBOUND' }),
    }))
    expect(decideAndRespond).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
    // No handoff-alert machinery either: a customer sending a photo is not a bot failure.
    expect(mockPrisma.message.create).toHaveBeenCalledTimes(1)
    expect(broadcast).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'handoff.alert' }))
  })

  it('does not invoke the bot for a text message whose body is whitespace only', async () => {
    stubHappyPath()

    await ingestMetaMessage({
      entry: [{
        changes: [{
          value: {
            messages: [{ id: 'wamid.WS', from: '6281234567890', timestamp: '1700000000', type: 'text', text: { body: '   ' } }],
          },
        }],
      }],
    })

    expect(decideAndRespond).not.toHaveBeenCalled()
  })

  it('logs a handoff decision without sending anything to the customer', async () => {
    // Safety-critical invariant: a handoff decision must never produce an outbound WhatsApp
    // dispatch — the conversation just waits for a human. This guards against a regression that
    // calls sendMessage() (which always dispatches via sendMetaText/sendCoexistText) unconditionally,
    // or that broadens the mode-matching condition to accidentally include 'handoff'. The decision
    // must still be logged (content: null, sentBy: 'BOT', botTrace set) so it shows up in the bot
    // audit log — it's just never sent to sendMessage().
    stubHappyPath()
    const decision = { mode: 'handoff' as const, reason: 'Kata kunci eskalasi terdeteksi' }
    vi.mocked(decideAndRespond).mockResolvedValue(decision)

    await ingestMetaMessage(samplePayload)

    expect(decideAndRespond).toHaveBeenCalledWith('conv_1', 'Halo, mau tanya paket Ijen')
    expect(sendMessage).not.toHaveBeenCalled()
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        conversationId: 'conv_1',
        content: null,
        sentBy: 'BOT',
        botTrace: decision,
        deliveryStatus: 'SENT',
        direction: 'OUTBOUND',
      }),
    }))
  })

  it('turns the bot off on the conversation when it hands off to a human', async () => {
    // Without this, the conversation stays bot-driven: it never reaches the dashboard's
    // "needs attention" widget (botEnabled: false, assignedAgentId: null) and every further
    // customer message re-runs the same decision and re-fires handoff.alert.
    stubHappyPath()
    vi.mocked(decideAndRespond).mockResolvedValue({ mode: 'handoff', reason: 'Kata kunci eskalasi terdeteksi' })

    await ingestMetaMessage(samplePayload)

    expect(mockPrisma.conversation.update).toHaveBeenCalledWith({ where: { id: 'conv_1' }, data: { botEnabled: false } })
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'handoff.alert', conversationId: 'conv_1' }))
  })

  it('does not re-invoke the orchestrator for a second message once a handoff disabled the bot', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null)
    mockPrisma.contact.upsert.mockResolvedValue({ ...contactRow, avatarUrl: 'x' })
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_new' } as never)
    // First message: bot still on. Second message reads back the conversation the handoff
    // just disabled — the existing `if (conversation.botEnabled)` gate must now skip it.
    mockPrisma.conversation.upsert
      .mockResolvedValueOnce({ ...conversationRow, botEnabled: true })
      .mockResolvedValueOnce({ ...conversationRow, botEnabled: false })
    vi.mocked(decideAndRespond).mockResolvedValue({ mode: 'handoff', reason: 'Kata kunci eskalasi terdeteksi' })

    await ingestMetaMessage({
      entry: [{
        changes: [{
          value: {
            contacts: [{ profile: { name: 'Bruno Figarola' }, wa_id: '6281234567890' }],
            messages: [
              { id: 'wamid.ONE', from: '6281234567890', timestamp: '1700000000', type: 'text', text: { body: 'refund dong' } },
              { id: 'wamid.TWO', from: '6281234567890', timestamp: '1700000005', type: 'text', text: { body: 'halo?' } },
            ],
          },
        }],
      }],
    })

    expect(decideAndRespond).toHaveBeenCalledTimes(1)
    expect(mockPrisma.conversation.update).toHaveBeenCalledTimes(1)
    // Exactly one handoff alert for two inbound messages.
    const alerts = vi.mocked(broadcast).mock.calls.filter(([e]) => e.type === 'handoff.alert')
    expect(alerts).toHaveLength(1)
  })

  it('always disables the bot per-conversation and logs an audit row on handoff -- the global bot mode never reaches this far', async () => {
    // Settings.botAutoReplyAll only ever affects conversation.botEnabled (bulk-written by
    // src/app/api/bot/mode/route.ts, and read fresh for brand-new conversations) -- by the time
    // decideAndRespond returns a handoff, this function has no idea (and no need to know)
    // whether that was due to the global mode or an ordinary per-conversation reason. Every
    // handoff always flips botEnabled off and always logs the placeholder.
    stubHappyPath()
    vi.mocked(decideAndRespond).mockResolvedValue({ mode: 'handoff', reason: 'Kata kunci eskalasi terdeteksi' })

    await ingestMetaMessage(samplePayload)

    expect(mockPrisma.conversation.update).toHaveBeenCalledWith({ where: { id: 'conv_1' }, data: { botEnabled: false } })
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'handoff.alert' }))
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sentBy: 'BOT', content: null, direction: 'OUTBOUND' }),
    }))
  })
})

describe('ingestMetaMessage delivery-status callbacks', () => {
  function statusPayload(entries: Array<{ id: string; status: string }>) {
    return { entry: [{ changes: [{ value: { statuses: entries.map((e) => ({ ...e, recipient_id: '6281234567890' })) } }] }] }
  }

  it('updates an existing outbound message to DELIVERED', async () => {
    mockPrisma.message.findUnique.mockResolvedValue({ id: 'msg_1', deliveryStatus: 'SENT' } as never)
    mockPrisma.message.update.mockResolvedValue({ id: 'msg_1', conversationId: 'conv_1', deliveryStatus: 'DELIVERED' } as never)

    const result = await ingestMetaMessage(statusPayload([{ id: 'wamid.OUT1', status: 'delivered' }]))

    expect(result.statusUpdates).toBe(1)
    expect(mockPrisma.message.findUnique).toHaveBeenCalledWith({ where: { externalId: 'wamid.OUT1' } })
    expect(mockPrisma.message.update).toHaveBeenCalledWith({ where: { id: 'msg_1' }, data: { deliveryStatus: 'DELIVERED' } })
    expect(broadcast).toHaveBeenCalledWith({
      type: 'message.updated',
      conversationId: 'conv_1',
      message: { id: 'msg_1', conversationId: 'conv_1', deliveryStatus: 'DELIVERED', mediaUrl: null },
    })
  })

  it('updates a message to FAILED on an asynchronous delivery failure', async () => {
    // The business-impact case: sendMessage() recorded SENT from the synchronous API call,
    // but Meta later failed to deliver (invalid number, closed 24h window, rejected template).
    mockPrisma.message.findUnique.mockResolvedValue({ id: 'msg_2', deliveryStatus: 'SENT' } as never)
    mockPrisma.message.update.mockResolvedValue({ id: 'msg_2', conversationId: 'conv_1', deliveryStatus: 'FAILED' } as never)

    const result = await ingestMetaMessage(statusPayload([{ id: 'wamid.OUT2', status: 'failed' }]))

    expect(result.statusUpdates).toBe(1)
    expect(mockPrisma.message.update).toHaveBeenCalledWith({ where: { id: 'msg_2' }, data: { deliveryStatus: 'FAILED' } })
  })

  it('is a silent no-op for a status referencing a message this system never sent', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null)

    const result = await ingestMetaMessage(statusPayload([{ id: 'wamid.UNKNOWN', status: 'read' }]))

    expect(result).toEqual({ processed: 0, skipped: 0, statusUpdates: 0, templateStatusUpdates: 0, echoed: 0 })
    expect(mockPrisma.message.update).not.toHaveBeenCalled()
  })

  it('never walks a message backwards when receipts arrive out of order', async () => {
    // Meta does not guarantee ordering between status callbacks.
    mockPrisma.message.findUnique.mockResolvedValue({ id: 'msg_3', deliveryStatus: 'READ' } as never)

    const result = await ingestMetaMessage(statusPayload([{ id: 'wamid.OUT3', status: 'sent' }]))

    expect(result.statusUpdates).toBe(0)
    expect(mockPrisma.message.update).not.toHaveBeenCalled()
  })

  it('ignores an unrecognised status string', async () => {
    const result = await ingestMetaMessage(statusPayload([{ id: 'wamid.OUT4', status: 'something_new' }]))

    expect(result.statusUpdates).toBe(0)
    expect(mockPrisma.message.findUnique).not.toHaveBeenCalled()
  })

  it('handles messages and statuses arriving in the same change', async () => {
    mockPrisma.message.findUnique
      .mockResolvedValueOnce(null) // inbound idempotency check
      .mockResolvedValueOnce({ id: 'msg_out', deliveryStatus: 'SENT' } as never) // status lookup
    mockPrisma.contact.upsert.mockResolvedValue({ ...contactRow, avatarUrl: 'x' })
    mockPrisma.conversation.upsert.mockResolvedValue({ ...conversationRow, botEnabled: false })
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_in' } as never)
    mockPrisma.message.update.mockResolvedValue({ id: 'msg_out', conversationId: 'conv_1', deliveryStatus: 'READ' } as never)

    const result = await ingestMetaMessage({
      entry: [{
        changes: [{
          value: {
            contacts: [{ profile: { name: 'Bruno Figarola' }, wa_id: '6281234567890' }],
            messages: [{ id: 'wamid.IN', from: '6281234567890', timestamp: '1700000000', type: 'text', text: { body: 'halo' } }],
            statuses: [{ id: 'wamid.OUT', status: 'read' }],
          },
        }],
      }],
    })

    expect(result).toEqual({ processed: 1, skipped: 0, statusUpdates: 1, templateStatusUpdates: 0, echoed: 0 })
  })
})

describe('ingestMetaMessage template-status callbacks', () => {
  // Meta's message_template_status_update change: the fields sit flat on `value`,
  // and the change carries neither messages nor statuses.
  function templatePayload(value: Record<string, unknown>) {
    return { entry: [{ changes: [{ field: 'message_template_status_update', value }] }] }
  }

  it('reconciles an APPROVED verdict onto the Template row matching metaId', async () => {
    // The whole point of storing metaId: Meta approves hours after submission, so
    // without this the row is stuck at the PENDING the submission response returned.
    mockPrisma.template.updateMany.mockResolvedValue({ count: 1 } as never)

    const result = await ingestMetaMessage(templatePayload({
      event: 'APPROVED',
      message_template_id: 671551331431970,
      message_template_name: 'booking_confirmation',
      message_template_language: 'id',
      reason: 'NONE',
    }))

    expect(result.templateStatusUpdates).toBe(1)
    expect(mockPrisma.template.updateMany).toHaveBeenCalledWith({
      // Meta sends the id as a number; Template.metaId is a string column.
      where: { metaId: '671551331431970', metaStatus: { not: 'APPROVED' } },
      data: { metaStatus: 'APPROVED' },
    })
  })

  it('reconciles a REJECTED verdict', async () => {
    mockPrisma.template.updateMany.mockResolvedValue({ count: 1 } as never)

    const result = await ingestMetaMessage(templatePayload({
      event: 'REJECTED',
      message_template_id: '990',
      reason: 'INVALID_FORMAT',
    }))

    expect(result.templateStatusUpdates).toBe(1)
    expect(mockPrisma.template.updateMany).toHaveBeenCalledWith({
      where: { metaId: '990', metaStatus: { not: 'REJECTED' } },
      data: { metaStatus: 'REJECTED' },
    })
  })

  it('ignores a verdict this schema cannot express rather than mislabelling it', async () => {
    // PAUSED/DISABLED/FLAGGED have no TemplateMetaStatus member. NOT_APPLICABLE means
    // "never submitted to Meta", so writing it here would be actively wrong.
    const result = await ingestMetaMessage(templatePayload({ event: 'PAUSED', message_template_id: '991' }))

    expect(result.templateStatusUpdates).toBe(0)
    expect(mockPrisma.template.updateMany).not.toHaveBeenCalled()
  })

  it('is a silent no-op for a verdict about a template this system never submitted', async () => {
    mockPrisma.template.updateMany.mockResolvedValue({ count: 0 } as never)

    const result = await ingestMetaMessage(templatePayload({ event: 'APPROVED', message_template_id: '992' }))

    expect(result).toEqual({ processed: 0, skipped: 0, statusUpdates: 0, templateStatusUpdates: 0, echoed: 0 })
  })

  it('does not treat a template change as a message change', async () => {
    mockPrisma.template.updateMany.mockResolvedValue({ count: 1 } as never)

    await ingestMetaMessage(templatePayload({ event: 'APPROVED', message_template_id: '993' }))

    expect(mockPrisma.message.create).not.toHaveBeenCalled()
    expect(mockPrisma.contact.upsert).not.toHaveBeenCalled()
  })

  it('still ingests ordinary message changes batched alongside a template change', async () => {
    mockPrisma.template.updateMany.mockResolvedValue({ count: 1 } as never)
    mockPrisma.message.findUnique.mockResolvedValue(null)
    mockPrisma.contact.upsert.mockResolvedValue({ ...contactRow, avatarUrl: 'x' })
    mockPrisma.conversation.upsert.mockResolvedValue({ ...conversationRow, botEnabled: false })
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_in' } as never)

    const result = await ingestMetaMessage({
      entry: [{
        changes: [
          { field: 'message_template_status_update', value: { event: 'APPROVED', message_template_id: '994' } },
          {
            field: 'messages',
            value: {
              contacts: [{ profile: { name: 'Bruno Figarola' }, wa_id: '6281234567890' }],
              messages: [{ id: 'wamid.IN', from: '6281234567890', timestamp: '1700000000', type: 'text', text: { body: 'halo' } }],
            },
          },
        ],
      }],
    })

    expect(result).toEqual({ processed: 1, skipped: 0, statusUpdates: 0, templateStatusUpdates: 1, echoed: 0 })
  })
})

describe('ingestMetaMessage message echoes (smb_message_echoes)', () => {
  function echoPayload(echoes: Array<Record<string, unknown>>): MetaWebhookPayload {
    return { entry: [{ changes: [{ field: 'smb_message_echoes', value: { message_echoes: echoes as never } }] }] }
  }

  it('stores an echoed text message as an OUTBOUND/AGENT message keyed to the customer (echo.to), not echo.from', async () => {
    stubHappyPath()

    const result = await ingestMetaMessage(echoPayload([{
      id: 'wamid.ECHO1',
      from: '622244788833',
      to: '6281234567890',
      timestamp: '1700000000',
      type: 'text',
      text: { body: 'Halo, ini info yang Anda minta.' },
    }]))

    expect(result).toEqual({ processed: 0, skipped: 0, statusUpdates: 0, templateStatusUpdates: 0, echoed: 1 })
    expect(mockPrisma.contact.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { phone: '6281234567890' } }))
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        externalId: 'wamid.ECHO1',
        direction: 'OUTBOUND',
        sentBy: 'AGENT',
        channel: 'UNOFFICIAL',
        content: 'Halo, ini info yang Anda minta.',
        deliveryStatus: 'SENT',
      }),
    }))
  })

  it('does not invoke the bot orchestrator for an echoed message', async () => {
    stubHappyPath({ conversation: { botEnabled: true } })

    await ingestMetaMessage(echoPayload([{
      id: 'wamid.ECHO2', from: '622244788833', to: '6281234567890', timestamp: '1700000000', type: 'text', text: { body: 'Halo' },
    }]))

    expect(decideAndRespond).not.toHaveBeenCalled()
  })

  it('skips an already-ingested echo (idempotent retry)', async () => {
    mockPrisma.message.findUnique.mockResolvedValue({ id: 'msg_existing' } as never)

    const result = await ingestMetaMessage(echoPayload([{
      id: 'wamid.ECHO3', from: '622244788833', to: '6281234567890', timestamp: '1700000000', type: 'text', text: { body: 'x' },
    }]))

    expect(result.echoed).toBe(0)
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
  })

  it('stores media fields for an echoed image with a caption', async () => {
    stubHappyPath()

    await ingestMetaMessage(echoPayload([{
      id: 'wamid.ECHO4', from: '622244788833', to: '6281234567890', timestamp: '1700000000', type: 'image',
      image: { id: 'media_1', mime_type: 'image/jpeg', caption: 'Ini paketnya' },
    }]))

    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'image', content: 'Ini paketnya', mediaId: 'media_1', mimeType: 'image/jpeg' }),
    }))
  })

  it('ignores a revoke echo without creating a Message row', async () => {
    stubHappyPath()

    const result = await ingestMetaMessage(echoPayload([{
      id: 'wamid.ECHO5', from: '622244788833', to: '6281234567890', timestamp: '1700000000', type: 'revoke',
      revoke: { original_message_id: 'wamid.ORIGINAL' },
    }]))

    expect(result.echoed).toBe(0)
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
  })

  it('ignores an edit echo without creating a Message row', async () => {
    stubHappyPath()

    const result = await ingestMetaMessage(echoPayload([{
      id: 'wamid.ECHO6', from: '622244788833', to: '6281234567890', timestamp: '1700000000', type: 'edit',
      edit: { original_message_id: 'wamid.ORIGINAL' },
    }]))

    expect(result.echoed).toBe(0)
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
  })

  it('treats a concurrent duplicate echo create (P2002) as an idempotent skip', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null)
    mockPrisma.contact.upsert.mockResolvedValue({ ...contactRow, avatarUrl: 'x' })
    mockPrisma.conversation.upsert.mockResolvedValue(conversationRow)
    mockPrisma.message.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`externalId`)', {
        code: 'P2002',
        clientVersion: '7.9.0',
      })
    )

    const result = await ingestMetaMessage(echoPayload([{
      id: 'wamid.ECHO7', from: '622244788833', to: '6281234567890', timestamp: '1700000000', type: 'text', text: { body: 'x' },
    }]))

    expect(result.echoed).toBe(0)
  })
})
