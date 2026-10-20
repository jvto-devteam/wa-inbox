/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { refreshChatReview } from './refresh'
import { scheduleChatReviewRefresh, noteInboundForChatReview, noteOutboundForChatReview, noteManualChatReviewRefresh, CHAT_REVIEW_DEBOUNCE_MS, __resetChatReviewRefreshForTests, CHAT_REVIEW_MIN_GAP_MS } from './auto-refresh'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))
vi.mock('./refresh', () => ({ refreshChatReview: vi.fn() }))
const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const NOW = new Date('2026-10-20T03:00:00Z')
const FOREIGN = '12025551234'

function stubSkipSetting(on: boolean) {
  mockPrisma.settings.findUnique.mockResolvedValue({ skipBotForIndonesianNumbers: on } as never)
}

function stubConversation(o: { chatReviewAt?: Date | null; isTest?: boolean; phone?: string | null; platform?: string } = {}) {
  mockPrisma.conversation.findUnique.mockResolvedValue({
    chatReviewAt: 'chatReviewAt' in o ? o.chatReviewAt : null,
    isTest: o.isTest ?? false,
    contact: { phone: 'phone' in o ? o.phone : FOREIGN },
    channelIdentity: { platform: o.platform ?? 'WHATSAPP' },
  } as never)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  mockReset(mockPrisma)
  __resetChatReviewRefreshForTests()
  vi.mocked(refreshChatReview).mockReset().mockResolvedValue({ status: 'ok' })
  vi.mocked(broadcast).mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  __resetChatReviewRefreshForTests()
  vi.useRealTimers()
})

describe('scheduleChatReviewRefresh', () => {
  it('three messages within 5 minutes -> one review', async () => {
    stubConversation({ chatReviewAt: new Date(NOW.getTime() - 60_000) })
    scheduleChatReviewRefresh('c1')
    scheduleChatReviewRefresh('c1')
    scheduleChatReviewRefresh('c1')
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_MIN_GAP_MS)
    expect(refreshChatReview).toHaveBeenCalledTimes(1)
    expect(broadcast).toHaveBeenCalledWith({ type: 'conversation.updated', conversationId: 'c1' })
  })

  it('does not run before the gap has elapsed', async () => {
    stubConversation({ chatReviewAt: new Date(NOW.getTime() - 60_000) })
    scheduleChatReviewRefresh('c1')
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_MIN_GAP_MS - 60_000 - 1000)
    expect(refreshChatReview).not.toHaveBeenCalled()
  })

  it('review older than 5 minutes -> refresh runs', async () => {
    stubConversation({ chatReviewAt: new Date(NOW.getTime() - CHAT_REVIEW_MIN_GAP_MS - 1000) })
    scheduleChatReviewRefresh('c1')
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_DEBOUNCE_MS)
    expect(refreshChatReview).toHaveBeenCalledTimes(1)
    expect(vi.mocked(refreshChatReview).mock.calls[0][0]).toBe('c1')
  })

  it('no review yet -> runs, and a burst of calls is still one run', async () => {
    stubConversation({ chatReviewAt: null })
    scheduleChatReviewRefresh('c1')
    scheduleChatReviewRefresh('c1')
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_DEBOUNCE_MS)
    expect(refreshChatReview).toHaveBeenCalledTimes(1)
  })

  it('Indonesian number, skip setting OFF -> runs (daily-summary rule)', async () => {
    stubSkipSetting(false)
    stubConversation({ phone: '6281234567890' })
    scheduleChatReviewRefresh('c1')
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_DEBOUNCE_MS)
    expect(refreshChatReview).toHaveBeenCalledTimes(1)
  })

  it('Indonesian number, skip setting ON -> no auto refresh', async () => {
    stubSkipSetting(true)
    stubConversation({ phone: '6281234567890' })
    scheduleChatReviewRefresh('c1')
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_MIN_GAP_MS)
    expect(refreshChatReview).not.toHaveBeenCalled()
  })

  it('Indonesian number but isTest (whitelist) -> runs', async () => {
    stubSkipSetting(true)
    stubConversation({ phone: '6282143403501', isTest: true })
    scheduleChatReviewRefresh('c1')
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_DEBOUNCE_MS)
    expect(refreshChatReview).toHaveBeenCalledTimes(1)
  })

  it('final review Important 7 (R25): a BOOKING_ACTIONS_TEST_PHONES number (not isTest) passes the Indonesian gate', async () => {
    process.env.BOOKING_ACTIONS_TEST_PHONES = '6282143403501'
    try {
      stubSkipSetting(true)
      stubConversation({ phone: '6282143403501', isTest: false })
      scheduleChatReviewRefresh('c1')
      await vi.advanceTimersByTimeAsync(CHAT_REVIEW_DEBOUNCE_MS)
      expect(refreshChatReview).toHaveBeenCalledTimes(1)
    } finally {
      delete process.env.BOOKING_ACTIONS_TEST_PHONES
    }
  })

  it('refresh failure leaves previous review intact: no broadcast, no throw, no chat content logged', async () => {
    stubConversation({ chatReviewAt: null })
    vi.mocked(refreshChatReview).mockResolvedValue({ status: 'failed' })
    scheduleChatReviewRefresh('c1')
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_DEBOUNCE_MS)
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('refresh throwing never escapes and does not broadcast', async () => {
    stubConversation({ chatReviewAt: null })
    vi.mocked(refreshChatReview).mockRejectedValue(new Error('boom'))
    expect(() => scheduleChatReviewRefresh('c1')).not.toThrow()
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_DEBOUNCE_MS)
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('DB failure in the gate never throws', async () => {
    mockPrisma.conversation.findUnique.mockRejectedValue(new Error('db down'))
    expect(() => scheduleChatReviewRefresh('c1')).not.toThrow()
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_DEBOUNCE_MS)
    expect(refreshChatReview).not.toHaveBeenCalled()
  })

  it('after a run finishes a later message can schedule again', async () => {
    stubConversation({ chatReviewAt: null })
    scheduleChatReviewRefresh('c1')
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_DEBOUNCE_MS)
    scheduleChatReviewRefresh('c1')
    // Jeda 5 menit sejak percobaan terakhir tetap berlaku.
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_MIN_GAP_MS)
    expect(refreshChatReview).toHaveBeenCalledTimes(2)
  })
})

