/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { authenticateApiClient } from '@/lib/api-clients/auth'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/api-clients/auth', () => ({ authenticateApiClient: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const payload = {
  version: 1,
  date: '2026-11-04',
  windowStart: 'a',
  windowEnd: 'b',
  generatedAt: 'c',
  thresholds: { unrepliedMinMs: 1, dormantMinMs: 1, lookbackMs: 1 },
  counts: { activeConversations: 1, inbound: 1, outbound: 1, newConversations: 0, reviewed: 1, reviewFailed: 0 },
  filteredOut: { unreplied: 0, dormant: 0 },
  unreplied: [],
  dormant: [],
  newLeads: [],
  handoffs: [],
  gaps: { newCount: 0, openTotal: 0, byReason: [], byTopic: [], items: [] },
  conversations: [{ conversationId: 'c1', contactName: 'Anna', pipelineStage: 'booked', inbound: 1, outbound: 1, review: null }],
}

const get = (query = '', key = 'wai_reader') =>
  GET(new Request(`http://x/api/v1/summaries${query}`, { headers: { authorization: `Bearer ${key}` } }))

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  process.env.SUMMARIES_READ_CLIENT_IDS = 'client_reader, client_other'
  vi.mocked(authenticateApiClient).mockResolvedValue({ id: 'client_reader', name: 'operator' })
  mockPrisma.dailySummary.findFirst.mockResolvedValue({ date: '2026-11-04', status: 'DONE', payload } as never)
  mockPrisma.dailySummary.findUnique.mockResolvedValue({ date: '2026-11-03', status: 'PARTIAL', payload } as never)
  mockPrisma.conversation.findMany.mockResolvedValue([{ id: 'c1', bookingData: { booking_number: 'JVTO-3890' } }] as never)
  ;(mockPrisma.summaryItem.groupBy as unknown as Mock).mockResolvedValue([{ kind: 'REPLY', state: 'OPEN', _count: { _all: 2 } }])
})

afterEach(() => {
  delete process.env.SUMMARIES_READ_CLIENT_IDS
})

describe('GET /api/v1/summaries', () => {
  it('rejects a request without a valid key', async () => {
    vi.mocked(authenticateApiClient).mockResolvedValue(null)
    const res = await get()
    expect(res.status).toBe(401)
    expect(mockPrisma.dailySummary.findFirst).not.toHaveBeenCalled()
  })

  it('rejects a valid key that is not on the read list', async () => {
    vi.mocked(authenticateApiClient).mockResolvedValue({ id: 'client_sender', name: 'legacy' })
    const res = await get()
    expect(res.status).toBe(403)
    expect(mockPrisma.dailySummary.findFirst).not.toHaveBeenCalled()
  })

  it('is closed for every key when the read list is empty', async () => {
    delete process.env.SUMMARIES_READ_CLIENT_IDS
    expect((await get()).status).toBe(403)
  })

  it('returns the latest finished summary as a digest, with booking refs and live open items', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(mockPrisma.dailySummary.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ['DONE', 'PARTIAL'] } }, orderBy: { date: 'desc' } })
    )
    expect(body.date).toBe('2026-11-04')
    expect(body.conversations[0]).toMatchObject({ conversationId: 'c1', bookingRef: 'JVTO-3890' })
    expect(body.openItems).toEqual([{ kind: 'REPLY', state: 'OPEN', count: 2 }])
    expect(JSON.stringify(body)).not.toContain('Anna')
  })

  it('reads a specific date', async () => {
    const res = await get('?date=2026-11-03')
    expect(res.status).toBe(200)
    expect(mockPrisma.dailySummary.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { date: '2026-11-03' } }))
  })

  it('rejects a malformed date', async () => {
    expect((await get('?date=4-11-2026')).status).toBe(400)
  })

  it('answers 404 when there is no summary and 409 while it is still running', async () => {
    mockPrisma.dailySummary.findUnique.mockResolvedValueOnce(null)
    expect((await get('?date=2026-01-01')).status).toBe(404)
    mockPrisma.dailySummary.findUnique.mockResolvedValueOnce({ date: '2026-11-05', status: 'RUNNING', payload: null } as never)
    expect((await get('?date=2026-11-05')).status).toBe(409)
  })

  it('answers 422 for a payload it cannot read', async () => {
    mockPrisma.dailySummary.findFirst.mockResolvedValueOnce({ date: '2026-11-04', status: 'DONE', payload: { version: 9 } } as never)
    expect((await get()).status).toBe(422)
  })

  it('answers 500 without leaking the error', async () => {
    mockPrisma.dailySummary.findFirst.mockRejectedValueOnce(new Error('connection string postgres://secret'))
    const res = await get()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal membaca ringkasan' })
  })
})
