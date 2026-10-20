/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { createPipelineTracer } from '@/lib/pipeline/tracer'
import { scheduleChatReviewRefresh } from '@/lib/chat-review/auto-refresh'
import { extractBookingSignals } from './extract'
import { applyExtraction, reevaluateBookingActions } from './store'
import { autoApplyCreated } from './auto-apply'
import { scheduleBookingExtraction, __resetBookingExtractionForTests, BOOKING_EXTRACTION_DEBOUNCE_MS } from './schedule'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))
vi.mock('@/lib/chat-review/auto-refresh', () => ({ scheduleChatReviewRefresh: vi.fn() }))
vi.mock('./extract', () => ({ extractBookingSignals: vi.fn() }))
vi.mock('./store', () => ({ applyExtraction: vi.fn(), reevaluateBookingActions: vi.fn() }))
vi.mock('./auto-apply', () => ({ autoApplyCreated: vi.fn().mockResolvedValue(undefined) }))
const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const FOREIGN = '12025551234'
const EXTRACTION = { changes: [], facts: [] }

function stubConversation(overrides: { bookingData?: unknown; isTest?: boolean; phone?: string | null } = {}) {
  mockPrisma.conversation.findUnique.mockResolvedValue({
    bookingData: 'bookingData' in overrides ? overrides.bookingData : { id: 'B1', date: { end_ymd: '2999-01-01' } },
    isTest: overrides.isTest ?? false,
    contact: { phone: 'phone' in overrides ? overrides.phone : FOREIGN },
  } as never)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-20T03:00:00Z'))
  mockReset(mockPrisma)
  __resetBookingExtractionForTests()
  vi.mocked(extractBookingSignals).mockReset().mockResolvedValue(EXTRACTION as never)
  vi.mocked(applyExtraction).mockReset().mockResolvedValue({ created: 0, changeIds: [], changeEvents: [] })
  vi.mocked(reevaluateBookingActions).mockReset().mockResolvedValue({ resolved: 0, opened: 0 })
  mockPrisma.message.findMany.mockResolvedValue([
    { id: 'm1', direction: 'INBOUND', sentBy: 'CUSTOMER', type: 'text', content: 'tolong ganti hotel', createdAt: new Date() },
  ] as never)
  vi.mocked(broadcast).mockReset()
  vi.mocked(scheduleChatReviewRefresh).mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  // Perilaku sesudah rollout dibuka (R25); gerbang rollout diuji tersendiri.
  process.env.BOOKING_ACTIONS_ROLLOUT = 'all'
})
afterEach(() => {
  delete process.env.BOOKING_ACTIONS_ROLLOUT
  delete process.env.BOOKING_ACTIONS_TEST_PHONES
  __resetBookingExtractionForTests()
  vi.useRealTimers()
})

async function fire() {
  await vi.advanceTimersByTimeAsync(BOOKING_EXTRACTION_DEBOUNCE_MS)
}

