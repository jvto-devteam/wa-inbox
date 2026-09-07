/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { runTestCases, MAX_TEST_CASES_PER_RUN } from '@/lib/bot-control/test-runner'
import { GET, POST } from './route'
import { GET as getRun } from './[id]/route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/test-runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bot-control/test-runner')>()
  return { ...actual, runTestCases: vi.fn() }
})

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const params = Promise.resolve({ id: 'run_1' })

function req(query = '', withSession = true) {
  return new Request(`http://localhost/api/bot-control/test-runs${query}`, {
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

function postReq(body: unknown, withSession = true) {
  return new Request('http://localhost/api/bot-control/test-runs', {
    method: 'POST',
    headers: withSession ? { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
  vi.mocked(runTestCases).mockResolvedValue({
    id: 'run_1',
    scope: 'PRE_RELEASE',
    status: 'PASSED',
    total: 2,
    passed: 2,
    failed: 0,
    skipped: 0,
  })
  mockPrisma.botTestRun.findMany.mockResolvedValue([
    {
      id: 'run_1',
      name: null,
      scope: 'PRE_RELEASE',
      status: 'PASSED',
      total: 2,
      passed: 2,
      failed: 0,
      skipped: 0,
      releaseId: null,
      startedAt: new Date(),
      finishedAt: new Date(),
    },
  ] as never)
  mockPrisma.botTestRun.count.mockResolvedValue(1 as never)
  mockPrisma.botTestRun.findUnique.mockResolvedValue({
    id: 'run_1',
    name: null,
    scope: 'PRE_RELEASE',
    status: 'PASSED',
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    releaseId: null,
    startedAt: new Date(),
    finishedAt: new Date(),
    summary: null,
    results: [
      {
        id: 'res_1',
        testCaseId: 'case_1',
        status: 'PASSED',
        inputText: 'Berapa harga ATV?',
        actualStatus: 'WOULD_REPLY',
        actualFlowKey: 'faq',
        actualReply: 'Rp350.000',
        failureReason: null,
        latencyMs: 120,
      },
    ],
  } as never)
  mockPrisma.botTestCase.findMany.mockResolvedValue([{ id: 'case_1', name: 'Harga ATV' }] as never)
})

describe('POST /api/bot-control/test-runs', () => {
  it('lets an AGENT run the suite', async () => {
    // An agent can prove the bot is wrong, and still cannot ship a change on the strength of it.
    const res = await POST(postReq({ scope: 'PRE_RELEASE', testCaseIds: ['case_1', 'case_2'] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ testRunId: 'run_1', status: 'PASSED' })
  })

  it('defaults an unknown scope to MANUAL rather than PRE_RELEASE', async () => {
    // Guessing PRE_RELEASE would let a casual run stand in for the publish gate.
    await POST(postReq({ testCaseIds: ['case_1'] }))
    expect(runTestCases).toHaveBeenCalledWith(expect.objectContaining({ scope: 'MANUAL' }))
  })

  it('rejects an over-large batch outright', async () => {
    // Clearer than silently running the first fifty and reporting a total nobody asked for.
    const ids = Array.from({ length: MAX_TEST_CASES_PER_RUN + 1 }, (_, i) => `case_${i}`)
    expect((await POST(postReq({ testCaseIds: ids }))).status).toBe(400)
    expect(runTestCases).not.toHaveBeenCalled()
  })

  it('rejects an empty batch', async () => {
    expect((await POST(postReq({ testCaseIds: [] }))).status).toBe(400)
  })

  it('accepts the candidate block without acting on it yet', async () => {
    // Taking it now means the client contract does not change when the integration pass lands.
    const res = await POST(
      postReq({ testCaseIds: ['case_1'], candidate: { ruleDraftKeys: ['channel.unofficial_outbound_default'] } })
    )
    expect(res.status).toBe(200)
  })

  it('refuses a session-less request', async () => {
    expect((await POST(postReq({ testCaseIds: ['case_1'] }, false))).status).toBe(401)
  })
})

describe('GET /api/bot-control/test-runs', () => {
  it('lists runs newest first', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(mockPrisma.botTestRun.findMany.mock.calls[0][0]?.orderBy).toEqual({ startedAt: 'desc' })
  })

  it('ignores a scope outside the known set', async () => {
    await GET(req('?scope=ENTAH'))
    expect(mockPrisma.botTestRun.findMany.mock.calls[0][0]?.where).not.toHaveProperty('scope')
  })
})

describe('GET /api/bot-control/test-runs/[id]', () => {
  it('returns every result with the case name resolved', async () => {
    const body = await (await getRun(req(), { params })).json()
    expect(body.results[0]).toMatchObject({ testCaseName: 'Harga ATV', status: 'PASSED' })
  })

  it('keeps a result whose case has since been deleted', async () => {
    // The result outlives the case on purpose: its own inputText was copied at run time.
    mockPrisma.botTestCase.findMany.mockResolvedValue([] as never)

    const body = await (await getRun(req(), { params })).json()
    expect(body.results[0].testCaseName).toBeNull()
    expect(body.results[0].inputText).toBe('Berapa harga ATV?')
  })

  it('answers 404 for a run that does not exist', async () => {
    mockPrisma.botTestRun.findUnique.mockResolvedValue(null as never)
    expect((await getRun(req(), { params })).status).toBe(404)
  })
})
