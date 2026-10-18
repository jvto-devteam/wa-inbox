/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/summary-items/sync', () => ({ reconcileSummaryItems: vi.fn().mockResolvedValue(undefined) }))

import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { reconcileSummaryItems } from '@/lib/summary-items/sync'
import { GET } from './route'

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const req = (query = '') => new Request(`http://localhost/api/daily-summary${query}`, { headers: { cookie: 'wa_inbox_session=tok' } })

const payload = {
  version: 1,
  date: '2026-09-21',
  windowStart: '2026-09-20T17:00:00.000Z',
  windowEnd: '2026-09-21T17:00:00.000Z',
  generatedAt: '2026-09-21T17:03:00.000Z',
  thresholds: { unrepliedMinMs: 3600000, dormantMinMs: 172800000, lookbackMs: 1209600000 },
  counts: { activeConversations: 0, inbound: 0, outbound: 0, newConversations: 0, reviewed: 0, reviewFailed: 0 },
  filteredOut: { unreplied: 0, dormant: 0 },
  unreplied: [],
  dormant: [],
  newLeads: [],
  handoffs: [],
  gaps: { newCount: 0, openTotal: 0, byReason: [], byTopic: [], items: [] },
  conversations: [],
}

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'ds1',
  date: '2026-09-21',
  status: 'DONE',
  model: 'gemma4:31b-cloud',
  startedAt: new Date('2026-09-21T17:00:00Z'),
  finishedAt: new Date('2026-09-21T17:03:00Z'),
  error: null,
  payload,
  ...overrides,
})

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(reconcileSummaryItems).mockClear()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.dailySummary.findMany.mockResolvedValue([{ date: '2026-09-21', status: 'DONE' }] as never)
})

describe('GET /api/daily-summary', () => {
  it('401 tanpa sesi', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null)
    expect((await GET(req())).status).toBe(401)
  })

  it('tanpa tanggal = tanggal terbaru; agen boleh membaca', async () => {
    mockPrisma.dailySummary.findUnique.mockResolvedValue(row() as never)
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dates).toEqual([{ date: '2026-09-21', status: 'DONE' }])
    expect(body.summary).toMatchObject({ date: '2026-09-21', status: 'DONE', payload: { date: '2026-09-21' } })
    expect(mockPrisma.dailySummary.findUnique).toHaveBeenCalledWith({ where: { date: '2026-09-21' } })
    // Payload tanpa percakapan: tidak ada yang perlu dicari, jadi tidak ada kueri item.
    expect(body.items).toEqual({})
    expect(mockPrisma.summaryItem.findMany).not.toHaveBeenCalled()
  })

  it('items = status SummaryItem sekarang untuk tiap percakapan di payload, sesudah rekonsiliasi', async () => {
    const ref = (id: string) => ({ conversationId: id, contactName: null, pipelineStage: 'new' })
    const review = null
    const withConversations = {
      ...payload,
      unreplied: [{ ...ref('c1'), lastMessageAt: '2026-09-21T10:00:00.000Z', waitingMs: 1, snippet: 'halo', review }],
      dormant: [{ ...ref('c2'), lastMessageAt: '2026-09-19T10:00:00.000Z', silentMs: 1, snippet: 'harga', review }],
      newLeads: [{ ...ref('c3'), createdAt: '2026-09-21T09:00:00.000Z', tripBrief: null, review }],
      handoffs: [{ runId: 'r1', conversationId: 'c4', contactName: null, at: '2026-09-21T11:00:00.000Z', inboundText: 'admin', stillWaiting: true }],
      conversations: [{ ...ref('c1'), inbound: 2, outbound: 0, review }, { ...ref('c5'), inbound: 1, outbound: 1, review }],
    }
    mockPrisma.dailySummary.findUnique.mockResolvedValue(row({ payload: withConversations }) as never)
    const order: string[] = []
    vi.mocked(reconcileSummaryItems).mockImplementation(async () => {
      order.push('reconcile')
      return { closed: 0, converted: 0, reopened: 0 }
    })
    mockPrisma.summaryItem.findMany.mockImplementation((async () => {
      order.push('findMany')
      return [
        { id: 'si1', conversationId: 'c1', kind: 'REPLY', state: 'OPEN', dueAt: null, closedReason: null, note: null, closedAt: null },
        {
          id: 'si2',
          conversationId: 'c2',
          kind: 'FOLLOW_UP',
          state: 'DONE',
          dueAt: new Date('2026-09-22T02:00:00Z'),
          closedReason: 'REPLIED',
          note: 'catatan',
          closedAt: new Date('2026-09-22T03:00:00Z'),
        },
      ]
    }) as never)

    const body = await (await GET(req('?date=2026-09-21'))).json()

    expect(order).toEqual(['reconcile', 'findMany'])
    const where = mockPrisma.summaryItem.findMany.mock.calls[0][0]?.where as { conversationId: { in: string[] } }
    expect(where.conversationId.in.sort()).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
    expect(body.items).toEqual({
      c1: { id: 'si1', kind: 'REPLY', state: 'OPEN', dueAt: null, closedReason: null, note: null, closedAt: null },
      c2: {
        id: 'si2',
        kind: 'FOLLOW_UP',
        state: 'DONE',
        dueAt: '2026-09-22T02:00:00.000Z',
        closedReason: 'REPLIED',
        note: 'catatan',
        closedAt: '2026-09-22T03:00:00.000Z',
      },
    })
  })

  it('tanggal yang belum ada → summary null', async () => {
    mockPrisma.dailySummary.findUnique.mockResolvedValue(null)
    const body = await (await GET(req('?date=2026-09-10'))).json()
    expect(body.summary).toBeNull()
    expect(body.items).toEqual({})
  })

  it('400 untuk format tanggal salah', async () => {
    expect((await GET(req('?date=kemarin'))).status).toBe(400)
  })

  it('payload yang bentuknya tidak dikenali tampil sebagai error, bukan pecah', async () => {
    mockPrisma.dailySummary.findUnique.mockResolvedValue(row({ payload: { version: 99 } }) as never)
    const body = await (await GET(req('?date=2026-09-21'))).json()
    expect(body.summary.payload).toBeNull()
    expect(body.summary.error).toMatch(/tidak dikenali/)
  })
})
