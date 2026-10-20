/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))
vi.mock('@/lib/booking-actions/history', () => ({ recordEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/booking/backoffice-client', () => ({ writeBookingChange: vi.fn(), writeConfigured: vi.fn() }))
vi.mock('@/lib/booking-actions/store', () => ({ reevaluateBookingActions: vi.fn() }))
vi.mock('@/lib/booking-actions/data-requests', () => ({ sendDataRequest: vi.fn() }))
vi.mock('@/lib/booking/client', () => ({ lookupBookingResult: vi.fn() }))

import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { broadcast } from '@/lib/realtime'
import { recordEvent } from '@/lib/booking-actions/history'
import { writeBookingChange, writeConfigured, type WriteResult } from '@/lib/booking/backoffice-client'
import { reevaluateBookingActions } from '@/lib/booking-actions/store'
import { lookupBookingResult, type BookingData } from '@/lib/booking/client'
import { sendDataRequest } from '@/lib/booking-actions/data-requests'
import { PATCH } from './route'

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const req = (body: unknown) =>
  new Request('http://localhost/api/booking-actions/a1', {
    method: 'PATCH', headers: { cookie: 'wa_inbox_session=tok', 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
const ctx = { params: Promise.resolve({ id: 'a1' }) }
const action = (over: Record<string, unknown> = {}) => ({
  id: 'a1', conversationId: 'c1', bookingId: '77', type: 'CHANGE', field: 'pickup_point', proposedValue: 'X', state: 'OPEN', ...over,
})

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(recordEvent).mockClear()
  vi.mocked(broadcast).mockClear()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc1', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) => fn(mockPrisma)) as never)
  mockPrisma.bookingAction.findUnique.mockResolvedValue(action() as never)
  // Critical 1: eksekusi/Batalkan mencari booking segar; bawaan = sama dengan yang tersimpan.
  vi.mocked(lookupBookingResult).mockReset().mockImplementation((async () => {
    const conv = (await mockPrisma.conversation.findUnique({ where: { id: 'c1' } })) as { bookingData?: BookingData | null } | null
    return conv?.bookingData ? { status: 'found', data: conv.bookingData } : { status: 'not_found' }
  }) as never)
  mockPrisma.bookingAction.updateMany.mockResolvedValue({ count: 1 } as never)
})

describe('PATCH /api/booking-actions/[id]', () => {
  it('401 without session', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null)
    expect((await PATCH(req({ op: 'reject' }), ctx)).status).toBe(401)
  })

  it('400 on invalid body', async () => {
    expect((await PATCH(req({ op: 'explode' }), ctx)).status).toBe(400)
  })

  it('404 when action missing', async () => {
    mockPrisma.bookingAction.findUnique.mockResolvedValue(null)
    expect((await PATCH(req({ op: 'reject' }), ctx)).status).toBe(404)
  })

  it('AGENT can reject', async () => {
    expect((await PATCH(req({ op: 'reject' }), ctx)).status).toBe(200)
  })

  it('reject records REJECTED with accountId', async () => {
    await PATCH(req({ op: 'reject', reason: 'salah paham' }), ctx)
    expect(mockPrisma.bookingAction.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', state: 'OPEN' },
      data: expect.objectContaining({ state: 'REJECTED', closedReason: 'REJECTED', closedById: 'acc1', closedAt: expect.any(Date) }),
    })
    expect(recordEvent).toHaveBeenCalledWith(mockPrisma, expect.objectContaining({
      event: 'REJECTED', actor: 'ACCOUNT', accountId: 'acc1', actionId: 'a1', conversationId: 'c1', reason: 'salah paham',
    }))
    expect(broadcast).toHaveBeenCalledWith({ type: 'booking-actions.changed', conversationId: 'c1' })
  })

  it('409 on closed action', async () => {
    mockPrisma.bookingAction.findUnique.mockResolvedValue(action({ state: 'EXECUTED' }) as never)
    expect((await PATCH(req({ op: 'reject' }), ctx)).status).toBe(409)
    expect(recordEvent).not.toHaveBeenCalled()
  })

  it('409 when a concurrent click closed it first (conditional update count 0)', async () => {
    mockPrisma.bookingAction.updateMany.mockResolvedValue({ count: 0 } as never)
    expect((await PATCH(req({ op: 'reject' }), ctx)).status).toBe(409)
    expect(recordEvent).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('dismiss on MISMATCH -> RESOLVED / DISMISSED_CHAT_WRONG', async () => {
    mockPrisma.bookingAction.findUnique.mockResolvedValue(action({ type: 'MISMATCH' }) as never)
    expect((await PATCH(req({ op: 'dismiss' }), ctx)).status).toBe(200)
    expect(mockPrisma.bookingAction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: 'RESOLVED', closedReason: 'DISMISSED_CHAT_WRONG' }),
    }))
    expect(recordEvent).toHaveBeenCalledWith(mockPrisma, expect.objectContaining({ event: 'RESOLVED' }))
  })

  it('done on TASK -> DONE / MARKED_DONE with note; not_needed -> NOT_NEEDED', async () => {
    mockPrisma.bookingAction.findUnique.mockResolvedValue(action({ type: 'TASK' }) as never)
    await PATCH(req({ op: 'done', note: 'sudah di backoffice' }), ctx)
    expect(mockPrisma.bookingAction.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: 'DONE', closedReason: 'MARKED_DONE' }),
    }))
    expect(recordEvent).toHaveBeenLastCalledWith(mockPrisma, expect.objectContaining({ event: 'RESOLVED', reason: 'sudah di backoffice' }))
    await PATCH(req({ op: 'not_needed' }), ctx)
    expect(mockPrisma.bookingAction.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: 'DONE', closedReason: 'NOT_NEEDED' }),
    }))
  })

  it('400 when op does not fit the action type', async () => {
    mockPrisma.bookingAction.findUnique.mockResolvedValue(action({ type: 'MISMATCH' }) as never)
    expect((await PATCH(req({ op: 'reject' }), ctx)).status).toBe(400)
    mockPrisma.bookingAction.findUnique.mockResolvedValue(action({ type: 'CHANGE' }) as never)
    expect((await PATCH(req({ op: 'dismiss' }), ctx)).status).toBe(400)
    mockPrisma.bookingAction.findUnique.mockResolvedValue(action({ type: 'DATA_REQUEST' }) as never)
    expect((await PATCH(req({ op: 'done' }), ctx)).status).toBe(400)
    expect(mockPrisma.bookingAction.updateMany).not.toHaveBeenCalled()
  })

  it('op send -> sendDataRequest as the logged-in account (any role); refusal keeps its status and message', async () => {
    vi.mocked(sendDataRequest).mockResolvedValue({ ok: true })
    const ok = await PATCH(req({ op: 'send' }), ctx)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true, state: 'DONE' })
    expect(sendDataRequest).toHaveBeenCalledWith({ actionId: 'a1', accountId: 'acc1' })

    vi.mocked(sendDataRequest).mockResolvedValue({ ok: false, status: 409, error: 'Butuh template: tamu belum chat lebih dari 24 jam' })
    const blocked = await PATCH(req({ op: 'send' }), ctx)
    expect(blocked.status).toBe(409)
    expect(await blocked.json()).toEqual({ error: 'Butuh template: tamu belum chat lebih dari 24 jam' })
  })

  it('500 generic on failure', async () => {
    mockPrisma.bookingAction.findUnique.mockRejectedValue(new Error('secret'))
    const res = await PATCH(req({ op: 'reject' }), ctx)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
  })

  it('final review cheap minor: the 500 log carries the error name only, not the raw message (Prisma args / customer text)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockPrisma.bookingAction.findUnique.mockRejectedValue(new Error('Invalid invocation: reason "tamu di Hotel Rahasia"'))
    expect((await PATCH(req({ op: 'reject', reason: 'x' }), ctx)).status).toBe(500)
    expect(JSON.stringify(spy.mock.calls)).not.toContain('Rahasia')
    spy.mockRestore()
  })
})

