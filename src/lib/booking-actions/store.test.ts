/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import type { BookingData } from '@/lib/booking/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))
vi.mock('@/lib/bot/llm', () => ({ callLLM: vi.fn() }))
vi.mock('@/lib/push/send', async (orig) => ({ ...(await orig<typeof import('@/lib/push/send')>()), notifyBookingAction: vi.fn() }))

import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { callLLM } from '@/lib/bot/llm'
import { notifyBookingAction } from '@/lib/push/send'
import { applyExtraction, reevaluateBookingActions } from './store'
import { parseExtraction } from './extract'
import { supersedeOlderFacts } from './fact-supersede'

const db = prisma as unknown as DeepMockProxy<PrismaClient>
const NOW = new Date('2026-10-20T03:00:00Z')

type Row = Record<string, unknown> & { id: string }
let facts: Row[]
let actions: Row[]
let events: Row[]
let booking: BookingData | null
let seq: number
let calls: string[]
let msgTimes: Record<string, string>

const matches = (row: Row, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && 'in' in (v as object)) return ((v as { in: unknown[] }).in).includes(row[k])
    return row[k] === v
  })

beforeEach(() => {
  mockReset(db)
  vi.mocked(broadcast).mockClear()
  vi.mocked(callLLM).mockClear()
  vi.mocked(notifyBookingAction).mockReset()
  facts = []; actions = []; events = []; seq = 0; calls = []; msgTimes = {}
  booking = { booking_id: 77, total_pax: 4, pickup: { meeting_point: 'Surabaya Airport' } } as BookingData
  db.$transaction.mockImplementation((async (cb: (tx: unknown) => unknown) => cb(db)) as never)
  db.$executeRaw.mockImplementation((async () => { calls.push('lock'); return 0 }) as never)
  db.message.findMany.mockImplementation((async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.filter((id) => msgTimes[id]).map((id) => ({ id, createdAt: new Date(msgTimes[id]) }))) as never)
  db.conversation.findUnique.mockImplementation((async () => { calls.push('read'); return { bookingData: booking } }) as never)
  db.bookingFact.findMany.mockImplementation((async ({ where }: { where: Record<string, unknown> }) =>
    facts.filter((f) => matches(f, where))) as never)
  db.bookingFact.create.mockImplementation((async ({ data }: { data: Record<string, unknown> }) => {
    const row = { id: `f${++seq}`, supersededAt: null, ...data }
    facts.push(row)
    return row
  }) as never)
  db.bookingFact.update.mockImplementation((async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    const row = facts.find((f) => f.id === where.id)!
    Object.assign(row, data)
    return row
  }) as never)
  db.bookingAction.findMany.mockImplementation((async ({ where }: { where: Record<string, unknown> }) => actions.filter((a) => matches(a, where))) as never)
  db.bookingAction.create.mockImplementation((async ({ data }: { data: Record<string, unknown> }) => {
    const row = { id: `a${++seq}`, ...data }
    actions.push(row)
    return row
  }) as never)
  db.bookingAction.update.mockImplementation((async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    const row = actions.find((a) => a.id === where.id)!
    Object.assign(row, data)
    return row
  }) as never)
  db.bookingAction.updateMany.mockImplementation((async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    const rows = actions.filter((a) => matches(a, where))
    for (const row of rows) Object.assign(row, data)
    return { count: rows.length }
  }) as never)
  db.bookingActionEvent.findMany.mockImplementation((async ({ where }: { where: Record<string, unknown> }) => events.filter((e) => matches(e, where))) as never)
  db.bookingActionEvent.create.mockImplementation((async ({ data }: { data: Record<string, unknown> }) => {
    const row = { id: `e${++seq}`, ...data }
    events.push(row)
    return row
  }) as never)
})

const ex = (over: { changes?: unknown[]; facts?: unknown[]; unclear?: unknown[] }) => ({ changes: [], facts: [], ...over }) as never
const item = (field: string, value: string, messageId: string) => ({ field, value, messageId })

