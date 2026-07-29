import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { getConversationCosts } from '@/lib/meta/analytics'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/meta/analytics', () => ({ getConversationCosts: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function request(qs = '') {
  return new Request(`http://localhost/api/analytics/conversation-cost${qs}`, { headers: { cookie: 'wa_inbox_session=tok' } })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(getConversationCosts).mockReset()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ wabaId: 'waba_1', accessToken: 'tok' } as never)
})

describe('GET /api/analytics/conversation-cost', () => {
  it('aggregates data points by category and by day, and sums a grand total', async () => {
    vi.mocked(getConversationCosts).mockResolvedValue({
      currency: 'USD',
      dataPoints: [
        { start: 1735689600, end: 1735776000, conversationCategory: 'MARKETING', conversationCount: 3, cost: 1.5 },
        { start: 1735689600, end: 1735776000, conversationCategory: 'SERVICE', conversationCount: 5, cost: 0.4 },
        { start: 1735776000, end: 1735862400, conversationCategory: 'MARKETING', conversationCount: 2, cost: 1.0 },
      ],
    })

    const res = await GET(request())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.currency).toBe('USD')
    expect(body.totalCost).toBeCloseTo(2.9)
    expect(body.byCategory).toEqual([
      { category: 'MARKETING', cost: 2.5, conversationCount: 5 },
      { category: 'SERVICE', cost: 0.4, conversationCount: 5 },
    ])
    expect(body.daily).toEqual([
      { date: '2025-01-01', cost: 1.9 },
      { date: '2025-01-02', cost: 1.0 },
    ])
  })

  it('labels a data point with no category as UNKNOWN rather than dropping it', async () => {
    vi.mocked(getConversationCosts).mockResolvedValue({
      currency: 'USD',
      dataPoints: [{ start: 1735689600, end: 1735776000, conversationCategory: null, conversationCount: 1, cost: 0.1 }],
    })

    const res = await GET(request())
    const body = await res.json()

    expect(body.byCategory).toEqual([{ category: 'UNKNOWN', cost: 0.1, conversationCount: 1 }])
  })

  it('passes a days-based date range through to getConversationCosts', async () => {
    vi.mocked(getConversationCosts).mockResolvedValue({ currency: 'USD', dataPoints: [] })

    await GET(request('?days=7'))

    const [, range] = vi.mocked(getConversationCosts).mock.calls[0]
    expect(range.endUnix - range.startUnix).toBe(7 * 86400)
  })

  it('clamps an out-of-range days value to the 90-day Meta API maximum', async () => {
    vi.mocked(getConversationCosts).mockResolvedValue({ currency: 'USD', dataPoints: [] })

    await GET(request('?days=9000'))

    const [, range] = vi.mocked(getConversationCosts).mock.calls[0]
    expect(range.endUnix - range.startUnix).toBe(90 * 86400)
  })

  it('returns 502 with a message when the Meta call fails', async () => {
    vi.mocked(getConversationCosts).mockRejectedValue(new Error('Invalid OAuth access token'))

    const res = await GET(request())

    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('Invalid OAuth access token')
  })

  it('rejects non-admin callers with 403', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
    const res = await GET(request())
    expect(res.status).toBe(403)
    expect(getConversationCosts).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated callers with 403', async () => {
    const res = await GET(new Request('http://localhost/api/analytics/conversation-cost'))
    expect(res.status).toBe(403)
  })
})
