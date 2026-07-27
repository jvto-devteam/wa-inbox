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
import { checkDeploymentGate } from './deployment-gate'

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
vi.mock('./deployment-gate')

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  ;(loadCatalog as any).mockReturnValue({ packages: [], syncedAt: null })
  // Default: gate open, so pre-existing Mode 1/2 tests (written before the
  // deployment-gate wiring fix) don't have to know about it unless they're
  // specifically testing gate behavior.
  ;(checkDeploymentGate as any).mockReturnValue({ readyForApproval: true, blocking: [] })
  // Default: kill switch off, so pre-existing tests (written before Task 33's
  // kill-switch wiring) don't have to know about it unless they're
  // specifically testing kill-switch behavior.
  mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ botKillSwitch: false } as never)
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
  it('hands off unconditionally when the bot kill switch is on, before even the escalation-keyword check', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ botKillSwitch: true } as never)

    const result = await decideAndRespond('conv_1', 'Halo, saya mau tanya paket ke Ijen')

    expect(result).toEqual({ mode: 'handoff', reason: 'Bot dimatikan sementara (kill switch aktif)', cause: 'kill_switch' })
    expect(mockPrisma.conversation.findUniqueOrThrow).not.toHaveBeenCalled()
    expect(lookupBooking).not.toHaveBeenCalled()
  })

  it('hands off via the kill switch even for Mode 3 (booking_context) messages, unlike the deployment gate which leaves Mode 3 untouched', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ botKillSwitch: true } as never)
    ;(lookupBooking as any).mockResolvedValue({ id: 'B1', guest: 'Bruno' })

    const result = await decideAndRespond('conv_1', 'Booking saya sudah lunas belum?')

    expect(result).toEqual({ mode: 'handoff', reason: 'Bot dimatikan sementara (kill switch aktif)', cause: 'kill_switch' })
    expect(lookupBooking).not.toHaveBeenCalled()
    expect(callLLM).not.toHaveBeenCalled()
  })

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

  it('hands off on classification job J5 (e.g. cancellation/payment-status) even when the message misses the orchestrator\'s own narrow ESCALATION_KEYWORDS', async () => {
    ;(lookupBooking as any).mockResolvedValue(null)
    ;(checkRouteGate as any).mockReturnValue({ status: 'clear' })
    // "cancel" / "status pembayaran" do not appear in ESCALATION_KEYWORDS
    // (komplain, refund, bicara dengan manusia, agen manusia, cs manusia),
    // so the pre-DB keyword check must NOT catch this on its own — only
    // classifySalesNeed's job==='J5' signal should route it to handoff.
    ;(classifySalesNeed as any).mockReturnValue({ job: 'J5', missingInfo: [], needsLiveData: false })

    const result = await decideAndRespond('conv_1', 'Saya mau cancel booking saya, status pembayaran gimana ya')

    expect(result.mode).toBe('handoff')
    expect(processFunnelState).not.toHaveBeenCalled()
  })

  it('hands off Mode 1/2 when the deployment gate is not ready for approval, citing the blocking reasons', async () => {
    ;(lookupBooking as any).mockResolvedValue(null)
    ;(checkDeploymentGate as any).mockReturnValue({
      readyForApproval: false,
      blocking: ['core_dataset_not_production_ready'],
    })

    const result = await decideAndRespond('conv_1', 'Halo, saya mau tanya paket ke Ijen')

    expect(result.mode).toBe('handoff')
    expect((result as { mode: 'handoff'; reason: string }).reason).toContain('core_dataset_not_production_ready')
    expect(checkRouteGate).not.toHaveBeenCalled()
  })

  it('leaves Mode 3 (booking_context) unaffected by deployment gate status', async () => {
    ;(checkDeploymentGate as any).mockReturnValue({
      readyForApproval: false,
      blocking: ['core_dataset_not_production_ready'],
    })
    ;(lookupBooking as any).mockResolvedValue({ id: 'B1', guest: 'Bruno' })
    ;(callLLM as any).mockResolvedValue('Booking Anda atas nama Bruno.')

    const result = await decideAndRespond('conv_1', 'Booking saya sudah lunas belum?')

    expect(result.mode).toBe('booking_context')
    expect(checkDeploymentGate).not.toHaveBeenCalled()
  })
})