describe('applyExtraction', () => {
  it('heavy change becomes TASK', async () => {
    const r = await applyExtraction('c1', ex({ changes: [item('travel_date', '2026-11-05', 'm1')] }), NOW)
    expect(r.created).toBe(1)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ type: 'TASK', tier: 'HEAVY', state: 'OPEN', bookingId: '77', proposedValue: '2026-11-05' })
    expect(broadcast).toHaveBeenCalledWith({ type: 'booking-actions.changed', conversationId: 'c1' })
  })

  it('unreadable tshirt request (e.g. ambiguous "2xl") becomes a HEAVY TASK "tidak jelas" and is returned in cardIds', async () => {
    const r = await applyExtraction('c1', ex({ unclear: [{ field: 'tshirt_sizes', messageId: 'm1' }] }), NOW)
    expect(r.cardIds).toHaveLength(1)
    expect(actions[0]).toMatchObject({ type: 'TASK', tier: 'HEAVY', field: 'tshirt_sizes', state: 'OPEN', proposedValue: 'Ukuran kaos tidak jelas — cek chat' })
    // Ulang dengan pesan yang sama tidak menggandakan kartu.
    const again = await applyExtraction('c1', ex({ unclear: [{ field: 'tshirt_sizes', messageId: 'm1' }] }), NOW)
    expect(again.cardIds).toEqual([])
    expect(actions).toHaveLength(1)
  })

  it('new action stores bookingId from bookingData.booking_id', async () => {
    // Task 10: eksekusi membandingkan bookingId ini dengan booking_id terbaru (numerik di API -> string).
    booking = { ...booking, booking_id: 3899 } as BookingData
    await applyExtraction('c1', ex({ changes: [item('pickup_time', '09:00', 'm1')] }), NOW)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ type: 'CHANGE', bookingId: '3899' })
    expect(events[0]).toMatchObject({ bookingId: '3899', event: 'CREATED' })
  })

  it('AI change becomes CHANGE', async () => {
    await applyExtraction('c1', ex({ changes: [item('pickup_point', 'Surabaya Hotel', 'm1')] }), NOW)
    expect(actions[0]).toMatchObject({ type: 'CHANGE', tier: 'AI' })
  })

  it('second change same field supersedes first and records SUPERSEDED', async () => {
    await applyExtraction('c1', ex({ changes: [item('pickup_point', 'Surabaya Hotel', 'm1')] }), NOW)
    await applyExtraction('c1', ex({ changes: [item('pickup_point', 'Surabaya Train Station', 'm2')] }), NOW)
    expect(actions.map((a) => [a.state, a.closedReason])).toEqual([['SUPERSEDED', 'REPLACED'], ['OPEN', undefined]])
    expect(events.map((e) => e.event)).toEqual(['CREATED', 'SUPERSEDED', 'CREATED'])
  })

  it('same open change again creates nothing and writes no event', async () => {
    const c = { changes: [item('pickup_point', 'Surabaya Hotel', 'm1')] }
    await applyExtraction('c1', ex(c), NOW)
    vi.mocked(broadcast).mockClear()
    const r = await applyExtraction('c1', ex(c), NOW)
    expect(r.created).toBe(0)
    expect(actions).toHaveLength(1)
    expect(events).toHaveLength(1)
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('self-correction: fact 5 then fact 4 with total_pax 4 → mismatch resolved', async () => {
    await applyExtraction('c1', ex({ facts: [item('total_pax', '5', 'm1')] }), NOW)
    expect(actions[0]).toMatchObject({ type: 'MISMATCH', state: 'OPEN', proposedValue: '5' })
    await applyExtraction('c1', ex({ facts: [item('total_pax', '4', 'm2')] }), NOW)
    expect(facts[0].supersededAt).toEqual(NOW)
    expect(actions[0]).toMatchObject({ state: 'RESOLVED', closedReason: 'CHAT_CORRECTED' })
    expect(actions).toHaveLength(1)
  })

  it('empty booking + AI field fact → CHANGE "isi data"; HEAVY field ignored', async () => {
    await applyExtraction('c1', ex({ facts: [item('pickup_detail', 'Hotel Majapahit', 'm1'), item('hotel', 'Bromo Permai', 'm2')] }), NOW)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ type: 'CHANGE', field: 'pickup_detail', proposedValue: 'Hotel Majapahit' })
  })
})