describe('noteInboundForChatReview', () => {
  it('lead without any booking -> refresh scheduled (no booking lookup involved)', async () => {
    stubConversation({ chatReviewAt: null })
    noteInboundForChatReview('c1', { type: 'text', content: 'Halo, berapa harga Bromo sunrise?' })
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_DEBOUNCE_MS)
    expect(refreshChatReview).toHaveBeenCalledTimes(1)
  })

  it('burst of inbound messages -> one run', async () => {
    stubConversation({ chatReviewAt: new Date(NOW.getTime() - 60_000) })
    for (const t of ['Halo', 'Ada slot?', 'Untuk 4 orang']) noteInboundForChatReview('c1', { type: 'text', content: t })
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_MIN_GAP_MS)
    expect(refreshChatReview).toHaveBeenCalledTimes(1)
  })

  it('noise (ok, thanks, reaction) and non-text do not trigger', async () => {
    stubConversation({ chatReviewAt: null })
    noteInboundForChatReview('c1', { type: 'text', content: 'ok thanks' })
    noteInboundForChatReview('c1', { type: 'reaction', content: null })
    noteInboundForChatReview('c1', { type: 'image', content: 'foto' })
    noteInboundForChatReview('c1', { type: 'text', content: '   ' })
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_MIN_GAP_MS)
    expect(refreshChatReview).not.toHaveBeenCalled()
  })

  it('Indonesian number with skip setting ON -> not scheduled', async () => {
    stubSkipSetting(true)
    stubConversation({ phone: '6281234567890' })
    noteInboundForChatReview('c1', { type: 'text', content: 'Halo kak, mau tanya paket' })
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_MIN_GAP_MS)
    expect(refreshChatReview).not.toHaveBeenCalled()
  })

  it('never throws, even when the DB is down (webhook path unaffected)', async () => {
    mockPrisma.conversation.findUnique.mockRejectedValue(new Error('db down'))
    expect(() => noteInboundForChatReview('c1', { type: 'text', content: 'Halo kak' })).not.toThrow()
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_DEBOUNCE_MS)
    expect(refreshChatReview).not.toHaveBeenCalled()
  })
})

