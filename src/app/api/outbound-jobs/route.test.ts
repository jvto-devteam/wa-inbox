/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { STUCK_SENDING_MS } from '@/lib/outbound/worker'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function req(query = '', withSession = true) {
  return new Request(`http://localhost/api/outbound-jobs${query}`, {
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job_1',
    conversationId: 'conv_1',
    messageId: 'msg_1',
    channel: 'UNOFFICIAL',
    provider: 'COEXIST',
    payload: { to: '6281234567890', text: 'Halo!' },
    status: 'FAILED',
    attempts: 4,
    maxAttempts: 4,
    nextAttemptAt: null,
    lastError: 'wa-coexist timeout',
    createdAt: new Date('2026-09-07T09:00:00.000Z'),
    updatedAt: new Date('2026-09-07T09:10:00.000Z'),
    ...overrides,
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.outboundJob.findMany.mockResolvedValue([job()] as never)
  mockPrisma.outboundJob.count.mockResolvedValue(0 as never)
  mockPrisma.conversation.findMany.mockResolvedValue([
    { id: 'conv_1', contact: { name: 'Budi', phone: '6281234567890' } },
  ] as never)
})

describe('GET /api/outbound-jobs', () => {
  it('refuses a request with no session', async () => {
    const res = await GET(req('', false))
    expect(res.status).toBe(401)
    expect(mockPrisma.outboundJob.findMany).not.toHaveBeenCalled()
  })

  it('returns the queue with the contact behind each job', async () => {
    // The point of the page: an operator seeing forty failed jobs needs to know WHO is waiting,
    // without opening forty conversations.
    const res = await GET(req())
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      id: 'job_1',
      status: 'FAILED',
      channel: 'UNOFFICIAL',
      provider: 'COEXIST',
      attempts: 4,
      maxAttempts: 4,
      lastError: 'wa-coexist timeout',
      contactName: 'Budi',
      contactPhone: '6281234567890',
    })
  })

  it('never returns the payload, which holds the message body', async () => {
    // The text is already readable in the conversation; a queue list is not a second place to
    // put every outbound message body.
    const body = await (await GET(req())).json()
    expect(body.items[0]).not.toHaveProperty('payload')
  })

  it('keeps a null contact rather than dropping the job', async () => {
    // The job outlives a deleted conversation. An empty cell is honest; a missing row is not.
    mockPrisma.conversation.findMany.mockResolvedValue([] as never)

    const body = await (await GET(req())).json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].contactName).toBeNull()
  })

  it('counts every status in the summary, not just the ones present', async () => {
    // A card reading "Queued 0" is information. A missing card looks like a broken page.
    // Call order: the filtered total first, then the six summary counts in JOB_STATUSES order.
    mockPrisma.outboundJob.count
      .mockResolvedValueOnce(1 as never)
      .mockResolvedValueOnce(2 as never)
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(3 as never)
      .mockResolvedValueOnce(0 as never)

    const body = await (await GET(req())).json()
    expect(body.total).toBe(1)
    expect(body.summary).toEqual({ QUEUED: 2, SENDING: 0, RETRYING: 0, SENT: 0, FAILED: 3, CANCELLED: 0 })
  })

  it('summarises the whole queue even while the list is filtered', async () => {
    await GET(req('?status=FAILED'))

    // Every summary count is keyed on status ALONE. If the page's own filter leaked into them,
    // filtering to FAILED would show "Queued 0" and hide the backlog behind the failures.
    const summaryCalls = mockPrisma.outboundJob.count.mock.calls.slice(1)
    expect(summaryCalls).toHaveLength(6)
    for (const [args] of summaryCalls) {
      expect(Object.keys(args?.where ?? {})).toEqual(['status'])
    }
  })

  it('filters by date range on createdAt', async () => {
    // SDD Manage Second §18.6.
    await GET(req('?dateFrom=2026-09-01&dateTo=2026-09-07'))
    expect(mockPrisma.outboundJob.findMany.mock.calls[0][0]?.where?.createdAt).toEqual({
      gte: new Date('2026-09-01'),
      lte: new Date('2026-09-07'),
    })
  })

  it('ignores an unparseable date instead of 500-ing on Invalid Date', async () => {
    // What a date picker sends mid-edit. Passing `Invalid Date` to Prisma turns a half-typed
    // filter into a 500; dropping it just shows unfiltered rows.
    await GET(req('?dateFrom=bukan-tanggal'))
    expect(mockPrisma.outboundJob.findMany.mock.calls[0][0]?.where).not.toHaveProperty('createdAt')
  })

  it('filters by status, channel, provider and conversation', async () => {
    await GET(req('?status=QUEUED&channel=UNOFFICIAL&provider=COEXIST&conversationId=conv_9'))
    expect(mockPrisma.outboundJob.findMany.mock.calls[0][0]?.where).toMatchObject({
      status: 'QUEUED',
      channel: 'UNOFFICIAL',
      provider: 'COEXIST',
      conversationId: 'conv_9',
    })
  })

  it('ignores an unknown status instead of silently returning nothing', async () => {
    // A typo'd filter that returns zero rows reads as "the queue is empty" — the most
    // misleading thing this page could say.
    await GET(req('?status=BUKAN_STATUS'))
    expect(mockPrisma.outboundJob.findMany.mock.calls[0][0]?.where).not.toHaveProperty('status')
  })

  it('ignores a channel value the enum has no member for', async () => {
    // Passing it through would hand Postgres a value outside MessageChannel and 500 the page.
    await GET(req('?channel=TELEGRAM'))
    expect(mockPrisma.outboundJob.findMany.mock.calls[0][0]?.where).not.toHaveProperty('channel')
  })

  it('exposes stuck jobs as a filter, so recovery can be inspected before it is run', async () => {
    const before = Date.now() - STUCK_SENDING_MS
    await GET(req('?stuck=true'))

    const where = mockPrisma.outboundJob.findMany.mock.calls[0][0]?.where
    expect(where).toMatchObject({ status: 'SENDING' })
    const cutoff = (where?.updatedAt as { lt: Date }).lt
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - 1000)
    expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now() - STUCK_SENDING_MS + 1000)
  })

  it('clamps paging so one query string cannot scan the whole table', async () => {
    await GET(req('?limit=100000&page=-3'))
    const call = mockPrisma.outboundJob.findMany.mock.calls[0][0]
    expect(call?.take).toBe(200)
    expect(call?.skip).toBe(0)
  })

  it('reports a database failure as a 500, not a crash', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.outboundJob.findMany.mockRejectedValue(new Error('db down'))

    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal memuat antrean pengiriman' })
  })
})
