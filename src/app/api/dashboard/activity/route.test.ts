/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function req(query = '', withSession = true) {
  return new Request(`http://localhost/api/dashboard/activity${query}`, {
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

// Beberapa `groupBy` berjalan di satu Promise.all lewat model yang sama
// (`botDecisionRun.groupBy` dipakai untuk statusGroups, byTopic, DAN byJob;
// `knowledgeGapLog.groupBy` dipakai untuk byReason DAN topTopics), jadi satu
// `mockResolvedValue` akan memberi hasil yang sama ke semuanya. Fixture-fixture
// di bawah ini dipilih lewat `args.by` di dalam `mockImplementation`.
let statusGroupsFixture: unknown[] = []
let topicStatusFixture: unknown[] = []
let jobStatusFixture: unknown[] = []
let reasonGroupsFixture: unknown[] = []
let topTopicsFixture: unknown[] = []

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })

  statusGroupsFixture = []
  topicStatusFixture = []
  jobStatusFixture = []
  reasonGroupsFixture = []
  topTopicsFixture = []

  ;(mockPrisma.botDecisionRun.groupBy as unknown as Mock).mockImplementation((args: { by: string[] }) => {
    if (args.by.includes('job')) return Promise.resolve(jobStatusFixture)
    if (args.by.includes('topic')) return Promise.resolve(topicStatusFixture)
    return Promise.resolve(statusGroupsFixture)
  })
  ;(mockPrisma.knowledgeGapLog.groupBy as unknown as Mock).mockImplementation((args: { by: string[] }) => {
    if (args.by.includes('topic')) return Promise.resolve(topTopicsFixture)
    return Promise.resolve(reasonGroupsFixture)
  })
  mockPrisma.botDecisionRun.aggregate.mockResolvedValue({
    _avg: { latencyMs: null },
    _max: { latencyMs: null },
  } as never)
  mockPrisma.botDecisionRun.count.mockResolvedValue(0 as never)
  mockPrisma.$queryRaw.mockResolvedValue([] as never)
})

describe('GET /api/dashboard/activity', () => {
  it('mengelompokkan keputusan per topik, dan urut total menurun', async () => {
    topicStatusFixture = [
      { topic: 'route_endpoint', status: 'CLARIFIED', _count: { _all: 12 } },
      { topic: 'payment', status: 'REPLIED', _count: { _all: 40 } },
      { topic: 'payment', status: 'HANDOFF', _count: { _all: 5 } },
    ]

    const body = await (await GET(req())).json()

    expect(body.byTopic).toContainEqual(
      expect.objectContaining({ topic: 'route_endpoint', clarified: 12, total: 12 })
    )
    expect(body.byTopic).toEqual([
      { topic: 'payment', total: 45, replied: 40, clarified: 0, handoff: 5 },
      { topic: 'route_endpoint', total: 12, replied: 0, clarified: 12, handoff: 0 },
    ])
  })

  it('mengelompokkan keputusan per job, dan urut total menurun', async () => {
    jobStatusFixture = [
      { job: 'book_trip', status: 'HANDOFF', _count: { _all: 8 } },
      { job: 'book_trip', status: 'REPLIED', _count: { _all: 2 } },
      { job: 'refund', status: 'REPLIED', _count: { _all: 20 } },
    ]

    const body = await (await GET(req())).json()

    expect(body.byJob).toEqual([
      { job: 'refund', total: 20, replied: 20, clarified: 0, handoff: 0 },
      { job: 'book_trip', total: 10, replied: 2, clarified: 0, handoff: 8 },
    ])
  })

  it('mengembalikan larik kosong saat tidak ada keputusan di rentang itu', async () => {
    const body = await (await GET(req())).json()

    expect(body.byTopic).toEqual([])
    expect(body.byJob).toEqual([])
  })

  it('menolak permintaan tanpa sesi', async () => {
    const res = await GET(req('', false))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  it('menolak days yang bukan 7/14/30', async () => {
    const res = await GET(req('?days=5'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'days harus salah satu dari 7, 14, 30' })
  })

  it('mengembalikan 500 dengan { error } dan tidak membocorkan pesan Prisma mentah', async () => {
    ;(mockPrisma.botDecisionRun.groupBy as unknown as Mock).mockImplementation(() =>
      Promise.reject(new Error('db down'))
    )

    const res = await GET(req())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: 'Gagal membaca aktivitas' })
    expect(JSON.stringify(body)).not.toContain('db down')
  })
})
