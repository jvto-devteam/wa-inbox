/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
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
  })

  it('tanggal yang belum ada → summary null', async () => {
    mockPrisma.dailySummary.findUnique.mockResolvedValue(null)
    const body = await (await GET(req('?date=2026-09-10'))).json()
    expect(body.summary).toBeNull()
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