describe('PATCH op execute (Task 10 + 11)', () => {
  const booking = (over: Record<string, unknown> = {}) => ({
    booking_id: 77, id: 'JVTO-77', total_pax: 3,
    pickup: { meeting_point: 'Surabaya Airport', meeting_point_value: 'GA 300', pickup_time: '10:30' },
    dropoff: { drop_point: 'Surabaya Hotel', drop_point_value: 'Hotel Majapahit' },
    ...over,
  }) as BookingData
  const ok = (written: Array<'pickup' | 'drop' | 'tshirt'> = ['pickup']): WriteResult => ({ status: 'ok', booking: booking(), written })
  const changeTime = action({ field: 'pickup_time', proposedValue: '09:00' })
  const events = () => vi.mocked(recordEvent).mock.calls.map(([, e]) => e)
  const updates = () => mockPrisma.bookingAction.updateMany.mock.calls.map(([a]) => a)
  const claimAt = () => (updates()[0].data as { claimedAt: Date }).claimedAt

  beforeEach(() => {
    vi.mocked(writeConfigured).mockReturnValue(true)
    vi.mocked(writeBookingChange).mockReset().mockResolvedValue(ok())
    vi.mocked(reevaluateBookingActions).mockReset().mockResolvedValue({ resolved: 0, opened: 0 })
    mockPrisma.bookingAction.findUnique.mockResolvedValue(changeTime as never)
    mockPrisma.conversation.findUnique.mockResolvedValue({ bookingData: booking(), isTest: false, contact: { phone: '4915112345678' } } as never)
    mockPrisma.bookingAction.findMany.mockResolvedValue([])
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('execute writes and records EXECUTED with old/new', async () => {
    const res = await PATCH(req({ op: 'execute' }), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, state: 'EXECUTED', executed: ['a1'] })
    expect(writeBookingChange).toHaveBeenCalledWith('77', { pickup_time: '09:00' }, 'c1', expect.objectContaining({ booking_id: 77 }))
    // Klaim dulu (OPEN -> EXECUTING), baru tulis, baru EXECUTED.
    expect(updates()[0]).toEqual({ where: { id: 'a1', state: 'OPEN' }, data: expect.objectContaining({ state: 'EXECUTING', claimedAt: expect.any(Date) }) })
    // Transisi akhir terikat pada klaim permintaan INI (claimedAt, R22), bukan sekadar state.
    expect(updates()[0].data).not.toHaveProperty('updatedAt')
    expect(updates()[1]).toEqual({
      where: { id: 'a1', state: 'EXECUTING', claimedAt: claimAt() },
      data: { state: 'EXECUTED', closedReason: 'EXECUTED', closedById: 'acc1', closedAt: expect.any(Date), claimedAt: null, lastError: null },
    })
    expect(events()).toEqual([expect.objectContaining({
      event: 'EXECUTED', actor: 'ACCOUNT', accountId: 'acc1', actionId: 'a1', conversationId: 'c1', bookingId: '77',
      oldValue: '10:30', newValue: '09:00', backoffice: { written: ['pickup'], httpStatus: 200, batch: ['a1'] },
    })])
    expect(reevaluateBookingActions).toHaveBeenCalledWith('c1')
    expect(broadcast).toHaveBeenCalledWith({ type: 'booking-actions.changed', conversationId: 'c1' })
  })

  it('corrected value records CORRECTED then EXECUTED', async () => {
    const res = await PATCH(req({ op: 'execute', value: '9.30' }), ctx)
    expect(res.status).toBe(200)
    expect(writeBookingChange).toHaveBeenCalledWith('77', { pickup_time: '09:30' }, 'c1', expect.objectContaining({ booking_id: 77 }))
    expect(updates()[0].data).toMatchObject({ state: 'EXECUTING', proposedValue: '09:30' })
    expect(events().map((e) => e.event)).toEqual(['CORRECTED', 'EXECUTED'])
    expect(events()[0]).toMatchObject({ actor: 'ACCOUNT', accountId: 'acc1', oldValue: '09:00', newValue: '09:30' })
    expect(events()[1]).toMatchObject({ oldValue: '10:30', newValue: '09:30' })
  })

  it('same value as the proposal is not a correction', async () => {
    await PATCH(req({ op: 'execute', value: '09:00' }), ctx)
    expect(events().map((e) => e.event)).toEqual(['EXECUTED'])
    expect(updates()[0].data).not.toHaveProperty('proposedValue')
  })

  it('backoffice 500 → stays OPEN, EXECUTE_FAILED, 502', async () => {
    vi.mocked(writeBookingChange).mockResolvedValue({ status: 'error', kind: 'backoffice', httpStatus: 500, error: 'Server error', written: [] })
    const res = await PATCH(req({ op: 'execute' }), ctx)
    expect(res.status).toBe(502)
    // Pesan mentah backoffice tidak dikembalikan; ia hanya di lastError/riwayat (sudah disanitasi).
    expect(await res.json()).toEqual({ error: 'Backoffice gagal menulis perubahan (HTTP 500). Lihat "Gagal terakhir" di kartu.' })
    expect(updates()[1]).toEqual({ where: { id: 'a1', state: 'EXECUTING', claimedAt: claimAt() }, data: { state: 'OPEN', claimedAt: null, lastError: 'Server error' } })
    expect(events()).toEqual([expect.objectContaining({
      event: 'EXECUTE_FAILED', actor: 'ACCOUNT', accountId: 'acc1', reason: 'Server error',
      backoffice: { written: [], httpStatus: 500, kind: 'backoffice' },
    })])
    expect(updates().some((u) => (u.data as { state?: string }).state === 'EXECUTED')).toBe(false)
    // Satu-satunya reevaluate = sesudah data booking segar disimpan (sebelum klaim); kegagalan tulis tidak menambah.
    expect(reevaluateBookingActions).toHaveBeenCalledTimes(1)
    expect(broadcast).toHaveBeenCalled()
  })

  it('partial write on failure is recorded and reevaluate still runs', async () => {
    vi.mocked(writeBookingChange).mockResolvedValue({ status: 'error', kind: 'backoffice', httpStatus: 500, error: 'x', written: ['pickup'] })
    expect((await PATCH(req({ op: 'execute' }), ctx)).status).toBe(502)
    expect(events()[0]).toMatchObject({
      event: 'EXECUTE_FAILED', reason: expect.stringContaining('Sebagian sudah tertulis (pickup)'),
      backoffice: { written: ['pickup'], httpStatus: 500, kind: 'backoffice', partial: true },
    })
    expect(reevaluateBookingActions).toHaveBeenCalledWith('c1')
  })

  it('unlinked booking → 409', async () => {
    // Ruling R3: bookingId aksi tidak sama dengan booking percakapan sekarang (termasuk tanpa booking).
    mockPrisma.bookingAction.findUnique.mockResolvedValue(action({ field: 'pickup_time', proposedValue: '09:00', bookingId: null }) as never)
    expect((await PATCH(req({ op: 'execute' }), ctx)).status).toBe(409)
    mockPrisma.bookingAction.findUnique.mockResolvedValue(changeTime as never)
    mockPrisma.conversation.findUnique.mockResolvedValue({ bookingData: null, isTest: false, contact: { phone: '4915112345678' } } as never)
    expect((await PATCH(req({ op: 'execute' }), ctx)).status).toBe(409)
    expect(writeBookingChange).not.toHaveBeenCalled()
  })

  it('booking_id changed since card created → execute 409, backoffice not called', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({ bookingData: booking({ booking_id: 78 }), isTest: false, contact: { phone: '4915112345678' } } as never)
    const res = await PATCH(req({ op: 'execute' }), ctx)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Booking di percakapan ini berubah sejak kartu dibuat. Periksa ulang.' })
    expect(writeBookingChange).not.toHaveBeenCalled()
    expect(mockPrisma.bookingAction.updateMany).not.toHaveBeenCalled()
  })

  it('booking switched between check and write (client says booking_changed) → 409 with the same message', async () => {
    vi.mocked(writeBookingChange).mockResolvedValue({ status: 'error', kind: 'booking_changed', httpStatus: 0, error: 'Booking percakapan sudah berganti', written: [] })
    const res = await PATCH(req({ op: 'execute' }), ctx)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Booking di percakapan ini berubah sejak kartu dibuat. Periksa ulang.' })
    expect(updates()[1]).toMatchObject({ data: { state: 'OPEN' } })
  })

  it('double click → second call 409, backoffice called once', async () => {
    let state = 'OPEN'
    mockPrisma.bookingAction.updateMany.mockImplementation((async ({ where, data }: { where: { state?: unknown }; data: { state?: string } }) => {
      const want = where.state
      const matches = typeof want === 'string' ? want === state : true
      if (!matches) return { count: 0 }
      if (data.state) state = data.state
      return { count: 1 }
    }) as never)
    let release: (r: WriteResult) => void = () => undefined
    vi.mocked(writeBookingChange).mockImplementation(() => new Promise<WriteResult>((r) => { release = r }))
    const first = PATCH(req({ op: 'execute' }), ctx)
    // Klik kedua membaca baris sebelum klik pertama selesai (findUnique masih OPEN).
    await vi.waitFor(() => expect(writeBookingChange).toHaveBeenCalledTimes(1))
    const second = await PATCH(req({ op: 'execute' }), ctx)
    expect(second.status).toBe(409)
    release(ok())
    expect((await first).status).toBe(200)
    expect(writeBookingChange).toHaveBeenCalledTimes(1)
    expect(state).toBe('EXECUTED')
  })

  it('409 when the action is already EXECUTING or closed', async () => {
    mockPrisma.bookingAction.findUnique.mockResolvedValue(action({ state: 'EXECUTING' }) as never)
    expect((await PATCH(req({ op: 'execute' }), ctx)).status).toBe(409)
    mockPrisma.bookingAction.findUnique.mockResolvedValue(action({ state: 'EXECUTED' }) as never)
    expect((await PATCH(req({ op: 'execute' }), ctx)).status).toBe(409)
    expect(writeBookingChange).not.toHaveBeenCalled()
  })

  it('400 for non-CHANGE actions and for fields without a write path (R16)', async () => {
    for (const a of [action({ type: 'TASK' }), action({ field: 'note', proposedValue: 'vegan' }), action({ field: 'pickup_arrival', proposedValue: '08:00' }), action({ field: 'drop_arrival', proposedValue: '08:00' })]) {
      mockPrisma.bookingAction.findUnique.mockResolvedValue(a as never)
      expect((await PATCH(req({ op: 'execute' }), ctx)).status).toBe(400)
    }
    expect(writeBookingChange).not.toHaveBeenCalled()
    expect(mockPrisma.bookingAction.updateMany).not.toHaveBeenCalled()
  })

  it('503 when the write path is not configured', async () => {
    vi.mocked(writeConfigured).mockReturnValue(false)
    expect((await PATCH(req({ op: 'execute' }), ctx)).status).toBe(503)
    expect(mockPrisma.bookingAction.updateMany).not.toHaveBeenCalled()
  })

  it('invalid corrected value → 400 before claiming', async () => {
    const res = await PATCH(req({ op: 'execute', value: 'besok pagi-pagi' }), ctx)
    expect(res.status).toBe(400)
    expect(mockPrisma.bookingAction.updateMany).not.toHaveBeenCalled()
    expect(writeBookingChange).not.toHaveBeenCalled()
  })

  it('client-side validation error (e.g. "Isi detail titik baru dulu") → 400, released, EXECUTE_FAILED', async () => {
    mockPrisma.bookingAction.findUnique.mockResolvedValue(action({ field: 'pickup_point', proposedValue: 'Surabaya Hotel' }) as never)
    vi.mocked(writeBookingChange).mockResolvedValue({ status: 'error', kind: 'invalid', httpStatus: 0, error: 'Isi detail titik baru dulu', written: [] })
    const res = await PATCH(req({ op: 'execute' }), ctx)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Isi detail titik baru dulu' })
    expect(updates()[1]).toMatchObject({ data: { state: 'OPEN', lastError: 'Isi detail titik baru dulu' } })
    expect(events()[0]).toMatchObject({ event: 'EXECUTE_FAILED' })
  })

  it('network failure (status 0, kind backoffice) is 502, not 400', async () => {
    vi.mocked(writeBookingChange).mockResolvedValue({ status: 'error', kind: 'backoffice', httpStatus: 0, error: 'Backoffice tidak menjawab (timeout)', written: [] })
    expect((await PATCH(req({ op: 'execute' }), ctx)).status).toBe(502)
  })

  it('R17/R20: point card pulls in the OPEN detail card of the same side (not the time card) into one patch', async () => {
    mockPrisma.bookingAction.findUnique.mockResolvedValue(action({ field: 'pickup_point', proposedValue: 'Surabaya Hotel' }) as never)
    mockPrisma.bookingAction.findMany.mockResolvedValue([
      action({ id: 'd1', field: 'pickup_detail', proposedValue: 'Hotel Tunjungan' }),
      action({ id: 't1', field: 'pickup_time', proposedValue: '08:00' }),
    ] as never)
    const res = await PATCH(req({ op: 'execute' }), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ executed: ['a1', 'd1'] })
    expect(writeBookingChange).toHaveBeenCalledTimes(1)
    expect(writeBookingChange).toHaveBeenCalledWith('77', { pickup_point: 'Surabaya Hotel', pickup_detail: 'Hotel Tunjungan' }, 'c1', expect.objectContaining({ booking_id: 77 }))
    const where = mockPrisma.bookingAction.findMany.mock.calls[0][0]?.where
    expect(where).toMatchObject({ conversationId: 'c1', bookingId: '77', type: 'CHANGE', state: 'OPEN', field: { in: ['pickup_detail'] } })
    expect(updates().filter((u) => (u.data as { state?: string }).state === 'EXECUTING').map((u) => (u.where as { id: string }).id)).toEqual(['a1', 'd1'])
    expect(events().map((e) => [e.event, e.actionId, e.oldValue, e.newValue])).toEqual([
      ['EXECUTED', 'a1', 'Surabaya Airport', 'Surabaya Hotel'],
      ['EXECUTED', 'd1', 'GA 300', 'Hotel Tunjungan'],
    ])
  })

  it('a time card is executed alone (R20)', async () => {
    mockPrisma.bookingAction.findMany.mockResolvedValue([action({ id: 'p1', field: 'pickup_point', proposedValue: 'Surabaya Hotel' })] as never)
    await PATCH(req({ op: 'execute' }), ctx)
    expect(mockPrisma.bookingAction.findMany).not.toHaveBeenCalled()
    expect(writeBookingChange).toHaveBeenCalledWith('77', { pickup_time: '09:00' }, 'c1', expect.objectContaining({ booking_id: 77 }))
  })

  it('R19: detail on a point card is written with the point (no detail card needed)', async () => {
    mockPrisma.bookingAction.findUnique.mockResolvedValue(action({ field: 'pickup_point', proposedValue: 'Surabaya Hotel' }) as never)
    const res = await PATCH(req({ op: 'execute', detail: '  Hotel Majapahit ' }), ctx)
    expect(res.status).toBe(200)
    expect(writeBookingChange).toHaveBeenCalledWith('77', { pickup_point: 'Surabaya Hotel', pickup_detail: 'Hotel Majapahit' }, 'c1', expect.objectContaining({ booking_id: 77 }))
    expect(await res.json()).toMatchObject({ executed: ['a1'] })
  })

  it('R19: detail overrides an open detail card, which is closed EXECUTED with the detail actually written', async () => {
    mockPrisma.bookingAction.findUnique.mockResolvedValue(action({ field: 'pickup_point', proposedValue: 'Surabaya Hotel' }) as never)
    mockPrisma.bookingAction.findMany.mockResolvedValue([action({ id: 'd1', field: 'pickup_detail', proposedValue: 'Hotel Tunjungan' })] as never)
    expect((await PATCH(req({ op: 'execute', detail: 'Hotel Majapahit' }), ctx)).status).toBe(200)
    expect(writeBookingChange).toHaveBeenCalledWith('77', { pickup_point: 'Surabaya Hotel', pickup_detail: 'Hotel Majapahit' }, 'c1', expect.objectContaining({ booking_id: 77 }))
    expect(updates().find((u) => (u.where as { id: string }).id === 'd1' && (u.data as { state?: string }).state === 'EXECUTING')?.data)
      .toMatchObject({ proposedValue: 'Hotel Majapahit' })
    expect(events().map((e) => [e.event, e.actionId, e.oldValue, e.newValue])).toEqual([
      ['CORRECTED', 'd1', 'Hotel Tunjungan', 'Hotel Majapahit'],
      ['EXECUTED', 'a1', 'Surabaya Airport', 'Surabaya Hotel'],
      ['EXECUTED', 'd1', 'GA 300', 'Hotel Majapahit'],
    ])
  })

  it('R19: detail is only for point cards, and an invalid detail is 400 before the claim', async () => {
    expect((await PATCH(req({ op: 'execute', detail: 'Hotel X' }), ctx)).status).toBe(400) // kartu jam
    mockPrisma.bookingAction.findUnique.mockResolvedValue(action({ field: 'pickup_point', proposedValue: 'Surabaya Hotel' }) as never)
    expect((await PATCH(req({ op: 'execute', detail: '   ' }), ctx)).status).toBe(400)
    expect(mockPrisma.bookingAction.updateMany).not.toHaveBeenCalled()
    expect(writeBookingChange).not.toHaveBeenCalled()
  })

  it('unexpected throw after a failed write still releases the claim (try/finally)', async () => {
    vi.mocked(writeBookingChange).mockResolvedValue({ status: 'error', kind: 'backoffice', httpStatus: 500, error: 'x', written: [] })
    vi.mocked(recordEvent).mockRejectedValueOnce(new Error('db'))
    expect((await PATCH(req({ op: 'execute' }), ctx)).status).toBe(500)
    const last = updates()[updates().length - 1]
    expect(last).toMatchObject({ where: { id: 'a1', state: 'EXECUTING', claimedAt: claimAt() }, data: { state: 'OPEN', claimedAt: null } })
  })

  it('unexpected throw after a SUCCESSFUL write does not reopen the card (stale release decides later)', async () => {
    vi.mocked(recordEvent).mockRejectedValueOnce(new Error('db'))
    expect((await PATCH(req({ op: 'execute' }), ctx)).status).toBe(500)
    expect(updates().some((u) => (u.data as { state?: string }).state === 'OPEN')).toBe(false)
  })

  it('lastError is sanitized before it is stored', async () => {
    vi.mocked(writeBookingChange).mockResolvedValue({ status: 'error', kind: 'backoffice', httpStatus: 500, error: 'gagal api_key=abcdef1234567890abcdef1234', written: [] })
    await PATCH(req({ op: 'execute' }), ctx)
    expect(JSON.stringify(updates()[1].data)).not.toContain('abcdef1234567890')
    expect(JSON.stringify(events())).not.toContain('abcdef1234567890')
  })

  it('R17: a companion card claimed by someone else is left out', async () => {
    mockPrisma.bookingAction.findUnique.mockResolvedValue(action({ field: 'pickup_detail', proposedValue: 'Hotel Tunjungan' }) as never)
    mockPrisma.bookingAction.findMany.mockResolvedValue([action({ id: 'p1', field: 'pickup_point', proposedValue: 'Surabaya Hotel' })] as never)
    mockPrisma.bookingAction.updateMany.mockImplementation((async ({ where }: { where: { id: string } }) => ({ count: where.id === 'p1' ? 0 : 1 })) as never)
    await PATCH(req({ op: 'execute' }), ctx)
    expect(writeBookingChange).toHaveBeenCalledWith('77', { pickup_detail: 'Hotel Tunjungan' }, 'c1', expect.objectContaining({ booking_id: 77 }))
  })

  it('tshirt value is parsed into sizes ("M x 2, L x 1"); unparseable → 400', async () => {
    mockPrisma.bookingAction.findUnique.mockResolvedValue(action({ field: 'tshirt_sizes', proposedValue: 'M x 2, L x 1' }) as never)
    expect((await PATCH(req({ op: 'execute' }), ctx)).status).toBe(200)
    expect(writeBookingChange).toHaveBeenCalledWith('77', { tshirt_sizes: { m: 2, l: 1 } }, 'c1', expect.objectContaining({ booking_id: 77 }))
    vi.mocked(writeBookingChange).mockClear()
    expect((await PATCH(req({ op: 'execute', value: 'dua medium' }), ctx)).status).toBe(400)
    expect(writeBookingChange).not.toHaveBeenCalled()
  })

  it('a failing reevaluate does not turn a successful write into an error', async () => {
    vi.mocked(reevaluateBookingActions).mockRejectedValue(new Error('db'))
    expect((await PATCH(req({ op: 'execute' }), ctx)).status).toBe(200)
  })

  it('logs carry no customer text', async () => {
    vi.mocked(writeBookingChange).mockResolvedValue({ status: 'error', kind: 'backoffice', httpStatus: 500, error: 'x', written: [] })
    mockPrisma.bookingAction.findUnique.mockResolvedValue(action({ field: 'pickup_detail', proposedValue: 'Hotel Rahasia Tamu' }) as never)
    await PATCH(req({ op: 'execute' }), ctx)
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('Rahasia')
  })
})