describe('notifikasi push (Task 8b)', () => {
  it('CHANGE push is NOT sent at creation (2026-10-20): it is returned as changeEvents; TASK still pushes at creation', async () => {
    booking = { ...booking!, id: 'JVTO-3899' } as BookingData
    const r = await applyExtraction('c1', ex({ changes: [item('pickup_point', 'Surabaya Hotel', 'm1'), item('travel_date', '2026-11-05', 'm2')] }), NOW)
    expect(notifyBookingAction).toHaveBeenCalledTimes(1)
    expect(vi.mocked(notifyBookingAction).mock.calls[0][0]).toMatchObject({ kind: 'TASK', summary: 'Tanggal trip → 2026-11-05' })
    expect(r.changeEvents).toEqual([{
      kind: 'CHANGE', conversationId: 'c1', bookingCode: 'JVTO-3899', summary: 'Titik jemput → Surabaya Hotel', actionId: actions[0].id, messageId: 'm1',
    }])
    expect(r.changeIds).toEqual([actions[0].id])
  })

  it('CHANGE cards born in reevaluateBookingActions (no auto-apply follows) still push at creation', async () => {
    await applyExtraction('c1', ex({ facts: [item('pickup_detail', 'Hotel X', 'm3')] }), NOW)
    // pickup_detail terisi dari fakta lahir di evaluate di dalam applyExtraction (tertunda); di jalur reevaluate harus langsung.
    vi.mocked(notifyBookingAction).mockClear()
    actions.splice(0, actions.length)
    await reevaluateBookingActions('c1', NOW)
    expect(vi.mocked(notifyBookingAction).mock.calls.every((c) => c[0].kind === 'CHANGE')).toBe(true)
    expect(notifyBookingAction).toHaveBeenCalledTimes(1)
  })

  it('notifies MISMATCH created by evaluation', async () => {
    await applyExtraction('c1', ex({ facts: [item('total_pax', '5', 'm1')] }), NOW)
    expect(notifyBookingAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'MISMATCH', bookingCode: null, summary: 'Jumlah tamu → 5' }))
  })

  it('does not notify when nothing new is created or when the same change repeats', async () => {
    const c = { changes: [item('pickup_point', 'Surabaya Hotel', 'm1')] }
    await applyExtraction('c1', ex(c), NOW)
    vi.mocked(notifyBookingAction).mockClear()
    await applyExtraction('c1', ex(c), NOW)
    expect(notifyBookingAction).not.toHaveBeenCalled()
  })

  it('fires only after the transaction commits, and a throwing notifier never breaks the caller', async () => {
    let committed = false
    db.$transaction.mockImplementation((async (cb: (tx: unknown) => unknown) => { const r = await cb(db); committed = true; return r }) as never)
    vi.mocked(notifyBookingAction).mockImplementation((() => { expect(committed).toBe(true); throw new Error('boom') }) as never)
    await expect(applyExtraction('c1', ex({ facts: [item('total_pax', '5', 'm1')] }), NOW)).resolves.toMatchObject({ created: 1 })
    expect(notifyBookingAction).toHaveBeenCalledTimes(1)
  })
})