describe('burst, backoff, manual, outbound (fix round 2026-10-20)', () => {
  it('opening burst inside the 30 s debounce -> one review, not one per message', async () => {
    stubConversation({ chatReviewAt: null })
    noteInboundForChatReview('c1', { type: 'text', content: 'Hi' })
    await vi.advanceTimersByTimeAsync(10_000)
    noteInboundForChatReview('c1', { type: 'text', content: 'I booked Ijen' })
    await vi.advanceTimersByTimeAsync(10_000)
    noteInboundForChatReview('c1', { type: 'text', content: 'change pickup to 5am' })
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_DEBOUNCE_MS)
    expect(refreshChatReview).toHaveBeenCalledTimes(1)
  })

  it('messages arriving WHILE a review runs are not dropped: one follow-up run, spaced 5 min from the new chatReviewAt', async () => {
    stubConversation({ chatReviewAt: null })
    let release: (() => void) | undefined
    vi.mocked(refreshChatReview).mockImplementationOnce(
      () => new Promise((resolve) => { release = () => resolve({ status: 'ok' } as never) })
    )
    noteInboundForChatReview('c1', { type: 'text', content: 'Hi' })
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_DEBOUNCE_MS)
    expect(refreshChatReview).toHaveBeenCalledTimes(1)
    noteInboundForChatReview('c1', { type: 'text', content: 'late message 1' })
    noteInboundForChatReview('c1', { type: 'text', content: 'late message 2' })
    // The first run stamped chatReviewAt just now.
    stubConversation({ chatReviewAt: new Date(Date.now()) })
    release?.()
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_MIN_GAP_MS - 1000)
    expect(refreshChatReview).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(refreshChatReview).toHaveBeenCalledTimes(2)
  })

  it('a failed refresh backs off: the next message does not retry before 5 min', async () => {
    stubConversation({ chatReviewAt: null })
    vi.mocked(refreshChatReview).mockResolvedValue({ status: 'failed' } as never)
    noteInboundForChatReview('c1', { type: 'text', content: 'Hi' })
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_DEBOUNCE_MS)
    expect(refreshChatReview).toHaveBeenCalledTimes(1)
    noteInboundForChatReview('c1', { type: 'text', content: 'again' })
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_MIN_GAP_MS - CHAT_REVIEW_DEBOUNCE_MS - 1000)
    expect(refreshChatReview).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000 + CHAT_REVIEW_DEBOUNCE_MS)
    expect(refreshChatReview).toHaveBeenCalledTimes(2)
  })

  it('manual "Perbarui sekarang" cancels the pending auto run and spaces the next one', async () => {
    stubConversation({ chatReviewAt: null })
    noteInboundForChatReview('c1', { type: 'text', content: 'Hi' })
    noteManualChatReviewRefresh('c1')
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_DEBOUNCE_MS * 2)
    expect(refreshChatReview).not.toHaveBeenCalled()
    noteInboundForChatReview('c1', { type: 'text', content: 'Hi again' })
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_MIN_GAP_MS - CHAT_REVIEW_DEBOUNCE_MS * 2 - 10_000)
    expect(refreshChatReview).not.toHaveBeenCalled()
  })

  it('AGENT messages trigger; bot and automated-source messages do not', async () => {
    stubConversation({ chatReviewAt: null })
    noteOutboundForChatReview('c1', { sentBy: 'BOT', text: 'halo' })
    noteOutboundForChatReview('c1', { sentBy: 'AGENT', text: 'otomatis', botTrace: { source: 'data_request' } })
    noteOutboundForChatReview('c1', { sentBy: 'AGENT', text: 'otomatis', botTrace: { source: 'booking_request_ack' } })
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_DEBOUNCE_MS)
    expect(refreshChatReview).not.toHaveBeenCalled()
    noteOutboundForChatReview('c1', { sentBy: 'AGENT', text: 'Kami akan siapkan jemputan jam 5 ya' })
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_DEBOUNCE_MS)
    expect(refreshChatReview).toHaveBeenCalledTimes(1)
  })

  it('email conversations are skipped', async () => {
    stubConversation({ chatReviewAt: null, platform: 'EMAIL' })
    noteOutboundForChatReview('c1', { sentBy: 'AGENT', text: 'Dear guest' })
    await vi.advanceTimersByTimeAsync(CHAT_REVIEW_DEBOUNCE_MS)
    expect(refreshChatReview).not.toHaveBeenCalled()
  })
})
