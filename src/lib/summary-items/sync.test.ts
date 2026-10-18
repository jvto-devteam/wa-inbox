/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { Prisma, type PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

import { prisma } from '@/lib/db'
import { RETENTION_MS } from '@/lib/daily-summary/config'
import type { DailySummaryPayload } from '@/lib/daily-summary/payload-schema'
import { pruneSummaryItems, reconcileSummaryItems, syncSummaryItems } from './sync'

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const NOW = new Date('2026-10-18T10:00:00Z')
const at = (iso: string) => new Date(iso)

function payload(over: Partial<Pick<DailySummaryPayload, 'unreplied' | 'dormant' | 'handoffs' | 'newLeads'>> = {}): DailySummaryPayload {
  return { unreplied: [], dormant: [], handoffs: [], newLeads: [], ...over } as unknown as DailySummaryPayload
}
const unreplied = (id: string, lastMessageAt: string) => ({
  conversationId: id, contactName: 'Budi', pipelineStage: 'new', lastMessageAt, lastMessageId: `m-${id}`, waitingMs: 1, snippet: 'halo', review: null,
})
const row = (over: Record<string, unknown> = {}) => ({
  id: 'i1', conversationId: 'c1', kind: 'REPLY', state: 'OPEN', anchorAt: at('2026-10-17T01:00:00Z'), anchorMessageId: 'm1', snippet: 'halo',
  review: null, handoff: false, newLead: false, openedOn: '2026-10-16', lastSeenOn: '2026-10-17', reminderId: null, dueAt: null,
  closedReason: null, note: null, closedById: null, closedAt: null, ...over,
})

beforeEach(() => {
  mockReset(mockPrisma)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('syncSummaryItems', () => {
  it('membuat item baru OPEN dengan openedOn = lastSeenOn = tanggal', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(null)
    const r = await syncSummaryItems('2026-10-17', payload({ unreplied: [unreplied('c1', '2026-10-17T01:00:00Z')] as never }), NOW)
    expect(r).toEqual({ created: 1, updated: 0, reopened: 0 })
    const data = mockPrisma.summaryItem.create.mock.calls[0][0].data
    expect(data).toMatchObject({ conversationId: 'c1', kind: 'REPLY', state: 'OPEN', openedOn: '2026-10-17', lastSeenOn: '2026-10-17', anchorMessageId: 'm-c1', review: Prisma.DbNull })
  })

  it('item OPEN: openedOn tetap, lastSeenOn naik', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(row() as never)
    const r = await syncSummaryItems('2026-10-18', payload({ unreplied: [unreplied('c1', '2026-10-17T01:00:00Z')] as never }), NOW)
    expect(r.updated).toBe(1)
    const data = mockPrisma.summaryItem.update.mock.calls[0][0].data
    expect(data.lastSeenOn).toBe('2026-10-18')
    expect(data).not.toHaveProperty('openedOn')
    expect(data).not.toHaveProperty('state')
  })

  it('DONE dengan anchor lebih baru dari closedAt dibuka ulang dan penutupan dikosongkan', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(
      row({ state: 'DONE', closedReason: 'REPLIED', closedAt: at('2026-10-17T05:00:00Z'), note: 'x', closedById: 'a', reminderId: 'r', dueAt: NOW }) as never
    )
    const r = await syncSummaryItems('2026-10-18', payload({ unreplied: [unreplied('c1', '2026-10-17T08:00:00Z')] as never }), NOW)
    expect(r.reopened).toBe(1)
    expect(mockPrisma.summaryItem.update.mock.calls[0][0].data).toMatchObject({
      state: 'OPEN', openedOn: '2026-10-18', lastSeenOn: '2026-10-18', closedReason: null, note: null, closedById: null, closedAt: null, reminderId: null, dueAt: null,
    })
  })

  it('DROPPED dengan anchor sama/lebih lama tidak disentuh', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(row({ state: 'DROPPED', closedReason: 'DROPPED', closedAt: at('2026-10-17T05:00:00Z') }) as never)
    const r = await syncSummaryItems('2026-10-18', payload({ unreplied: [unreplied('c1', '2026-10-17T05:00:00Z')] as never }), NOW)
    expect(r).toEqual({ created: 0, updated: 0, reopened: 0 })
    expect(mockPrisma.summaryItem.update).not.toHaveBeenCalled()
  })

  it('menelan error', async () => {
    mockPrisma.summaryItem.findUnique.mockRejectedValue(new Error('db down'))
    await expect(syncSummaryItems('2026-10-18', payload({ unreplied: [unreplied('c1', '2026-10-17T05:00:00Z')] as never }), NOW)).resolves.toEqual({ created: 0, updated: 0, reopened: 0 })
  })
})