describe('reevaluateBookingActions', () => {
  it('backoffice already updated → CHANGE resolved MATCHED_IN_BACKOFFICE without LLM', async () => {
    await applyExtraction('c1', ex({ changes: [item('pickup_point', 'Surabaya Hotel', 'm1')] }), NOW)
    booking = { ...booking!, pickup: { meeting_point: 'Surabaya Hotel' } }
    const r = await reevaluateBookingActions('c1', NOW)
    expect(r).toEqual({ resolved: 1, opened: 0 })
    expect(actions[0]).toMatchObject({ state: 'RESOLVED', closedReason: 'MATCHED_IN_BACKOFFICE' })
    expect(callLLM).not.toHaveBeenCalled()
  })

  it('new mismatch after backoffice changes opens a MISMATCH', async () => {
    await applyExtraction('c1', ex({ facts: [item('total_pax', '4', 'm1')] }), NOW)
    expect(actions).toHaveLength(0)
    booking = { ...booking!, total_pax: 6 }
    expect(await reevaluateBookingActions('c1', NOW)).toEqual({ resolved: 0, opened: 1 })
  })

  it('every transition writes exactly one BookingActionEvent', async () => {
    await applyExtraction('c1', ex({ facts: [item('total_pax', '5', 'm1')] }), NOW)
    expect(events).toHaveLength(1)
    booking = { ...booking!, total_pax: 5 }
    await reevaluateBookingActions('c1', NOW)
    expect(events.map((e) => [e.event, e.actionId])).toEqual([['CREATED', actions[0].id], ['RESOLVED', actions[0].id]])
    expect(events[1].actor).toBe('SYSTEM')
    await reevaluateBookingActions('c1', NOW)
    expect(events).toHaveLength(2)
  })

  it('does nothing without bookingData', async () => {
    booking = null
    expect(await reevaluateBookingActions('c1', NOW)).toEqual({ resolved: 0, opened: 0 })
    expect(broadcast).not.toHaveBeenCalled()
  })
})

