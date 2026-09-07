/**
 * @vitest-environment node
 *
 * Regression cover for the audit finding "Test run tidak bisa menguji versi draft".
 *
 * `POST /api/bot-control/test-runs` accepted a `candidate` body and threw it away, with a
 * comment admitting it: "Accepted and ignored for now". Every suite therefore ran against
 * configuration that was ALREADY PUBLISHED, so the gate in front of a publish proved something
 * about the version being replaced rather than the one being shipped.
 *
 * The proof this file exists to give is the one the audit asked for: the SAME test case, run
 * against a deliberately wrong DRAFT, must FAIL — and run against the published version, must
 * PASS.
 *
 * `runSimulation` is stubbed with the exact call the real orchestrator makes for this wording
 * (`fallbackReplyText` -> `getFlowText`), because running the whole 1,700-line decision path
 * would drag in LLM calls without testing anything more about the wiring under test. Everything
 * between the runner and the loader is real: the candidate scope, the cache bypass, the query,
 * the version pick, and the pass/fail evaluation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { runSimulation } from '@/lib/bot-control/simulator'
import { fallbackReplyText } from '@/lib/bot/runtime-integration'
import { invalidateRuntimeFlowCache } from '@/lib/bot-control/runtime-flows'
import { EXISTING_BOT_FLOW_KEY } from '@/lib/bot-control/existing-flow-registry'
import { runTestCases } from './test-runner'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/bot-control/simulator', () => ({ runSimulation: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const CODE_DEFAULT = 'Maaf, ada kendala teknis sebentar.'
const PUBLISHED_WORDING = 'Mohon tunggu sebentar ya, saya cek dulu.'
const BROKEN_DRAFT_WORDING = 'ERROR TEMPLATE {{unresolved}}'

const PUBLISHED_VERSION_ID = 'ver_published'
const DRAFT_VERSION_ID = 'ver_draft'

/** The flow rows both versions live on. The loader picks between them. */
function flowRows() {
  return [
    {
      key: EXISTING_BOT_FLOW_KEY,
      name: 'WhatsApp Existing Bot',
      editableLevel: 'SAFE_CONFIG',
      activeVersionId: PUBLISHED_VERSION_ID,
      versions: [
        { id: DRAFT_VERSION_ID, version: 8, status: 'APPROVED', nodeConfig: { fallbackReply: BROKEN_DRAFT_WORDING } },
        { id: PUBLISHED_VERSION_ID, version: 7, status: 'PUBLISHED', nodeConfig: { fallbackReply: PUBLISHED_WORDING } },
      ],
    },
  ]
}

const TEST_CASE = {
  id: 'case_fallback',
  name: 'Balasan cadangan menyebut permintaan menunggu',
  inputText: 'halo',
  conversationSeed: null,
  expectedStatus: null,
  expectedFlowKey: null,
  expectedContains: 'Mohon tunggu',
  expectedNotContains: null,
  expectedHandoff: null,
  requiredKnowledgeKeys: [],
  enabled: true,
}

const results: Array<{ status: string; failureReason: string | null; actualReply: string | null }> = []

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  results.length = 0
  invalidateRuntimeFlowCache()

  mockPrisma.botTestCase.findMany.mockResolvedValue([TEST_CASE] as never)
  mockPrisma.botFlowDefinition.findMany.mockImplementation((async (args: unknown) => {
    // Honour the loader's own `where`, so the test proves the query it builds is the reason a
    // candidate is or is not visible -- not this stub's generosity.
    const where = (args as { select?: { versions?: { where?: unknown } } })?.select?.versions?.where
    const asJson = JSON.stringify(where ?? {})
    return flowRows().map((row) => ({
      ...row,
      versions: asJson.includes(DRAFT_VERSION_ID)
        ? row.versions
        : row.versions.filter((v) => v.status === 'PUBLISHED'),
    })) as never
  }) as never)
  mockPrisma.botTestRun.create.mockResolvedValue({ id: 'run_1' } as never)
  mockPrisma.botTestRun.update.mockImplementation((async (args: { data: Record<string, unknown> }) => ({
    id: 'run_1',
    scope: 'PRE_RELEASE',
    status: args.data.status,
    total: args.data.passed as number,
    passed: args.data.passed,
    failed: args.data.failed,
    skipped: args.data.skipped,
  })) as never)
  mockPrisma.botTestResult.create.mockImplementation((async (args: { data: Record<string, unknown> }) => {
    results.push({
      status: String(args.data.status),
      failureReason: (args.data.failureReason as string) ?? null,
      actualReply: (args.data.actualReply as string) ?? null,
    })
    return { id: 'res_1' } as never
  }) as never)

  // The one line the real orchestrator runs for this wording. Everything below the call is real.
  vi.mocked(runSimulation).mockImplementation(async () => ({
    mode: 'clarify',
    reply: await fallbackReplyText(CODE_DEFAULT),
    status: 'WOULD_REPLY',
    flowSteps: [],
    knowledgeRefs: null,
    verification: null,
    warnings: [],
    wouldSendViaChannel: 'UNOFFICIAL',
    decisionRunId: null,
    latencyMs: 1,
  }))
})

describe('runTestCases dengan candidate (regresi Temuan 4)', () => {
  it('GAGAL saat diuji terhadap draft yang sengaja salah', async () => {
    const run = await runTestCases({
      scope: 'PRE_RELEASE',
      testCaseIds: [TEST_CASE.id],
      candidate: { flowVersionIds: [DRAFT_VERSION_ID] },
    })

    expect(run.status).toBe('FAILED')
    expect(run.failed).toBe(1)
    expect(results[0].actualReply).toBe(BROKEN_DRAFT_WORDING)
    expect(results[0].failureReason).toContain('Mohon tunggu')
  })

  it('LULUS saat kasus uji yang sama dijalankan terhadap versi published', async () => {
    const run = await runTestCases({ scope: 'PRE_RELEASE', testCaseIds: [TEST_CASE.id] })

    expect(run.status).toBe('PASSED')
    expect(run.failed).toBe(0)
    expect(results[0].actualReply).toBe(PUBLISHED_WORDING)
  })

  it('mencatat candidate pada run, supaya bisa dibedakan dari run biasa', async () => {
    await runTestCases({
      scope: 'PRE_RELEASE',
      testCaseIds: [TEST_CASE.id],
      candidate: { flowVersionIds: [DRAFT_VERSION_ID] },
    })

    const summary = mockPrisma.botTestRun.update.mock.calls[0][0].data.summary as { candidate: unknown }
    expect(summary.candidate).toEqual({ flowVersionIds: [DRAFT_VERSION_ID] })
  })

  it('mengembalikan konfigurasi published begitu scope kandidat selesai', async () => {
    // The safety-critical half: a candidate must not survive its own run. If the loader had
    // cached what it computed under the candidate, this second call would still see the draft
    // -- and so would every customer message in the same process for the next 30 seconds.
    await runTestCases({
      scope: 'PRE_RELEASE',
      testCaseIds: [TEST_CASE.id],
      candidate: { flowVersionIds: [DRAFT_VERSION_ID] },
    })

    expect(await fallbackReplyText(CODE_DEFAULT)).toBe(PUBLISHED_WORDING)
  })
})
