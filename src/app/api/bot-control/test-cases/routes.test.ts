/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { runTestCases } from '@/lib/bot-control/test-runner'
import { GET, POST } from './route'
import { PATCH, DELETE } from './[id]/route'
import { POST as runOne } from './[id]/run/route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/test-runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bot-control/test-runner')>()
  return { ...actual, runTestCases: vi.fn() }
})

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const params = Promise.resolve({ id: 'case_1' })

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'case_1',
    name: 'Harga ATV',
    description: null,
    category: 'Pricing',
    inputText: 'Berapa harga ATV?',
    conversationSeed: null,
    expectedStatus: 'WOULD_REPLY',
    expectedFlowKey: null,
    expectedContains: 'Rp',
    expectedNotContains: null,
    expectedHandoff: false,
    requiredKnowledgeKeys: null,
    enabled: true,
    createdBy: 'acc_1',
    createdAt: new Date('2026-09-07T02:00:00.000Z'),
    updatedAt: new Date('2026-09-07T02:00:00.000Z'),
    ...overrides,
  } as never
}

function req(query = '', withSession = true) {
  return new Request(`http://localhost/api/bot-control/test-cases${query}`, {
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

function bodyReq(body: unknown, method = 'POST', url = 'http://localhost/api/bot-control/test-cases', withSession = true) {
  return new Request(url, {
    method,
    headers: withSession ? { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  })
}

const VALID = { name: 'Harga ATV', inputText: 'Berapa harga ATV?', expectedStatus: 'WOULD_REPLY', expectedContains: 'Rp' }

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.botTestCase.findMany.mockResolvedValue([row()] as never)
  mockPrisma.botTestCase.count.mockResolvedValue(1 as never)
  mockPrisma.botTestCase.findUnique.mockResolvedValue(row())
  mockPrisma.botTestCase.create.mockResolvedValue(row())
  mockPrisma.botTestCase.update.mockResolvedValue(row())
  mockPrisma.botTestCase.delete.mockResolvedValue(row())
  vi.mocked(runTestCases).mockResolvedValue({
    id: 'run_1',
    scope: 'MANUAL',
    status: 'PASSED',
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
  })
  mockPrisma.botTestResult.findMany.mockResolvedValue([] as never)
})

describe('GET /api/bot-control/test-cases', () => {
  it('refuses a request with no session', async () => {
    expect((await GET(req('', false))).status).toBe(401)
  })

  it('returns the suite with its categories', async () => {
    const body = await (await GET(req())).json()
    expect(body.items[0]).toMatchObject({ id: 'case_1', expectedContains: 'Rp' })
    expect(body.categories).toEqual(['Pricing'])
  })

  it('lists categories from the WHOLE suite, not the filtered page', async () => {
    // A dropdown that loses its own options once you pick one cannot be used to pick another.
    await GET(req('?category=Pricing'))
    const categoryCall = mockPrisma.botTestCase.findMany.mock.calls[1][0]
    expect(categoryCall?.distinct).toEqual(['category'])
    expect(categoryCall).not.toHaveProperty('where')
  })

  it('filters by category, enabled and free text', async () => {
    await GET(req('?category=Pricing&enabled=false&q=atv'))
    const where = mockPrisma.botTestCase.findMany.mock.calls[0][0]?.where
    expect(where).toMatchObject({ category: 'Pricing', enabled: false })
    expect(where?.OR).toHaveLength(3)
  })
})

describe('POST /api/bot-control/test-cases', () => {
  it('lets an AGENT create one', async () => {
    // The person who notices the bot answering wrongly is the agent reading the conversation;
    // making them file a ticket for someone else is how the case never gets written.
    const res = await POST(bodyReq(VALID))
    expect(res.status).toBe(200)
    expect(mockPrisma.botTestCase.create.mock.calls[0][0].data).toMatchObject({ createdBy: 'acc_1' })
  })

  it('rejects an expected status the runner could never produce', async () => {
    // A case that can never match would be permanently red for no readable reason.
    expect((await POST(bodyReq({ ...VALID, expectedStatus: 'MUNGKIN' }))).status).toBe(400)
  })

  it('requires a name and an input', async () => {
    expect((await POST(bodyReq({ ...VALID, name: '  ' }))).status).toBe(400)
    expect((await POST(bodyReq({ ...VALID, inputText: '' }))).status).toBe(400)
  })

  it('refuses a session-less request', async () => {
    expect((await POST(bodyReq(VALID, 'POST', 'http://localhost/api/bot-control/test-cases', false))).status).toBe(401)
  })
})

describe('PATCH /api/bot-control/test-cases/[id]', () => {
  it('writes only the fields that were actually sent', async () => {
    // Spreading the parsed object would write `undefined` over every column the caller omitted,
    // silently clearing expectations they never touched.
    await PATCH(bodyReq({ enabled: false }, 'PATCH'), { params })

    const data = mockPrisma.botTestCase.update.mock.calls[0][0].data
    expect(data).toEqual({ enabled: false })
  })

  it('answers 404 for a case that does not exist', async () => {
    mockPrisma.botTestCase.findUnique.mockResolvedValue(null as never)
    expect((await PATCH(bodyReq({ enabled: false }, 'PATCH'), { params })).status).toBe(404)
  })
})

describe('DELETE /api/bot-control/test-cases/[id]', () => {
  it('disables by default rather than deleting', async () => {
    // A disabled case still explains what somebody once considered important.
    const res = await DELETE(bodyReq({}, 'DELETE'), { params })
    expect(res.status).toBe(200)
    expect(mockPrisma.botTestCase.update.mock.calls[0][0].data).toEqual({ enabled: false })
    expect(mockPrisma.botTestCase.delete).not.toHaveBeenCalled()
  })

  it('refuses a hard delete from an AGENT', async () => {
    const res = await DELETE(
      bodyReq({}, 'DELETE', 'http://localhost/api/bot-control/test-cases/case_1?hard=true'),
      { params }
    )
    expect(res.status).toBe(403)
    expect(mockPrisma.botTestCase.delete).not.toHaveBeenCalled()
  })

  it('allows a hard delete from an ADMIN', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })

    const res = await DELETE(
      bodyReq({}, 'DELETE', 'http://localhost/api/bot-control/test-cases/case_1?hard=true'),
      { params }
    )
    expect(res.status).toBe(200)
    expect(mockPrisma.botTestCase.delete).toHaveBeenCalled()
  })
})

describe('POST /api/bot-control/test-cases/[id]/run', () => {
  it('runs the single case as MANUAL, never PRE_RELEASE', async () => {
    // A one-case run whose only case passes must not be able to stand in for the whole suite
    // at publish time.
    const res = await runOne(bodyReq({}, 'POST'), { params })
    expect(res.status).toBe(200)
    expect(runTestCases).toHaveBeenCalledWith(expect.objectContaining({ scope: 'MANUAL', testCaseIds: ['case_1'] }))
  })

  it('answers 404 for a case that does not exist', async () => {
    mockPrisma.botTestCase.findUnique.mockResolvedValue(null as never)
    expect((await runOne(bodyReq({}, 'POST'), { params })).status).toBe(404)
    expect(runTestCases).not.toHaveBeenCalled()
  })
})