describe('kunci, ditutup orang, terbaru menang, cakupan booking', () => {
  it('mengambil kunci advisory sebelum membaca atau menulis apa pun', async () => {
    await applyExtraction('c1', ex({ facts: [item('total_pax', '5', 'm1')] }), NOW)
    expect(calls[0]).toBe('lock')
    expect(calls.indexOf('lock')).toBeLessThan(calls.indexOf('read'))
    expect(db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(db.bookingFact.findMany.mock.invocationCallOrder[0])
    expect(db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(db.bookingFact.create.mock.invocationCallOrder[0])
  })

  it('MISMATCH yang dilepas orang tidak dibuat ulang; nilai lain tetap membuat kartu baru', async () => {
    await applyExtraction('c1', ex({ facts: [item('total_pax', '5', 'm1')] }), NOW)
    Object.assign(actions[0], { state: 'RESOLVED', closedReason: 'DISMISSED_CHAT_WRONG', closedById: 'acc1' })
    const before = events.length
    expect(await reevaluateBookingActions('c1', NOW)).toEqual({ resolved: 0, opened: 0 })
    expect(actions).toHaveLength(1)
    expect(events).toHaveLength(before)
    const r = await applyExtraction('c1', ex({ facts: [item('total_pax', '6', 'm2')] }), NOW)
    expect(r.created).toBe(1)
    expect(actions[1]).toMatchObject({ type: 'MISMATCH', proposedValue: '6', state: 'OPEN' })
  })

  it('CHANGE yang ditolak orang tidak dibuat ulang oleh usulan sama', async () => {
    await applyExtraction('c1', ex({ changes: [item('pickup_point', 'Surabaya Hotel', 'm1')] }), NOW)
    Object.assign(actions[0], { state: 'REJECTED', closedReason: 'REJECTED', closedById: 'acc1' })
    expect((await applyExtraction('c1', ex({ changes: [item('pickup_point', 'Surabaya Hotel', 'm1')] }), NOW)).created).toBe(0)
  })

  it('CHANGE yang dibatalkan (REVERTED) tidak diusulkan lagi, dan changeIds memuat kartu CHANGE baru', async () => {
    const first = await applyExtraction('c1', ex({ changes: [item('pickup_point', 'Surabaya Hotel', 'm1')] }), NOW)
    expect(first.changeIds).toEqual([actions[0].id])
    Object.assign(actions[0], { state: 'REVERTED', closedReason: 'REVERTED', closedById: 'acc1' })
    const again = await applyExtraction('c1', ex({ changes: [item('pickup_point', 'Surabaya Hotel', 'm1')] }), NOW)
    expect(again).toEqual({ created: 0, changeIds: [], changeEvents: [], cardIds: [] })
  })

  it('terbaru menang: fakta isi-data yang lebih baru menggantikan CHANGE eksplisit lama; yang lebih lama tidak', async () => {
    msgTimes = { m1: '2026-10-20T01:00:00Z', m2: '2026-10-20T02:00:00Z' }
    await applyExtraction('c1', ex({ changes: [item('pickup_detail', 'Hotel A', 'm1')] }), NOW)
    await applyExtraction('c1', ex({ facts: [item('pickup_detail', 'Hotel B', 'm2')] }), NOW)
    expect(actions.map((a) => [a.proposedValue, a.state])).toEqual([['Hotel A', 'SUPERSEDED'], ['Hotel B', 'OPEN']])
    // permintaan eksplisit yang lebih lama tidak boleh menimpa yang lebih baru
    await applyExtraction('c1', ex({ changes: [item('pickup_detail', 'Hotel C', 'm1')] }), NOW)
    expect(actions.filter((a) => a.state === 'OPEN').map((a) => a.proposedValue)).toEqual(['Hotel B'])
  })

  it('created menghitung MISMATCH dan CHANGE isi-data yang lahir di evaluate', async () => {
    const r = await applyExtraction('c1', ex({
      changes: [item('pickup_point', 'Surabaya Hotel', 'm1')],
      facts: [item('total_pax', '5', 'm2'), item('pickup_detail', 'Hotel X', 'm3')],
    }), NOW)
    expect(r.created).toBe(3)
  })

  it('R8: CHANGE isi-data yang lahir di evaluate (bukan dari ex.changes) ikut di changeIds; MISMATCH tidak', async () => {
    const r = await applyExtraction('c1', ex({ facts: [item('pickup_detail', 'Hotel X', 'm3'), item('total_pax', '5', 'm2')] }), NOW)
    const fill = actions.find((x) => x.type === 'CHANGE' && x.field === 'pickup_detail')!
    const mismatch = actions.find((x) => x.type === 'MISMATCH')!
    expect(r.changeIds).toEqual([fill.id])
    expect(r.changeIds).not.toContain(mismatch.id)
  })

  it('fakta dari booking A tidak me-resolve atau mismatch terhadap booking B', async () => {
    await applyExtraction('c1', ex({ facts: [item('total_pax', '5', 'm1')] }), NOW)
    expect(actions[0]).toMatchObject({ bookingId: '77', state: 'OPEN' })
    booking = { ...booking!, booking_id: 88, total_pax: 5 } as BookingData
    expect(await reevaluateBookingActions('c1', NOW)).toEqual({ resolved: 0, opened: 0 })
    expect(actions[0].state).toBe('OPEN')
    expect(actions).toHaveLength(1)
  })
})

describe('nilai yang dikoreksi admin saat eksekusi (Task 11 fix)', () => {
  it('guest X → admin corrects to Y → EXECUTED; a later extraction re-proposing X creates no card and no notify', async () => {
    booking = { booking_id: 77, total_pax: 4, pickup: { meeting_point: 'Surabaya Airport', pickup_time: '09:30' } } as BookingData
    actions.push({ id: 'x1', conversationId: 'c1', bookingId: '77', type: 'CHANGE', field: 'pickup_time', proposedValue: '09:30', state: 'EXECUTED', closedReason: 'EXECUTED', closedById: 'acc1', sourceMessageId: 'm1' })
    events.push({ id: 'ev1', conversationId: 'c1', actionId: 'x1', event: 'CORRECTED', oldValue: '09:00', newValue: '09:30' })
    msgTimes = { m1: '2026-10-20T01:00:00Z', m2: '2026-10-20T02:00:00Z' }

    const r = await applyExtraction('c1', ex({ changes: [item('pickup_time', '09:00', 'm2')] }), NOW)

    expect(r.created).toBe(0)
    expect(actions.filter((a) => a.state === 'OPEN')).toHaveLength(0)
    expect(notifyBookingAction).not.toHaveBeenCalled()
  })

  it('an EXECUTED card that was NOT corrected blocks nothing extra', async () => {
    booking = { booking_id: 77, total_pax: 4, pickup: { meeting_point: 'Surabaya Airport', pickup_time: '09:30' } } as BookingData
    actions.push({ id: 'x1', conversationId: 'c1', bookingId: '77', type: 'CHANGE', field: 'pickup_time', proposedValue: '09:30', state: 'EXECUTED', closedReason: 'EXECUTED', closedById: 'acc1' })
    const r = await applyExtraction('c1', ex({ changes: [item('pickup_time', '08:00', 'm2')] }), NOW)
    expect(r.created).toBe(1)
  })
})

describe('closeAction bersyarat (Task 11 fix 2)', () => {
  it('a card moved to EXECUTING by a concurrent "Setujui" is not overwritten and gets no event', async () => {
    booking = { booking_id: 77, total_pax: 4, pickup: { meeting_point: 'Surabaya Airport', pickup_time: '09:00' } } as BookingData
    const row = { id: 'x1', conversationId: 'c1', bookingId: '77', type: 'CHANGE', field: 'pickup_time', proposedValue: '09:00', state: 'EXECUTING', sourceMessageId: null }
    actions.push(row)
    // Bacaan basi: loadOpen masih melihat baris itu OPEN, padahal sudah diklaim.
    db.bookingAction.findMany.mockImplementation((async ({ where }: { where: Record<string, unknown> }) =>
      where.state === 'OPEN' ? actions.map((a) => ({ ...a, state: 'OPEN' })).filter((a) => matches(a, where)) : actions.filter((a) => matches(a, where))) as never)

    const r = await reevaluateBookingActions('c1', NOW)

    expect(row.state).toBe('EXECUTING')
    expect(events).toHaveLength(0)
    expect(r.resolved).toBe(0)
    expect(db.bookingAction.update).not.toHaveBeenCalled()
  })
})


describe('final review Important 2: re-reading old messages (watermark + newest per field)', () => {
  beforeEach(() => {
    msgTimes = { m1: '2026-10-20T01:00:00Z', m2: '2026-10-20T02:00:00Z', m3: '2026-10-20T03:00:00Z' }
    booking = { booking_id: 77, total_pax: 4, pickup: { meeting_point: 'Surabaya Airport', pickup_time: '10:30' } } as BookingData
  })

  it('one extraction with two values for a field keeps the NEWEST message, not the last in LLM output', async () => {
    await applyExtraction('c1', ex({
      changes: [item('pickup_time', '09:00', 'm3'), item('pickup_time', '10:00', 'm1')],
      facts: [item('total_pax', '4', 'm3'), item('total_pax', '5', 'm1')],
    }), NOW)
    expect(actions.filter((a) => a.type === 'CHANGE').map((a) => a.proposedValue)).toEqual(['09:00'])
    expect(facts.filter((f) => f.supersededAt === null && f.field === 'total_pax').map((f) => f.value)).toEqual(['4'])
    expect(actions.some((a) => a.type === 'MISMATCH')).toBe(false)
  })

  it('an older fact re-read later does not supersede a newer active fact', async () => {
    await applyExtraction('c1', ex({ facts: [item('total_pax', '4', 'm3')] }), NOW)
    await applyExtraction('c1', ex({ facts: [item('total_pax', '5', 'm1')] }), NOW)
    expect(facts.map((f) => [f.value, f.supersededAt])).toEqual([['4', null]])
    expect(actions).toHaveLength(0)
  })

  it('a proposal from a message at or before a REJECTED/EXECUTED/SUPERSEDED card of the same field is skipped; a newer message still proposes', async () => {
    for (const [state, closedReason] of [['REJECTED', 'REJECTED'], ['EXECUTED', 'EXECUTED'], ['SUPERSEDED', 'REPLACED'], ['RESOLVED', 'MATCHED_IN_BACKOFFICE']]) {
      actions = []
      actions.push({ id: 'old', conversationId: 'c1', bookingId: '77', type: 'CHANGE', field: 'pickup_time', proposedValue: '09:00', state, closedReason, closedById: null, sourceMessageId: 'm2' })
      expect((await applyExtraction('c1', ex({ changes: [item('pickup_time', '11:00', 'm1')] }), NOW)).created).toBe(0)
      expect((await applyExtraction('c1', ex({ changes: [item('pickup_time', '11:15', 'm2')] }), NOW)).created).toBe(0)
      expect((await applyExtraction('c1', ex({ changes: [item('pickup_time', '11:30', 'm3')] }), NOW)).created).toBe(1)
    }
  })

  it('watermark is per booking: a closed card of another booking does not block', async () => {
    actions.push({ id: 'old', conversationId: 'c1', bookingId: '55', type: 'CHANGE', field: 'pickup_time', proposedValue: '09:00', state: 'EXECUTED', closedReason: 'EXECUTED', sourceMessageId: 'm2' })
    expect((await applyExtraction('c1', ex({ changes: [item('pickup_time', '11:00', 'm1')] }), NOW)).created).toBe(1)
  })
})

describe('final review Important 5: a change supersedes older facts of its field', () => {
  beforeEach(() => {
    msgTimes = { m1: '2026-10-20T01:00:00Z', m2: '2026-10-20T02:00:00Z', m3: '2026-10-20T03:00:00Z', m4: '2026-10-20T04:00:00Z' }
  })

  it('pickup_point CHANGE supersedes older pickup_detail/pickup_arrival facts, not newer ones nor the drop side', async () => {
    booking = { booking_id: 77, total_pax: 4, pickup: { meeting_point: 'Surabaya Airport', meeting_point_value: 'GA 1', meeting_point_arrival: 'GA 1' }, dropoff: { drop_point: 'Surabaya Hotel', drop_point_value: 'Hotel X' } } as BookingData
    await applyExtraction('c1', ex({ facts: [item('pickup_detail', 'GA 1', 'm1'), item('pickup_arrival', 'GA 1', 'm2'), item('drop_detail', 'Hotel X', 'm1')] }), NOW)
    await applyExtraction('c1', ex({ changes: [item('pickup_point', 'Surabaya Hotel', 'm3')] }), NOW)
    const state = Object.fromEntries(facts.map((f) => [f.field, f.supersededAt]))
    expect(state).toEqual({ pickup_detail: NOW, pickup_arrival: NOW, drop_detail: null })
  })

  it('a fact NEWER than the change stays active', async () => {
    booking = { booking_id: 77, total_pax: 4, pickup: { meeting_point: 'Surabaya Airport', pickup_time: '10:30' } } as BookingData
    await applyExtraction('c1', ex({ facts: [item('pickup_time', '10:30', 'm4')] }), NOW)
    await applyExtraction('c1', ex({ changes: [item('pickup_time', '09:00', 'm2')] }), NOW)
    expect(facts.map((f) => f.supersededAt)).toEqual([null])
  })
})

describe('final review regression: execute then re-extract the last 20 messages creates no card', () => {
  const ids = ['m1', 'm2', 'm3']
  const inbound = new Set(ids)
  const reextract = (raw: string) => applyExtraction('c1', parseExtraction(raw, ids, inbound), NOW)
  /** Simulasi "Setujui" yang sukses (execute.ts): EXECUTED, booking memuat nilainya, fakta lama usang. */
  const executeOpenChange = async (apply: (b: BookingData) => BookingData) => {
    const a = actions.find((x) => x.type === 'CHANGE' && x.state === 'OPEN')!
    Object.assign(a, { state: 'EXECUTED', closedReason: 'EXECUTED', closedById: 'acc1', closedAt: NOW })
    booking = apply(booking!)
    await supersedeOlderFacts(db, { conversationId: 'c1', bookingId: '77', field: a.field as string, sourceMessageId: a.sourceMessageId as string, now: NOW })
  }
  const opened = () => actions.filter((a) => a.state === 'OPEN')

  beforeEach(() => {
    msgTimes = { m1: '2026-10-20T01:00:00Z', m2: '2026-10-20T02:00:00Z', m3: '2026-10-20T03:00:00Z' }
  })

  it('normal time: 10:30 -> 09:00 executed; re-reading (incl. the old 10:30 message) creates nothing', async () => {
    booking = { booking_id: 77, total_pax: 4, pickup: { meeting_point: 'Surabaya Airport', pickup_time: '10:30' } } as BookingData
    await reextract('{"changes":[{"field":"pickup_time","value":"09:00","pesan":2}],"facts":[{"field":"pickup_time","value":"10:30","pesan":1}]}')
    expect(opened().map((a) => a.proposedValue)).toEqual(['09:00'])
    await executeOpenChange((b) => ({ ...b, pickup: { ...b.pickup, pickup_time: '09:00' } }))
    const before = actions.length

    const r1 = await reextract('{"changes":[{"field":"pickup_time","value":"09:00","pesan":2}],"facts":[{"field":"pickup_time","value":"10:30","pesan":1}]}')
    const r2 = await reextract('{"changes":[{"field":"pickup_time","value":"10:30","pesan":1}],"facts":[]}')
    expect([r1.created, r2.created]).toEqual([0, 0])
    expect(actions).toHaveLength(before)
    expect(opened()).toHaveLength(0)
  })

  it("'07:00': 10:30 -> 07:00 executed; re-reading creates nothing (07:00 counts as applied)", async () => {
    booking = { booking_id: 77, total_pax: 4, pickup: { meeting_point: 'Surabaya Airport', pickup_time: '10:30' } } as BookingData
    await reextract('{"changes":[{"field":"pickup_time","value":"7 pagi","pesan":2}],"facts":[]}')
    expect(opened().map((a) => a.proposedValue)).toEqual(['07:00'])
    await executeOpenChange((b) => ({ ...b, pickup: { ...b.pickup, pickup_time: '07:00' } }))
    const before = actions.length

    expect((await reextract('{"changes":[{"field":"pickup_time","value":"07:00","pesan":2}],"facts":[]}')).created).toBe(0)
    expect((await reextract('{"changes":[{"field":"pickup_time","value":"10:30","pesan":1}],"facts":[]}')).created).toBe(0)
    expect(actions).toHaveLength(before)
    expect(opened()).toHaveLength(0)
  })

  it('reordered tshirt sizes: backoffice "M x 2, L x 1" vs chat "L x 1, M x 2" creates nothing', async () => {
    booking = { booking_id: 77, total_pax: 3, tshirtSize: 'M x 3', pickup: { meeting_point: 'Surabaya Airport' } } as BookingData
    await reextract('{"changes":[{"field":"tshirt_sizes","value":"L x 1, M x 2","pesan":2}],"facts":[]}')
    expect(opened().map((a) => a.proposedValue)).toEqual(['M x 2, L x 1'])
    await executeOpenChange((b) => ({ ...b, tshirtSize: 'M x 2, L x 1' }))
    const before = actions.length

    expect((await reextract('{"changes":[{"field":"tshirt_sizes","value":"l x 1, 2 m","pesan":2}],"facts":[{"field":"tshirt_sizes","value":"L x 1, M x 2","pesan":3}]}')).created).toBe(0)
    expect(actions).toHaveLength(before)
    expect(opened()).toHaveLength(0)
  })

  it('older fact: the fact stated before the executed change does not come back as a MISMATCH', async () => {
    booking = { booking_id: 77, total_pax: 4, pickup: { meeting_point: 'Surabaya Airport', pickup_time: '10:30' } } as BookingData
    await reextract('{"changes":[],"facts":[{"field":"pickup_time","value":"10:30","pesan":1}]}')
    await reextract('{"changes":[{"field":"pickup_time","value":"09:00","pesan":2}],"facts":[]}')
    await executeOpenChange((b) => ({ ...b, pickup: { ...b.pickup, pickup_time: '09:00' } }))
    const before = actions.length

    expect((await reextract('{"changes":[],"facts":[{"field":"pickup_time","value":"10:30","pesan":1}]}')).created).toBe(0)
    expect(await reevaluateBookingActions('c1', NOW)).toEqual({ resolved: 0, opened: 0 })
    expect(actions).toHaveLength(before)
    expect(actions.some((a) => a.type === 'MISMATCH')).toBe(false)
  })
})
