/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { extractBookingSignals } from './extract'
import { applyExtraction, reevaluateBookingActions } from './store'
import { scheduleBookingExtraction, __resetBookingExtractionForTests, BOOKING_EXTRACTION_DEBOUNCE_MS } from './schedule'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('./extract', () => ({ extractBookingSignals: vi.fn() }))
vi.mock('./store', () => ({ applyExtraction: vi.fn(), reevaluateBookingActions: vi.fn() }))
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
  vi.mocked(applyExtraction).mockReset().mockResolvedValue({ created: 0 })
  vi.mocked(reevaluateBookingActions).mockReset().mockResolvedValue({ resolved: 0, opened: 0 })
  mockPrisma.message.findMany.mockResolvedValue([
    { id: 'm1', direction: 'INBOUND', sentBy: 'CUSTOMER', type: 'text', content: 'tolong ganti hotel', createdAt: new Date() },
  ] as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  __resetBookingExtractionForTests()
  vi.useRealTimers()
})

async function fire() {
  await vi.advanceTimersByTimeAsync(BOOKING_EXTRACTION_DEBOUNCE_MS)
}

describe('scheduleBookingExtraction', () => {
  it('runs extract -> apply -> reevaluate (independent of botEnabled: never read)', async () => {
    stubConversation()
    scheduleBookingExtraction('c1', undefined, { phone: FOREIGN, text: 'tolong ganti hotel' })
    expect(extractBookingSignals).not.toHaveBeenCalled()
    await fire()
    expect(extractBookingSignals).toHaveBeenCalledTimes(1)
    expect(applyExtraction).toHaveBeenCalledWith('c1', EXTRACTION)
    expect(reevaluateBookingActions).toHaveBeenCalledWith('c1')
    expect(mockPrisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }))
  })

  it('skips Indonesian number even when skipBotForIndonesianNumbers=false (never consults settings)', async () => {
    stubConversation({ phone: '6281234567890' })
    scheduleBookingExtraction('c1', undefined, { phone: '6281234567890', text: 'ganti hotel' })
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
    scheduleBookingExtraction('c1', undefined, { phone: FOREIGN })
    await fire()
    expect(extractBookingSignals).not.toHaveBeenCalled()
  })

  it('runs when trip ends today (WIB)', async () => {
    stubConversation({ bookingData: { id: 'B1', date: { end_ymd: '2026-10-20' } } })
    scheduleBookingExtraction('c1', undefined, { phone: FOREIGN })
    await fire()
    expect(extractBookingSignals).toHaveBeenCalledTimes(1)
  })

  it('skips without bookingData and for test conversations', async () => {
    stubConversation({ bookingData: null })
    scheduleBookingExtraction('c1', undefined, { phone: FOREIGN })
    await fire()
    stubConversation({ isTest: true })
    scheduleBookingExtraction('c2', undefined, { phone: FOREIGN })
    await fire()
    expect(extractBookingSignals).not.toHaveBeenCalled()
  })

  it('skips noise message (does not even arm a timer)', async () => {
    stubConversation()
    scheduleBookingExtraction('c1', undefined, { phone: FOREIGN, text: 'thanks' })
    await fire()
    expect(mockPrisma.conversation.findUnique).not.toHaveBeenCalled()
    expect(extractBookingSignals).not.toHaveBeenCalled()
  })

  it('burst of 3 messages -> one extraction, timer reset by each message', async () => {
    stubConversation()
    scheduleBookingExtraction('c1', undefined, { phone: FOREIGN, text: 'a b c' })
    await vi.advanceTimersByTimeAsync(5000)
    scheduleBookingExtraction('c1', undefined, { phone: FOREIGN, text: 'd e f' })
    await vi.advanceTimersByTimeAsync(5000)
    scheduleBookingExtraction('c1', undefined, { phone: FOREIGN, text: 'g h i' })
    await vi.advanceTimersByTimeAsync(7000)
    expect(extractBookingSignals).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(extractBookingSignals).toHaveBeenCalledTimes(1)
  })

  it('extractor returns null -> traced as gagal, nothing stored, never throws', async () => {
    stubConversation()
    vi.mocked(extractBookingSignals).mockResolvedValue(null)
    const mark = vi.fn()
    scheduleBookingExtraction('c1', { mark } as never, { phone: FOREIGN })
    await fire()
    expect(applyExtraction).not.toHaveBeenCalled()
    expect(mark).toHaveBeenCalledWith('ekstrak-booking', 'gagal', expect.anything())
  })

  it('store throws -> swallowed, traced gagal, log carries no message content', async () => {
    stubConversation()
    vi.mocked(applyExtraction).mockRejectedValue(new Error('db down'))
    const mark = vi.fn()
    scheduleBookingExtraction('c1', { mark } as never, { phone: FOREIGN })
    await expect(fire()).resolves.toBeUndefined()
    expect(mark).toHaveBeenCalledWith('ekstrak-booking', 'gagal', expect.anything())
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('tolong ganti hotel')
  })

  it('never throws synchronously, even with a hostile tracer', () => {
    expect(() => scheduleBookingExtraction('c1', { mark: () => { throw new Error('x') } } as never, { phone: FOREIGN })).not.toThrow()
  })
})
