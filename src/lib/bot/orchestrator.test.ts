import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { decideAndRespond } from './orchestrator'
import { lookupBooking } from '@/lib/booking/client'
import { checkRouteGate } from './route-gate'
import { classifySalesNeed } from './sales-classifier'
import { processFunnelState } from './funnel'
import { callLLM } from './llm'
import { loadCatalog } from './catalog'

// `vi.mock` factories are hoisted above regular imports and `let`/`const`
// declarations, so the mock instance must be constructed inline inside the
// factory rather than via an outer variable reassigned in `beforeEach` —
// otherwise the factory throws "Cannot access ... before initialization".
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/booking/client')
vi.mock('./route-gate')
vi.mock('./sales-classifier')
vi.mock('./funnel')
vi.mock('./llm')
vi.mock('./catalog')

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  ;(loadCatalog as any).mockReturnValue({ packages: [], syncedAt: null })
  mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
    id: 'conv_1',
    tripBrief: {},
    bookingData: null,
    bookingCheckedAt: null,
    contact: { phone: '6281234567890' },
  } as never)
  mockPrisma.conversation.update.mockResolvedValue({} as never)
})

describe('decideAndRespond', () => {
  it('escalates immediately on complaint keywords, skipping every other check', async () => {
    const result = await decideAndRespond('conv_1', 'Saya mau komplain dan minta refund!')
    expect(result).toEqual({ mode: 'handoff', reason: 'Kata kunci eskalasi terdeteksi' })
    expect(lookupBooking).not.toHaveBeenCalled()
  })

  it('uses Mode 3 (booking_context) when an existing booking is found, skipping the funnel entirely', async () => {
    ;(lookupBooking as any).mockResolvedValue({
      bookingId: 'B1',
      destination: 'Ijen',
      dateStart: '2026-08-01',
      dateEnd: '2026-08-02',
      pax: 2,
      amountPaid: 500000,
      amountDue: 0,
      status: 'confirmed',
    })
    ;(callLLM as any).mockResolvedValue('Booking Anda ke Ijen tanggal 1 Agustus sudah lunas.')

    const result = await decideAndRespond('conv_1', 'Booking saya sudah lunas belum?')

    expect(result.mode).toBe('booking_context')
    expect(processFunnelState).not.toHaveBeenCalled()
    expect(callLLM).toHaveBeenCalledWith(expect.stringContaining('B1'), { forceLocal: true })
  })

  it('handoffs when route gate is not clear and no booking exists', async () => {
    ;(lookupBooking as any).mockResolvedValue(null)
    ;(checkRouteGate as any).mockReturnValue({ status: 'handoff', reason: 'Tidak ada paket terverifikasi' })

    const result = await decideAndRespond('conv_1', 'Saya mau ke Atlantis')

    expect(result).toEqual({ mode: 'handoff', reason: 'Tidak ada paket terverifikasi' })
  })

  it('falls back to handoff if any step throws (fail-safe)', async () => {
    ;(lookupBooking as any).mockRejectedValue(new Error('booking API down'))

    const result = await decideAndRespond('conv_1', 'Halo')

    expect(result.mode).toBe('handoff')
  })

  it('resumes the funnel from the persisted funnelState and persists the new one, instead of always restarting at GREETING', async () => {
    ;(lookupBooking as any).mockResolvedValue(null)
    ;(checkRouteGate as any).mockReturnValue({ status: 'clear' })
    ;(classifySalesNeed as any).mockReturnValue({ job: 'J1', missingInfo: [], needsLiveData: false })
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
      id: 'conv_1',
      tripBrief: { funnelState: 'TANYA_ORIGIN' },
      bookingData: null,
      bookingCheckedAt: null,
      contact: { phone: '6281234567890' },
    } as never)
    ;(processFunnelState as any).mockReturnValue({ reply: 'Rekomendasi untuk Ijen...', nextState: 'REKOMENDASI' })

    const result = await decideAndRespond('conv_1', 'Saya mau ke Ijen')

    expect(processFunnelState).toHaveBeenCalledWith(expect.objectContaining({ currentState: 'TANYA_ORIGIN' }))
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv_1' },
      data: { tripBrief: { funnelState: 'REKOMENDASI' } },
    })
    expect(result).toEqual({ mode: 'funnel', reply: 'Rekomendasi untuk Ijen...', nextState: 'REKOMENDASI' })
  })
})
