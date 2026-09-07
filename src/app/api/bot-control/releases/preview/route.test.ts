/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function req(withSession = true) {
  return new Request('http://localhost/api/bot-control/releases/preview', {
    method: 'POST',
    headers: withSession ? { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' } : {},
    body: JSON.stringify({}),
  })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  mockPrisma.botRuleSetting.findMany.mockResolvedValue([] as never)
  // previewRelease asks twice: APPROVED knowledge to count, REVIEW knowledge to warn about.
  mockPrisma.knowledgeRevision.findMany.mockResolvedValue([] as never)
})

describe('POST /api/bot-control/releases/preview', () => {
  it('returns the change summary shape the SDD specifies', async () => {
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      changes: { rules: 0, knowledge: 0, flows: 0, channelPolicy: 0 },
      requiresTestRun: false,
      blockingIssues: [],
    })
  })

  it('refuses an AGENT — a preview enumerates every pending change in the account', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
    expect((await POST(req())).status).toBe(403)
  })

  it('refuses a request with no session', async () => {
    expect((await POST(req(false))).status).toBe(403)
  })

  it('counts approved rules and surfaces a blocking issue', async () => {
    mockPrisma.botRuleSetting.findMany.mockResolvedValue([
      { key: 'bot.handoff_on_human_request', name: 'Handoff' },
      { key: 'bot.no_invented_price', name: 'Tidak mengarang harga' },
    ] as never)

    const body = await (await POST(req())).json()
    expect(body.changes.rules).toBe(2)
    // The locked rule cannot ship; preview says so before the operator presses Publish.
    expect(body.blockingIssues).toHaveLength(1)
    expect(body.blockingIssues[0]).toContain('bot.no_invented_price')
  })

  it('reports a database failure as a 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.botRuleSetting.findMany.mockRejectedValue(new Error('db down'))

    const res = await POST(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal membuat preview release' })
  })

  it('counts approved knowledge and warns about revisions left in review', async () => {
    // A revision still in REVIEW does not block an unrelated publish, but an operator pressing
    // Publish with work still in review needs to be told it is being left behind.
    // Prisma types `where.status` as a string OR a filter object, so the narrowing has to be a
    // runtime check rather than a parameter annotation.
    mockPrisma.knowledgeRevision.findMany.mockImplementation((args) => {
      const status = args?.where?.status
      return (status === 'APPROVED'
        ? [{ id: 'krev_1', title: 'FAQ ATV', version: 2 }]
        : [{ title: 'FAQ Ijen', version: 1 }]) as never
    })

    const body = await (await POST(req())).json()
    expect(body.changes.knowledge).toBe(1)
    expect(body.blockingIssues).toHaveLength(1)
    expect(body.blockingIssues[0]).toContain('FAQ Ijen')
  })
})