describe('reconcileSummaryItems', () => {
  const inbound = { id: 'in1', direction: 'INBOUND', sentBy: 'CUSTOMER', type: 'TEXT', content: 'masih ada?', createdAt: at('2026-10-18T02:00:00Z') }

  it('REPLY dengan OUTBOUND sesudah anchor -> DONE/REPLIED dan reminder done', async () => {
    mockPrisma.summaryItem.findMany.mockResolvedValue([row({ state: 'SCHEDULED', reminderId: 'r1' })] as never)
    mockPrisma.message.findFirst.mockResolvedValue({ id: 'o1' } as never)
    const r = await reconcileSummaryItems(NOW)
    expect(r).toEqual({ closed: 1, converted: 0, reopened: 0 })
    expect(mockPrisma.summaryItem.update.mock.calls[0][0].data).toMatchObject({ state: 'DONE', closedReason: 'REPLIED', closedAt: NOW })
    expect(mockPrisma.reminder.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'r1' }, data: { done: true } })
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('FOLLOW_UP + inbound -> REPLY dengan anchor inbound', async () => {
    mockPrisma.summaryItem.findMany.mockResolvedValue([row({ kind: 'FOLLOW_UP' })] as never)
    mockPrisma.message.findFirst.mockImplementation((async (a: { where: { direction: string } }) => (a.where.direction === 'INBOUND' ? inbound : null)) as never)
    const r = await reconcileSummaryItems(NOW)
    expect(r).toEqual({ closed: 0, converted: 1, reopened: 0 })
    expect(mockPrisma.summaryItem.update.mock.calls[0][0].data).toMatchObject({
      kind: 'REPLY', state: 'OPEN', anchorAt: inbound.createdAt, anchorMessageId: 'in1', snippet: 'masih ada?', reminderId: null, dueAt: null,
    })
  })

  it('FOLLOW_UP + inbound + outbound sesudahnya -> DONE', async () => {
    mockPrisma.summaryItem.findMany.mockResolvedValue([row({ kind: 'FOLLOW_UP' })] as never)
    mockPrisma.message.findFirst.mockImplementation((async (a: { where: { direction: string } }) => (a.where.direction === 'INBOUND' ? inbound : { id: 'o1' })) as never)
    const r = await reconcileSummaryItems(NOW)
    expect(r).toMatchObject({ closed: 1, converted: 1 })
    expect(mockPrisma.summaryItem.update.mock.calls[0][0].data).toMatchObject({ state: 'DONE', closedReason: 'REPLIED', kind: 'REPLY' })
  })

  it('SCHEDULED + reminder done -> DONE/REMINDER_DONE', async () => {
    mockPrisma.summaryItem.findMany.mockResolvedValue([row({ kind: 'FOLLOW_UP', state: 'SCHEDULED', reminderId: 'r1' })] as never)
    mockPrisma.message.findFirst.mockResolvedValue(null)
    mockPrisma.reminder.findUnique.mockResolvedValue({ id: 'r1', done: true, dueAt: at('2026-10-20T00:00:00Z') } as never)
    const r = await reconcileSummaryItems(NOW)
    expect(r.closed).toBe(1)
    expect(mockPrisma.summaryItem.update.mock.calls[0][0].data).toMatchObject({ state: 'DONE', closedReason: 'REMINDER_DONE', closedAt: NOW })
  })

  it('SCHEDULED + dueAt lewat -> OPEN, reminderId dipertahankan', async () => {
    mockPrisma.summaryItem.findMany.mockResolvedValue([row({ kind: 'FOLLOW_UP', state: 'SCHEDULED', reminderId: 'r1' })] as never)
    mockPrisma.message.findFirst.mockResolvedValue(null)
    mockPrisma.reminder.findUnique.mockResolvedValue({ id: 'r1', done: false, dueAt: at('2026-10-18T09:00:00Z') } as never)
    const r = await reconcileSummaryItems(NOW)
    expect(r.reopened).toBe(1)
    const data = mockPrisma.summaryItem.update.mock.calls[0][0].data
    expect(data).toEqual({ state: 'OPEN' })
  })

  it('SCHEDULED + reminder hilang -> OPEN, reminderId dikosongkan', async () => {
    mockPrisma.summaryItem.findMany.mockResolvedValue([row({ kind: 'FOLLOW_UP', state: 'SCHEDULED', reminderId: 'r1' })] as never)
    mockPrisma.message.findFirst.mockResolvedValue(null)
    mockPrisma.reminder.findUnique.mockResolvedValue(null)
    await reconcileSummaryItems(NOW)
    expect(mockPrisma.summaryItem.update.mock.calls[0][0].data).toEqual({ state: 'OPEN', reminderId: null, dueAt: null })
  })

  it('menelan error', async () => {
    mockPrisma.summaryItem.findMany.mockRejectedValue(new Error('db down'))
    await expect(reconcileSummaryItems(NOW)).resolves.toEqual({ closed: 0, converted: 0, reopened: 0 })
  })
})

describe('pruneSummaryItems', () => {
  it('memakai batas 30 hari dari closedAt', async () => {
    mockPrisma.summaryItem.deleteMany.mockResolvedValue({ count: 2 })
    await expect(pruneSummaryItems(NOW)).resolves.toEqual({ deleted: 2 })
    expect(mockPrisma.summaryItem.deleteMany.mock.calls[0][0]).toEqual({
      where: { state: { in: ['DONE', 'DROPPED'] }, closedAt: { lt: new Date(NOW.getTime() - RETENTION_MS) } },
    })
    expect(RETENTION_MS).toBe(30 * 24 * 3600 * 1000)
  })

  it('menelan error', async () => {
    mockPrisma.summaryItem.deleteMany.mockRejectedValue(new Error('x'))
    await expect(pruneSummaryItems(NOW)).resolves.toEqual({ deleted: 0 })
  })
})