describe('scheduleBookingExtraction', () => {
  it('does NOT schedule the chat-review refresh itself (the inbound path does; avoids double scheduling)', async () => {
    stubConversation()
    scheduleBookingExtraction('c1', { text: 'tolong ganti hotel' })
    await fire()
    expect(scheduleChatReviewRefresh).not.toHaveBeenCalled()
  })

  it('runs extract -> apply -> reevaluate (independent of botEnabled: never read)', async () => {
    stubConversation()
    scheduleBookingExtraction('c1', { text: 'tolong ganti hotel' })
    expect(extractBookingSignals).not.toHaveBeenCalled()
    await fire()
    expect(extractBookingSignals).toHaveBeenCalledTimes(1)
    expect(applyExtraction).toHaveBeenCalledWith('c1', EXTRACTION)
    expect(reevaluateBookingActions).toHaveBeenCalledWith('c1')
    expect(mockPrisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }))
  })

  it('final review minor: only INBOUND message ids are passed as valid sources', async () => {
    stubConversation()
    mockPrisma.message.findMany.mockResolvedValue([
      { id: 'm2', direction: 'OUTBOUND', sentBy: 'AGENT', type: 'text', content: 'jemput jam 9 ya', createdAt: new Date() },
      { id: 'm1', direction: 'INBOUND', sentBy: 'CUSTOMER', type: 'text', content: 'bisa jemput jam 10?', createdAt: new Date() },
    ] as never)
    scheduleBookingExtraction('c1', { text: 'bisa jemput jam 10?' })
    await fire()
    const arg = vi.mocked(extractBookingSignals).mock.calls[0][0]
    expect([...(arg.inboundIds ?? [])]).toEqual(['m1'])
    expect(arg.transcript.ids).toEqual(['m1', 'm2'])
  })

  it("final review Important 7 (R25): rollout 'test' (default) skips a normal guest; runs for isTest and for a test phone even though it is Indonesian", async () => {
    delete process.env.BOOKING_ACTIONS_ROLLOUT
    stubConversation()
    scheduleBookingExtraction('c1', { text: 'ganti hotel' })
    await fire()
    expect(extractBookingSignals).not.toHaveBeenCalled()

    process.env.BOOKING_ACTIONS_TEST_PHONES = '6282143403501'
    stubConversation({ phone: '6282143403501' })
    scheduleBookingExtraction('c1', { text: 'ganti hotel' })
    await fire()
    expect(extractBookingSignals).toHaveBeenCalledTimes(1)

    stubConversation({ isTest: true, phone: '__bot_test__' })
    scheduleBookingExtraction('c1', { text: 'ganti hotel' })
    await fire()
    expect(extractBookingSignals).toHaveBeenCalledTimes(2)

    // Nomor Indonesia lain tetap dilewati.
    stubConversation({ phone: '6281234567890' })
    scheduleBookingExtraction('c1', { text: 'ganti hotel' })
    await fire()
    expect(extractBookingSignals).toHaveBeenCalledTimes(2)
  })

  it('skips Indonesian number even when skipBotForIndonesianNumbers=false (never consults settings)', async () => {
    stubConversation({ phone: '6281234567890' })
    scheduleBookingExtraction('c1', { text: 'ganti hotel' })
    await fire()
    expect(extractBookingSignals).not.toHaveBeenCalled()
    expect(mockPrisma.settings.findUnique).not.toHaveBeenCalled()
  })

  it('skips Indonesian number found only at flush time (no phone given by caller)', async () => {
    stubConversation({ phone: '6281234567890' })
    scheduleBookingExtraction('c1')
    await fire()
    expect(extractBookingSignals).not.toHaveBeenCalled()
  })

  it('skips when trip ended (end_ymd < today WIB)', async () => {
    stubConversation({ bookingData: { id: 'B1', date: { end_ymd: '2026-10-19' } } })
    scheduleBookingExtraction('c1')
    await fire()
    expect(extractBookingSignals).not.toHaveBeenCalled()
  })

  it('runs when trip ends today (WIB)', async () => {
    stubConversation({ bookingData: { id: 'B1', date: { end_ymd: '2026-10-20' } } })
    scheduleBookingExtraction('c1')
    await fire()
    expect(extractBookingSignals).toHaveBeenCalledTimes(1)
  })

  it('skips without bookingData', async () => {
    stubConversation({ bookingData: null })
    scheduleBookingExtraction('c1')
    await fire()
    expect(extractBookingSignals).not.toHaveBeenCalled()
  })

  it('skips noise message (does not even arm a timer)', async () => {
    stubConversation()
    scheduleBookingExtraction('c1', { text: 'thanks' })
    await fire()
    expect(mockPrisma.conversation.findUnique).not.toHaveBeenCalled()
    expect(extractBookingSignals).not.toHaveBeenCalled()
  })

  it('burst of 3 messages -> one extraction, timer reset by each message', async () => {
    stubConversation()
    scheduleBookingExtraction('c1', { text: 'a b c' })
    await vi.advanceTimersByTimeAsync(5000)
    scheduleBookingExtraction('c1', { text: 'd e f' })
    await vi.advanceTimersByTimeAsync(5000)
    scheduleBookingExtraction('c1', { text: 'g h i' })
    await vi.advanceTimersByTimeAsync(7000)
    expect(extractBookingSignals).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(extractBookingSignals).toHaveBeenCalledTimes(1)
  })

  function sideLaneStatuses(): string[] {
    return vi
      .mocked(broadcast)
      .mock.calls.map(([e]) => e as { type: string; stepId?: string; status?: string })
      .filter((e) => e.type === 'pipeline.step' && e.stepId === 'ekstrak-booking')
      .map((e) => e.status as string)
  }

  it('extractor returns null -> side run closed as gagal, nothing stored, never throws', async () => {
    stubConversation()
    vi.mocked(extractBookingSignals).mockResolvedValue(null)
    scheduleBookingExtraction('c1')
    await fire()
    expect(applyExtraction).not.toHaveBeenCalled()
    expect(sideLaneStatuses()).toEqual(['mulai', 'gagal'])
  })

  it('store throws -> swallowed, side run gagal, log carries no message content', async () => {
    stubConversation()
    vi.mocked(applyExtraction).mockRejectedValue(new Error('db down'))
    scheduleBookingExtraction('c1')
    await expect(fire()).resolves.toBeUndefined()
    expect(sideLaneStatuses()).toEqual(['mulai', 'gagal'])
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('tolong ganti hotel')
  })

  it('hands the CHANGE cards created by this extraction to auto-apply (after reevaluate)', async () => {
    stubConversation()
    const events = ['a1', 'a2'].map((id) => ({ kind: 'CHANGE' as const, conversationId: 'c1', bookingCode: null, summary: 's', actionId: id, messageId: null }))
    vi.mocked(applyExtraction).mockResolvedValue({ created: 2, changeIds: ['a1', 'a2'], changeEvents: events })
    scheduleBookingExtraction('c1')
    await fire()
    expect(autoApplyCreated).toHaveBeenCalledWith(events)
  })

  it('still hands the events to auto-apply when reevaluate throws (so the admin is notified)', async () => {
    stubConversation()
    const events = [{ kind: 'CHANGE' as const, conversationId: 'c1', bookingCode: null, summary: 's', actionId: 'a1', messageId: null }]
    vi.mocked(applyExtraction).mockResolvedValue({ created: 1, changeIds: ['a1'], changeEvents: events })
    vi.mocked(reevaluateBookingActions).mockRejectedValue(new Error('db'))
    scheduleBookingExtraction('c1')
    await fire()
    expect(autoApplyCreated).toHaveBeenCalledWith(events)
  })

  it('success closes the side run as selesai; skips close it as dilewati', async () => {
    stubConversation()
    scheduleBookingExtraction('c1')
    await fire()
    expect(sideLaneStatuses()).toEqual(['mulai', 'selesai'])
    vi.mocked(broadcast).mockClear()
    stubConversation({ bookingData: null })
    scheduleBookingExtraction('c1')
    await fire()
    expect(sideLaneStatuses()).toEqual(['mulai', 'dilewati'])
  })

  it('isTest conversation with an Indonesian phone (whitelist number) DOES run (R13)', async () => {
    stubConversation({ isTest: true, phone: '6282143403501' })
    scheduleBookingExtraction('c1')
    await fire()
    expect(extractBookingSignals).toHaveBeenCalledTimes(1)
  })

  it('does not touch an open step of the bot run tracer', async () => {
    const botTracer = createPipelineTracer('c1', 'bot-run')
    botTracer.mark('susun-balasan', 'mulai')
    const before = botTracer.snapshot()
    stubConversation()
    scheduleBookingExtraction('c1')
    await fire()
    expect(botTracer.snapshot()).toEqual(before)
    // Dan step bot itu masih bisa ditutup 'gagal' oleh pemiliknya.
    botTracer.closeOpen('gagal')
    expect(botTracer.snapshot().at(-1)).toMatchObject({ stepId: 'susun-balasan', status: 'gagal' })
    const botEvents = vi
      .mocked(broadcast)
      .mock.calls.map(([e]) => e as { runId?: string; stepId?: string; status?: string })
      .filter((e) => e.runId === 'bot-run' && e.stepId === 'susun-balasan')
    expect(botEvents.map((e) => e.status)).toEqual(['mulai', 'gagal'])
  })

  it('never throws synchronously', () => {
    expect(() => scheduleBookingExtraction('c1')).not.toThrow()
  })
})