describe('PATCH op revert (Task 11b)', () => {
  const nowBooking = {
    booking_id: 77, id: 'JVTO-77', pickup: { meeting_point: 'Surabaya Airport', meeting_point_value: 'GA 300', pickup_time: '09:00' },
  } as BookingData
  const executed = action({ field: 'pickup_time', proposedValue: '09:00', state: 'EXECUTED' })

  beforeEach(() => {
    vi.mocked(writeConfigured).mockReturnValue(true)
    vi.mocked(writeBookingChange).mockReset().mockResolvedValue({ status: 'ok', booking: nowBooking, written: ['pickup'] })
    vi.mocked(reevaluateBookingActions).mockReset().mockResolvedValue({ resolved: 0, opened: 0 })
    mockPrisma.bookingAction.findUnique.mockResolvedValue(executed as never)
    mockPrisma.bookingAction.findMany.mockResolvedValue([{ id: 'a1', field: 'pickup_time' }] as never)
    mockPrisma.bookingActionEvent.findMany.mockResolvedValue([
      { id: 'e1', actionId: 'a1', event: 'EXECUTED', oldValue: '10:30', newValue: '09:00', backoffice: { batch: ['a1'] } },
    ] as never)
    mockPrisma.conversation.findUnique.mockResolvedValue({ bookingData: nowBooking, isTest: false, contact: { phone: '4915112345678' } } as never)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('any logged-in AGENT can revert an EXECUTED action: old value written back, state REVERTED by that account', async () => {
    const res = await PATCH(req({ op: 'revert' }), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, state: 'REVERTED', reverted: ['a1'] })
    expect(vi.mocked(writeBookingChange).mock.calls[0][1]).toEqual({ pickup_time: '10:30' })
    expect(mockPrisma.bookingAction.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', state: 'EXECUTED' },
      data: expect.objectContaining({ state: 'REVERTED', closedReason: 'REVERTED', closedById: 'acc1' }),
    })
    expect(recordEvent).toHaveBeenCalledWith(mockPrisma, expect.objectContaining({ event: 'REVERTED', accountId: 'acc1' }))
  })

  it('401 without a session, 409 for an action that is not EXECUTED', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null)
    expect((await PATCH(req({ op: 'revert' }), ctx)).status).toBe(401)
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc1', role: 'AGENT', tokenVersion: 0 })
    mockPrisma.bookingAction.findUnique.mockResolvedValue(action({ state: 'OPEN' }) as never)
    expect((await PATCH(req({ op: 'revert' }), ctx)).status).toBe(409)
    expect(writeBookingChange).not.toHaveBeenCalled()
  })
})
