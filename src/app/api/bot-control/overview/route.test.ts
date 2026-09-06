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

// Prisma's `groupBy` is a heavily overloaded generic, so vitest-mock-extended cannot surface a
// mock through the type system even though the runtime object is one. Same handle as
// documentation-exporter.test.ts uses for the identical problem.
const groupByMock = mockPrisma.knowledgeGapLog.groupBy as unknown as ReturnType<typeof vi.fn>

const META_ACCESS_TOKEN = 'EAAG-super-secret-meta-token'
const COEXIST_API_KEY = 'coexist-live-key-98765'

function req(withSession = true) {
  return new Request('http://localhost/api/bot-control/overview', {
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({
    botAutoReplyAll: true,
    defaultChannel: 'UNOFFICIAL',
  } as never)
  mockPrisma.waNumber.count.mockResolvedValue(1 as never)
  mockPrisma.knowledgeSource.count.mockResolvedValue(32 as never)
  mockPrisma.botDecisionRun.count.mockResolvedValue(7 as never)
  mockPrisma.knowledgeGapLog.count.mockResolvedValue(2 as never)
  mockPrisma.outboundJob.count.mockResolvedValue(1 as never)
  mockPrisma.botDecisionRun.findMany.mockResolvedValue([] as never)
  groupByMock.mockResolvedValue([])
  mockPrisma.outboundJob.findMany.mockResolvedValue([] as never)
  mockPrisma.conversation.findMany.mockResolvedValue([] as never)
})

describe('GET /api/bot-control/overview', () => {
  it('returns the cards and the three data widgets', async () => {
    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.cards).toMatchObject({
      botMode: 'ON',
      outboundDefault: 'UNOFFICIAL',
      officialWebhook: 'ACTIVE',
      unofficialProvider: 'CONFIGURED',
      knowledgeSources: 32,
      failedOutboundJobs: 1,
    })
    expect(body).toHaveProperty('latestDecisions')
    expect(body).toHaveProperty('topUnansweredTopics')
    expect(body).toHaveProperty('recentFailedSends')
  })

  it('is readable by an AGENT — the overview is read-only', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_2', role: 'AGENT', tokenVersion: 0 })
    expect((await GET(req())).status).toBe(200)
  })

  it('answers 401 without a session', async () => {
    const res = await GET(req(false))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Tidak terautentikasi' })
  })

  it('leaks no WhatsApp credential even when the rows hold one', async () => {
    // The route reduces credentials to a count, so a WaNumber row carrying real secrets must
    // still produce a body with none of them in it. Asserting on the serialised body rather
    // than on a field name is what catches a future `...waNumber` spread.
    mockPrisma.waNumber.count.mockImplementation((async () => 1) as never)
    mockPrisma.waNumber.findFirst.mockResolvedValue({
      accessToken: META_ACCESS_TOKEN,
      coexistApiKey: COEXIST_API_KEY,
    } as never)

    const raw = await (await GET(req())).text()

    expect(raw).not.toContain(META_ACCESS_TOKEN)
    expect(raw).not.toContain(COEXIST_API_KEY)
  })

  it('answers 500 with a plain message, not the raw database error', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockRejectedValue(new Error('relation "Settings" does not exist'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await GET(req())

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal memuat ringkasan Bot Control' })
  })
})
