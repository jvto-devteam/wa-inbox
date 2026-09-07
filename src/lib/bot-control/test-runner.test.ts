/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { runSimulation, type SimulationResult } from '@/lib/bot-control/simulator'
import { loadPublishedManagedKnowledge } from '@/lib/bot/managed-knowledge'
import {
  evaluateCase,
  missingKnowledgeKeys,
  runTestCases,
  MAX_TEST_CASES_PER_RUN,
  type TestCaseInput,
} from './test-runner'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/bot-control/simulator', () => ({ runSimulation: vi.fn() }))
vi.mock('@/lib/bot/managed-knowledge', () => ({ loadPublishedManagedKnowledge: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function testCase(overrides: Partial<TestCaseInput> = {}): TestCaseInput {
  return {
    id: 'case_1',
    name: 'Harga ATV',
    inputText: 'Berapa harga ATV?',
    conversationSeed: null,
    expectedStatus: null,
    expectedFlowKey: null,
    expectedContains: null,
    expectedNotContains: null,
    expectedHandoff: null,
    requiredKnowledgeKeys: null,
    enabled: true,
    ...overrides,
  }
}

function simulation(overrides: Partial<SimulationResult> = {}): SimulationResult {
  return {
    mode: 'faq',
    reply: 'Harga ATV mulai Rp350.000 per orang.',
    status: 'WOULD_REPLY',
    flowSteps: [],
    knowledgeRefs: null,
    verification: null,
    warnings: [],
    wouldSendViaChannel: 'UNOFFICIAL',
    decisionRunId: 'run_1',
    latencyMs: 120,
    ...overrides,
  }
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(runSimulation).mockResolvedValue(simulation())
  vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({ entries: [], available: true, loadedAt: 0 })
  mockPrisma.knowledgeSource.findMany.mockResolvedValue([] as never)
  mockPrisma.botTestCase.findMany.mockResolvedValue([] as never)
  mockPrisma.botTestRun.create.mockResolvedValue({ id: 'run_1' } as never)
  mockPrisma.botTestResult.create.mockResolvedValue({ id: 'res_1' } as never)
  mockPrisma.botTestRun.update.mockResolvedValue({
    id: 'run_1',
    scope: 'MANUAL',
    status: 'PASSED',
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
  } as never)
})

describe('evaluateCase', () => {
  it('passes a case with no expectations at all', () => {
    expect(evaluateCase(testCase(), simulation())).toEqual({ status: 'PASSED', failureReason: null })
  })

  it('names the status mismatch, not just "tidak sesuai"', () => {
    // A test is only useful if it fails for a reason somebody can read.
    const result = evaluateCase(testCase({ expectedStatus: 'WOULD_REPLY' }), simulation({ status: 'WOULD_HANDOFF' }))
    expect(result.status).toBe('FAILED')
    expect(result.failureReason).toContain('WOULD_HANDOFF')
    expect(result.failureReason).toContain('WOULD_REPLY')
  })

  it('collects EVERY failure, not just the first', () => {
    // A case wrong in two ways should say so once, not across two runs.
    const result = evaluateCase(
      testCase({ expectedStatus: 'WOULD_REPLY', expectedContains: 'Rp' }),
      simulation({ status: 'WOULD_HANDOFF', reply: 'Saya sambungkan ke agent.' })
    )
    expect(result.failureReason?.split(';')).toHaveLength(2)
  })

  it('matches contains case-insensitively', () => {
    // "expectedContains: Rp" means "the reply quotes a price", not "these exact two bytes" —
    // a test that fails on capitalisation is one people learn to ignore.
    expect(evaluateCase(testCase({ expectedContains: 'HARGA' }), simulation()).status).toBe('PASSED')
  })

  it('fails when a forbidden phrase appears', () => {
    const result = evaluateCase(
      testCase({ expectedNotContains: 'tidak tahu' }),
      simulation({ reply: 'Maaf, saya tidak tahu.' })
    )
    expect(result.status).toBe('FAILED')
    expect(result.failureReason).toContain('tidak tahu')
  })

  it('checks handoff in both directions', () => {
    expect(evaluateCase(testCase({ expectedHandoff: false }), simulation()).status).toBe('PASSED')
    expect(
      evaluateCase(testCase({ expectedHandoff: true }), simulation({ status: 'WOULD_REPLY' })).status
    ).toBe('FAILED')
    expect(
      evaluateCase(testCase({ expectedHandoff: false }), simulation({ status: 'WOULD_HANDOFF' })).status
    ).toBe('FAILED')
  })

  it('ignores handoff entirely when the case does not state an expectation', () => {
    // Null is "do not care", which is different from false.
    expect(evaluateCase(testCase(), simulation({ status: 'WOULD_HANDOFF' })).status).toBe('PASSED')
  })

  it('treats a null reply as an empty string rather than crashing', () => {
    const result = evaluateCase(testCase({ expectedContains: 'Rp' }), simulation({ reply: null }))
    expect(result.status).toBe('FAILED')
  })

  it('compares the flow key against the simulation mode', () => {
    expect(evaluateCase(testCase({ expectedFlowKey: 'faq' }), simulation()).status).toBe('PASSED')
    expect(evaluateCase(testCase({ expectedFlowKey: 'clarify' }), simulation()).status).toBe('FAILED')
  })
})

describe('missingKnowledgeKeys', () => {
  it('returns nothing when the case names no keys', async () => {
    expect(await missingKnowledgeKeys(null)).toEqual([])
    expect(await missingKnowledgeKeys([])).toEqual([])
  })

  it('finds a key in managed knowledge', async () => {
    vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({
      entries: [{ sourceId: 'ks_1', sourceKey: 'managed/atv', sourceTitle: 'FAQ ATV', revisionId: 'r', version: 1, items: [] }],
      available: true,
      loadedAt: 0,
    })
    expect(await missingKnowledgeKeys(['managed/atv'])).toEqual([])
  })

  it('finds a key in the catalog index too', async () => {
    mockPrisma.knowledgeSource.findMany.mockResolvedValue([{ key: 'catalog/policy-cards.json' }] as never)
    expect(await missingKnowledgeKeys(['catalog/policy-cards.json'])).toEqual([])
  })

  it('reports what is genuinely missing', async () => {
    expect(await missingKnowledgeKeys(['managed/tidak-ada'])).toEqual(['managed/tidak-ada'])
  })

  it('treats keys as present when the lookup itself fails', async () => {
    // A lookup failure must not turn into a false failure on every case that names a key.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(loadPublishedManagedKnowledge).mockRejectedValue(new Error('db down'))
    expect(await missingKnowledgeKeys(['managed/atv'])).toEqual([])
  })
})

describe('runTestCases', () => {
  it('creates the run as RUNNING before executing anything', async () => {
    // A process that dies mid-suite leaves a visible RUNNING row rather than nothing — and a
    // RUNNING run is not PASSED, so it cannot gate a publish.
    await runTestCases({ scope: 'MANUAL', testCaseIds: [] })
    expect(mockPrisma.botTestRun.create.mock.calls[0][0].data).toMatchObject({ status: 'RUNNING' })
  })

  it('caps the batch, so one request cannot become a timeout', async () => {
    const ids = Array.from({ length: MAX_TEST_CASES_PER_RUN + 20 }, (_, i) => `case_${i}`)
    await runTestCases({ scope: 'MANUAL', testCaseIds: ids })

    const where = mockPrisma.botTestCase.findMany.mock.calls[0][0]?.where
    expect((where?.id as { in: string[] }).in).toHaveLength(MAX_TEST_CASES_PER_RUN)
  })

  it('runs each enabled case through the simulator and tallies the result', async () => {
    mockPrisma.botTestCase.findMany.mockResolvedValue([
      { ...testCase({ id: 'case_1' }), description: null, category: null, createdBy: null },
      { ...testCase({ id: 'case_2', expectedStatus: 'WOULD_HANDOFF' }), description: null, category: null, createdBy: null },
    ] as never)

    await runTestCases({ scope: 'MANUAL', testCaseIds: ['case_1', 'case_2'] })

    expect(runSimulation).toHaveBeenCalledTimes(2)
    expect(mockPrisma.botTestRun.update.mock.calls[0][0].data).toMatchObject({ status: 'FAILED', passed: 1, failed: 1 })
  })

  it('runs through the simulator, never the orchestrator directly', async () => {
    // The simulator is the only sanctioned dry-run path (CLAUDE.md): it absorbs the
    // orchestrator's writes into the sandbox and undoes them afterwards.
    mockPrisma.botTestCase.findMany.mockResolvedValue([
      { ...testCase(), description: null, category: null, createdBy: null },
    ] as never)

    await runTestCases({ scope: 'MANUAL', testCaseIds: ['case_1'] })
    expect(runSimulation).toHaveBeenCalledWith(expect.objectContaining({ message: 'Berapa harga ATV?' }))
  })

  it('SKIPS a disabled case rather than omitting it from the totals', async () => {
    mockPrisma.botTestCase.findMany.mockResolvedValue([
      { ...testCase({ enabled: false }), description: null, category: null, createdBy: null },
    ] as never)

    await runTestCases({ scope: 'MANUAL', testCaseIds: ['case_1'] })
    expect(runSimulation).not.toHaveBeenCalled()
    expect(mockPrisma.botTestRun.update.mock.calls[0][0].data).toMatchObject({ skipped: 1, status: 'PASSED' })
  })

  it('SKIPS a case whose required knowledge is missing, rather than failing it', async () => {
    // A suite that is red for reasons unrelated to the change being published is a suite people
    // start overriding.
    mockPrisma.botTestCase.findMany.mockResolvedValue([
      { ...testCase({ requiredKnowledgeKeys: ['managed/tidak-ada'] }), description: null, category: null, createdBy: null },
    ] as never)

    await runTestCases({ scope: 'MANUAL', testCaseIds: ['case_1'] })
    expect(mockPrisma.botTestRun.update.mock.calls[0][0].data).toMatchObject({ skipped: 1, failed: 0 })
  })

  it('records a thrown simulation as FAILED and keeps going', async () => {
    // A thrown simulation is a genuine failure of the thing under test, not infrastructure
    // noise to hide.
    mockPrisma.botTestCase.findMany.mockResolvedValue([
      { ...testCase({ id: 'case_1' }), description: null, category: null, createdBy: null },
      { ...testCase({ id: 'case_2' }), description: null, category: null, createdBy: null },
    ] as never)
    vi.mocked(runSimulation).mockRejectedValueOnce(new Error('ollama mati')).mockResolvedValueOnce(simulation())

    await runTestCases({ scope: 'MANUAL', testCaseIds: ['case_1', 'case_2'] })
    expect(mockPrisma.botTestRun.update.mock.calls[0][0].data).toMatchObject({ failed: 1, passed: 1 })
  })

  it('passes an empty suite, and says so in the summary', async () => {
    // Blocking publish because an account has not written tests yet would make the gate
    // impossible to adopt.
    const run = await runTestCases({ scope: 'PRE_RELEASE', testCaseIds: ['case_hilang'] })

    // `total` is written at create time, with the run row; the finish only carries the tallies.
    expect(mockPrisma.botTestRun.create.mock.calls[0][0].data).toMatchObject({ total: 0 })

    const data = mockPrisma.botTestRun.update.mock.calls[0][0].data
    expect(data).toMatchObject({ status: 'PASSED' })
    expect(data.summary).toMatchObject({ emptySuite: true, missingCaseIds: ['case_hilang'] })
    expect(run.status).toBe('PASSED')
  })

  it('de-duplicates the requested ids', async () => {
    await runTestCases({ scope: 'MANUAL', testCaseIds: ['case_1', 'case_1'] })
    const where = mockPrisma.botTestCase.findMany.mock.calls[0][0]?.where
    expect((where?.id as { in: string[] }).in).toEqual(['case_1'])
  })
})
