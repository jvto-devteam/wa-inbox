/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function req(query = '', withSession = true) {
  return new Request(`http://localhost/api/bot-control/decisions${query}`, {
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run_1',
    conversationId: 'conv_1',
    messageId: 'msg_1',
    mode: 'faq',
    status: 'REPLIED',
    inboundText: 'berapa harga ijen 3d2n dari bali?',
    replyText: 'Rp 1.500.000',
    flowKey: 'whatsapp-existing-bot-v1',
    flowVersion: 1,
    latencyMs: 2500,
    trace: { mode: 'faq' },
    knowledgeRefs: { sourceTopic: 'price' },
    verification: null,
    error: null,
    startedAt: new Date('2026-09-05T03:00:00.000Z'),
    finishedAt: new Date('2026-09-05T03:00:02.500Z'),
    ...overrides,
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.botDecisionRun.findMany.mockResolvedValue([runRow()] as never)
  mockPrisma.botDecisionRun.count.mockResolvedValue(1 as never)
  mockPrisma.conversation.findMany.mockResolvedValue([
    { id: 'conv_1', contact: { name: 'Bruno Figarola', phone: '6281234567890' } },
  ] as never)
})

describe('GET /api/bot-control/decisions', () => {
  it('returns the paged shape with the contact resolved', async () => {
    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ page: 1, limit: 50, total: 1 })
    expect(body.items[0]).toMatchObject({
      id: 'run_1',
      contactName: 'Bruno Figarola',
      mode: 'faq',
      status: 'REPLIED',
      latencyMs: 2500,
      knowledgeRefsCount: 1,
      hasVerification: false,
      startedAt: '2026-09-05T03:00:00.000Z',
    })
  })

  it('resolves contacts in ONE extra query, not one per row', async () => {
    // At 50 rows, a per-row lookup would be 50 round-trips for a decorative column.
    mockPrisma.botDecisionRun.findMany.mockResolvedValue([
      runRow({ id: 'a', conversationId: 'conv_1' }),
      runRow({ id: 'b', conversationId: 'conv_2' }),
      runRow({ id: 'c', conversationId: 'conv_1' }),
    ] as never)

    await GET(req())

    expect(mockPrisma.conversation.findMany).toHaveBeenCalledTimes(1)
    expect(mockPrisma.conversation.findMany.mock.calls[0][0]?.where).toEqual({ id: { in: ['conv_1', 'conv_2'] } })
  })

  it('reports a deleted conversation as a null contact rather than failing', async () => {
    // The audit row deliberately outlives the conversation it describes (no foreign key).
    mockPrisma.conversation.findMany.mockResolvedValue([] as never)

    const body = await (await GET(req())).json()
    expect(body.items[0]).toMatchObject({ contactName: null, contactPhone: null })
  })

  it('skips the contact query entirely when there are no runs', async () => {
    mockPrisma.botDecisionRun.findMany.mockResolvedValue([] as never)
    mockPrisma.botDecisionRun.count.mockResolvedValue(0 as never)

    const body = await (await GET(req())).json()
    expect(body.items).toEqual([])
    expect(mockPrisma.conversation.findMany).not.toHaveBeenCalled()
  })

  it('filters by status, mode and conversation in the database query', async () => {
    await GET(req('?status=HANDOFF&mode=handoff&conversationId=conv_9'))
    const where = mockPrisma.botDecisionRun.findMany.mock.calls[0][0]?.where
    expect(where).toMatchObject({ status: 'HANDOFF', mode: 'handoff', conversationId: 'conv_9' })
    expect(mockPrisma.botDecisionRun.count.mock.calls[0][0]?.where).toEqual(where)
  })

  it('filters by messageId, which is how the inbox popover finds a run', async () => {
    await GET(req('?messageId=msg_7'))
    expect(mockPrisma.botDecisionRun.findMany.mock.calls[0][0]?.where).toMatchObject({ messageId: 'msg_7' })
  })

  it('applies a date range on startedAt', async () => {
    await GET(req('?dateFrom=2026-09-01&dateTo=2026-09-05'))
    const where = mockPrisma.botDecisionRun.findMany.mock.calls[0][0]?.where
    expect(where?.startedAt).toEqual({ gte: new Date('2026-09-01'), lte: new Date('2026-09-05') })
  })

  it('ignores an unparseable date instead of turning it into a 500', async () => {
    // A half-typed date in a picker should show unfiltered results, not an error.
    const res = await GET(req('?dateFrom=not-a-date'))
    expect(res.status).toBe(200)
    expect(mockPrisma.botDecisionRun.findMany.mock.calls[0][0]?.where?.startedAt).toBeUndefined()
  })

  it('orders newest first', async () => {
    await GET(req())
    expect(mockPrisma.botDecisionRun.findMany.mock.calls[0][0]?.orderBy).toEqual({ startedAt: 'desc' })
  })

  it('truncates the inbound preview', async () => {
    mockPrisma.botDecisionRun.findMany.mockResolvedValue([runRow({ inboundText: 'x'.repeat(400) })] as never)
    const body = await (await GET(req())).json()
    expect(body.items[0].inboundPreview).toHaveLength(140)
  })

  it('rejects a request with no session', async () => {
    const res = await GET(req('', false))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Tidak terautentikasi' })
  })

  it('clamps paging the same way the other Bot Control lists do', async () => {
    await GET(req('?page=3&limit=9999'))
    expect(mockPrisma.botDecisionRun.findMany.mock.calls[0][0]).toMatchObject({ skip: 400, take: 200 })
  })

  it('returns 500 with the mandated { error } shape when the query fails', async () => {
    mockPrisma.botDecisionRun.findMany.mockRejectedValue(new Error('db down'))
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal memuat log keputusan' })
  })
})
