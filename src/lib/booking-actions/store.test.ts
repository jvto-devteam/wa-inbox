/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import type { BookingData } from '@/lib/booking/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))
vi.mock('@/lib/bot/llm', () => ({ callLLM: vi.fn() }))

import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { callLLM } from '@/lib/bot/llm'
import { applyExtraction, reevaluateBookingActions } from './store'

const db = prisma as unknown as DeepMockProxy<PrismaClient>
const NOW = new Date('2026-10-20T03:00:00Z')

type Row = Record<string, unknown> & { id: string }
let facts: Row[]
let actions: Row[]
let events: Row[]
let booking: BookingData | null
let seq: number

const matches = (row: Row, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && 'in' in (v as object)) return ((v as { in: unknown[] }).in).includes(row[k])
    return row[k] === v
  })

beforeEach(() => {
  mockReset(db)
  vi.mocked(broadcast).mockClear()
  vi.mocked(callLLM).mockClear()
  facts = []; actions = []; events = []; seq = 0
  booking = { booking_id: 77, total_pax: 4, pickup: { meeting_point: 'Surabaya Airport' } } as BookingData
  db.$transaction.mockImplementation((async (cb: (tx: unknown) => unknown) => cb(db)) as never)
  db.conversation.findUnique.mockImplementation((async () => ({ bookingData: booking })) as never)
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
  db.bookingActionEvent.create.mockImplementation((async ({ data }: { data: Record<string, unknown> }) => {
    const row = { id: `e${++seq}`, ...data }
    events.push(row)
    return row
  }) as never)
})

const ex = (over: { changes?: unknown[]; facts?: unknown[] }) => ({ changes: [], facts: [], ...over }) as never
const item = (field: string, value: string, messageId: string) => ({ field, value, messageId })

describe('applyExtraction', () => {
  it('heavy change becomes TASK', async () => {
    const r = await applyExtraction('c1', ex({ changes: [item('travel_date', '2026-11-05', 'm1')] }), NOW)
    expect(r.created).toBe(1)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ type: 'TASK', tier: 'HEAVY', state: 'OPEN', bookingId: '77', proposedValue: '2026-11-05' })
    expect(broadcast).toHaveBeenCalledWith({ type: 'booking-actions.changed', conversationId: 'c1' })
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
    expect(actions[0].state).toBe('RESOLVED')
    expect(actions).toHaveLength(1)
  })

  it('empty booking + AI field fact → CHANGE "isi data"; HEAVY field ignored', async () => {
    await applyExtraction('c1', ex({ facts: [item('pickup_detail', 'Hotel Majapahit', 'm1'), item('hotel', 'Bromo Permai', 'm2')] }), NOW)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ type: 'CHANGE', field: 'pickup_detail', proposedValue: 'Hotel Majapahit' })
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
