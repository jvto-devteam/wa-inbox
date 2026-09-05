/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { checkOutboundSafety, CAMPAIGN_RATE_PER_MINUTE, PROVIDER_FAILURE_THRESHOLD } from './safety-guard'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const base = { conversationId: 'conv_1', contactId: 'contact_1', sentBy: 'AGENT' as const }

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  mockPrisma.contactConsent.findUnique.mockResolvedValue(null as never)
  mockPrisma.conversation.findUnique.mockResolvedValue({ botEnabled: true } as never)
  mockPrisma.message.findFirst.mockResolvedValue(null as never)
  mockPrisma.outboundJob.count.mockResolvedValue(0 as never)
})

describe('consent', () => {
  it('treats a contact with no consent row as opted in', async () => {
    // Every contact that predates this feature has no row. Treating that as opt-out would
    // block the entire contact book the moment this shipped.
    const result = await checkOutboundSafety({ ...base, purpose: 'CAMPAIGN' })
    expect(result.allowed).toBe(true)
    expect(result.warnings).toEqual([])
  })

  it('blocks a campaign to an opted-out contact', async () => {
    mockPrisma.contactConsent.findUnique.mockResolvedValue({ optIn: true, optOut: true } as never)

    const result = await checkOutboundSafety({ ...base, purpose: 'CAMPAIGN' })
    expect(result.allowed).toBe(false)
    expect(result.blockingReason).toContain('opt-out')
  })

  it('treats optIn: false as opted out too', async () => {
    mockPrisma.contactConsent.findUnique.mockResolvedValue({ optIn: false, optOut: false } as never)
    expect((await checkOutboundSafety({ ...base, purpose: 'CAMPAIGN' })).allowed).toBe(false)
  })

  it('warns but does NOT block a 1:1 reply to an opted-out contact', async () => {
    // Guidebook §6.7 acceptance 3 is explicit: manual replies stay possible, with a warning.
    // Blocking an agent from answering a customer who wrote in would be absurd.
    mockPrisma.contactConsent.findUnique.mockResolvedValue({ optIn: true, optOut: true } as never)

    const result = await checkOutboundSafety({ ...base, purpose: 'ONE_TO_ONE' })
    expect(result.allowed).toBe(true)
    expect(result.warnings[0]).toContain('opt-out')
  })
})

describe('agent takeover', () => {
  it('blocks a bot reply once the conversation is no longer bot-driven', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({ botEnabled: false } as never)

    const result = await checkOutboundSafety({ ...base, sentBy: 'BOT', purpose: 'BOT_REPLY' })
    expect(result.allowed).toBe(false)
    expect(result.blockingReason).toContain('diambil alih agent')
  })

  it('does not apply the takeover check to an agent send', async () => {
    // An agent sending in a conversation whose bot is off is the normal case, not a violation.
    mockPrisma.conversation.findUnique.mockResolvedValue({ botEnabled: false } as never)
    expect((await checkOutboundSafety({ ...base, purpose: 'ONE_TO_ONE' })).allowed).toBe(true)
  })
})

describe('duplicate suppression', () => {
  it('blocks a duplicate campaign message', async () => {
    mockPrisma.message.findFirst.mockResolvedValue({ id: 'msg_prev' } as never)

    const result = await checkOutboundSafety({ ...base, messageText: 'Promo!', purpose: 'CAMPAIGN' })
    expect(result.allowed).toBe(false)
    expect(result.blockingReason).toContain('identik')
  })

  it('only WARNS on a duplicate bot reply, never blocks it', async () => {
    // A bot legitimately repeating a short acknowledgment within a minute is plausible.
    // Losing that reply is a worse outcome than the duplicate it would prevent.
    mockPrisma.message.findFirst.mockResolvedValue({ id: 'msg_prev' } as never)

    const result = await checkOutboundSafety({ ...base, sentBy: 'BOT', messageText: 'Baik', purpose: 'BOT_REPLY' })
    expect(result.allowed).toBe(true)
    expect(result.warnings.some((w) => w.includes('identik'))).toBe(true)
  })

  it('scopes the duplicate check to outbound messages in the same conversation', async () => {
    await checkOutboundSafety({ ...base, messageText: 'Halo', purpose: 'ONE_TO_ONE' })
    expect(mockPrisma.message.findFirst.mock.calls[0][0]?.where).toMatchObject({
      conversationId: 'conv_1',
      direction: 'OUTBOUND',
      content: 'Halo',
    })
  })

  it('skips the duplicate check when there is no text (a media-only send)', async () => {
    await checkOutboundSafety({ ...base, purpose: 'ONE_TO_ONE' })
    expect(mockPrisma.message.findFirst).not.toHaveBeenCalled()
  })
})

describe('campaign throttling', () => {
  it('pauses a campaign once the per-minute batch cap is reached', async () => {
    mockPrisma.outboundJob.count.mockResolvedValue(CAMPAIGN_RATE_PER_MINUTE as never)

    const result = await checkOutboundSafety({ ...base, purpose: 'CAMPAIGN' })
    expect(result.allowed).toBe(false)
    expect(result.blockingReason).toContain('per menit')
  })

  it('pauses a campaign when the provider failure rate is elevated', async () => {
    mockPrisma.outboundJob.count
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(PROVIDER_FAILURE_THRESHOLD as never)

    const result = await checkOutboundSafety({ ...base, purpose: 'CAMPAIGN' })
    expect(result.allowed).toBe(false)
    expect(result.blockingReason).toContain('Provider sedang bermasalah')
  })

  it('never throttles a bot reply or a 1:1 send on campaign limits', async () => {
    // Rule 2 (the per-conversation bot cap) is already enforced by rate-limiter.ts before the
    // orchestrator runs. Re-checking it here would double-count the same turn.
    mockPrisma.outboundJob.count.mockResolvedValue(9999 as never)

    expect((await checkOutboundSafety({ ...base, sentBy: 'BOT', purpose: 'BOT_REPLY' })).allowed).toBe(true)
    expect((await checkOutboundSafety({ ...base, purpose: 'ONE_TO_ONE' })).allowed).toBe(true)
    expect(mockPrisma.outboundJob.count).not.toHaveBeenCalled()
  })
})

describe('failure handling', () => {
  it('fails OPEN with a warning when the guard itself cannot run', async () => {
    // Failing closed would turn a database blip into a total outbound outage.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.contactConsent.findUnique.mockRejectedValue(new Error('db down'))

    const result = await checkOutboundSafety({ ...base, purpose: 'ONE_TO_ONE' })
    expect(result.allowed).toBe(true)
    expect(result.warnings.some((w) => w.includes('tidak bisa dijalankan'))).toBe(true)
  })
})
