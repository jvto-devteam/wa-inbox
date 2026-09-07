/**
 * Runs saved test cases against the real decision engine, and decides whether they passed.
 *
 * --- Why the expectations are several narrow checks rather than one ---
 *
 * A test is only useful if it fails for a reason somebody can read. "Balasan tidak sesuai"
 * tells nobody what to fix; "status WOULD_HANDOFF, diharapkan WOULD_REPLY" does. So each
 * expectation is evaluated separately and every failure is named, and ALL of them are collected
 * rather than stopping at the first — a case that is wrong in two ways should say so once, not
 * across two runs.
 *
 * --- Why this reuses the simulator instead of calling the orchestrator ---
 *
 * `decideAndRespond` writes: trip briefs, booking data, pipeline stage, knowledge-gap rows.
 * `simulator.ts` exists precisely to absorb those writes into the sandbox conversation and undo
 * them afterwards (see its own header). A test suite that corrupted production conversations
 * every time it ran would be worse than no test suite, and CLAUDE.md's zero-tolerance rule says
 * the simulator is the only sanctioned dry-run path.
 *
 * --- Batching ---
 *
 * Cases run in sequence, capped. Each one is a full decision turn including LLM calls, so a
 * fifty-case suite is already minutes of wall clock; letting an operator queue five hundred
 * would produce a request that times out and a run stuck at RUNNING forever (SDD §18.5).
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { runSimulation, type SimulationResult, type SimulationStatus } from '@/lib/bot-control/simulator'
import { loadPublishedManagedKnowledge } from '@/lib/bot/managed-knowledge'

export const TEST_RUN_SCOPES = ['PRE_RELEASE', 'MANUAL'] as const
export type TestRunScope = (typeof TEST_RUN_SCOPES)[number]

export const TEST_RUN_STATUSES = ['RUNNING', 'PASSED', 'FAILED'] as const
export type TestRunStatus = (typeof TEST_RUN_STATUSES)[number]

export const TEST_RESULT_STATUSES = ['PASSED', 'FAILED', 'SKIPPED'] as const
export type TestResultStatus = (typeof TEST_RESULT_STATUSES)[number]

export const SIMULATION_STATUSES: readonly SimulationStatus[] = [
  'WOULD_REPLY',
  'WOULD_CLARIFY',
  'WOULD_HANDOFF',
  'FAILED',
]

/** SDD Manage Second §18.5. See the batching note above. */
export const MAX_TEST_CASES_PER_RUN = 50

/** The subset of a test case this module needs. Kept structural so tests need no Prisma rows. */
export type TestCaseInput = {
  id: string
  name: string
  inputText: string
  conversationSeed: unknown
  expectedStatus: string | null
  expectedFlowKey: string | null
  expectedContains: string | null
  expectedNotContains: string | null
  expectedHandoff: boolean | null
  requiredKnowledgeKeys: unknown
  enabled: boolean
}

export type EvaluatedCase = {
  status: TestResultStatus
  failureReason: string | null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function seedContact(value: unknown): { contactName?: string; contactPhone?: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  return {
    contactName: typeof record.contactName === 'string' ? record.contactName : undefined,
    contactPhone: typeof record.contactPhone === 'string' ? record.contactPhone : undefined,
  }
}

/**
 * Compares one simulation against one case's expectations.
 *
 * Text checks are case-insensitive. An operator writing `expectedContains: "Rp"` means "the
 * reply quotes a price", not "the reply contains those exact two bytes" — and a test that fails
 * on capitalisation is a test people learn to ignore.
 */
export function evaluateCase(testCase: TestCaseInput, result: SimulationResult): EvaluatedCase {
  const failures: string[] = []
  const reply = result.reply ?? ''
  const haystack = reply.toLowerCase()

  if (testCase.expectedStatus && testCase.expectedStatus !== result.status) {
    failures.push(`status ${result.status}, diharapkan ${testCase.expectedStatus}`)
  }

  if (testCase.expectedHandoff !== null) {
    const handedOff = result.status === 'WOULD_HANDOFF'
    if (handedOff !== testCase.expectedHandoff) {
      failures.push(
        testCase.expectedHandoff ? 'tidak dialihkan ke agent, diharapkan dialihkan' : 'dialihkan ke agent, diharapkan tidak'
      )
    }
  }

  if (testCase.expectedContains) {
    if (!haystack.includes(testCase.expectedContains.toLowerCase())) {
      failures.push(`balasan tidak memuat "${testCase.expectedContains}"`)
    }
  }

  if (testCase.expectedNotContains) {
    if (haystack.includes(testCase.expectedNotContains.toLowerCase())) {
      failures.push(`balasan memuat "${testCase.expectedNotContains}" yang seharusnya tidak ada`)
    }
  }

  if (testCase.expectedFlowKey && testCase.expectedFlowKey !== result.mode) {
    failures.push(`mode ${result.mode}, diharapkan ${testCase.expectedFlowKey}`)
  }

  // Every failure, not just the first: a case wrong in two ways should say so once.
  return failures.length === 0
    ? { status: 'PASSED', failureReason: null }
    : { status: 'FAILED', failureReason: failures.join('; ') }
}

/**
 * Which required knowledge keys are missing, if any.
 *
 * A case that needs knowledge the account does not have is SKIPPED, not failed. Failing it
 * would make the publish gate red for a reason that has nothing to do with the change being
 * published — and a suite that is red for unrelated reasons is a suite people start overriding.
 */
export async function missingKnowledgeKeys(required: unknown): Promise<string[]> {
  const keys = asStringArray(required)
  if (keys.length === 0) return []

  try {
    const managed = await loadPublishedManagedKnowledge()
    const available = new Set<string>(managed.entries.map((entry) => entry.sourceKey))

    const catalog = await prisma.knowledgeSource.findMany({
      where: { key: { in: keys }, status: { not: 'ARCHIVED' } },
      select: { key: true },
    })
    for (const row of catalog) available.add(row.key)

    return keys.filter((key) => !available.has(key))
  } catch (error) {
    // A lookup failure must not turn into a false failure on every case that names a key.
    // Treating them as present keeps the run honest about what it could actually check.
    console.error('missingKnowledgeKeys: gagal memeriksa knowledge, dianggap tersedia', { error })
    return []
  }
}

export type RunTestCasesParams = {
  scope: TestRunScope
  testCaseIds: string[]
  name?: string | null
  actorId?: string | null
}

export type TestRunSummary = {
  id: string
  scope: string
  status: TestRunStatus
  total: number
  passed: number
  failed: number
  skipped: number
}

/**
 * Runs a set of cases and records the outcome.
 *
 * The run row is created FIRST, as RUNNING, and finished at the end. A process that dies
 * mid-suite therefore leaves a visible RUNNING row rather than nothing at all — and a RUNNING
 * run is not PASSED, so it cannot gate a publish.
 */
export async function runTestCases(params: RunTestCasesParams): Promise<TestRunSummary> {
  const ids = [...new Set(params.testCaseIds)].slice(0, MAX_TEST_CASES_PER_RUN)

  const cases = await prisma.botTestCase.findMany({ where: { id: { in: ids } } })

  const run = await prisma.botTestRun.create({
    data: {
      name: params.name ?? null,
      scope: params.scope,
      status: 'RUNNING',
      total: cases.length,
      startedBy: params.actorId ?? null,
    },
    select: { id: true },
  })

  let passed = 0
  let failed = 0
  let skipped = 0

  for (const testCase of cases) {
    const input: TestCaseInput = {
      id: testCase.id,
      name: testCase.name,
      inputText: testCase.inputText,
      conversationSeed: testCase.conversationSeed,
      expectedStatus: testCase.expectedStatus,
      expectedFlowKey: testCase.expectedFlowKey,
      expectedContains: testCase.expectedContains,
      expectedNotContains: testCase.expectedNotContains,
      expectedHandoff: testCase.expectedHandoff,
      requiredKnowledgeKeys: testCase.requiredKnowledgeKeys,
      enabled: testCase.enabled,
    }

    const outcome = await runOneCase(run.id, input)
    if (outcome === 'PASSED') passed += 1
    else if (outcome === 'FAILED') failed += 1
    else skipped += 1
  }

  // A run with nothing to check is PASSED, and says so in the summary. Blocking publish because
  // an account has not written tests yet would make the gate impossible to adopt.
  const status: TestRunStatus = failed > 0 ? 'FAILED' : 'PASSED'

  const finished = await prisma.botTestRun.update({
    where: { id: run.id },
    data: {
      status,
      passed,
      failed,
      skipped,
      finishedAt: new Date(),
      summary: {
        requestedCaseIds: ids.length,
        // Names the gap when the caller asked for cases that do not exist, rather than
        // silently reporting a smaller total than was requested.
        missingCaseIds: ids.filter((id) => !cases.some((row) => row.id === id)),
        emptySuite: cases.length === 0,
      } as Prisma.InputJsonValue,
    },
    select: { id: true, scope: true, status: true, total: true, passed: true, failed: true, skipped: true },
  })

  return { ...finished, status: finished.status as TestRunStatus }
}

/** Runs one case and writes its result row. Never throws — a crash is a FAILED result. */
async function runOneCase(testRunId: string, testCase: TestCaseInput): Promise<TestResultStatus> {
  const base = { testRunId, testCaseId: testCase.id, inputText: testCase.inputText }

  // Disabled means skipped, not omitted: a run's totals should still show it existed.
  if (!testCase.enabled) {
    await prisma.botTestResult.create({
      data: { ...base, status: 'SKIPPED', failureReason: 'Kasus uji dinonaktifkan.' },
    })
    return 'SKIPPED'
  }

  const missing = await missingKnowledgeKeys(testCase.requiredKnowledgeKeys)
  if (missing.length > 0) {
    await prisma.botTestResult.create({
      data: { ...base, status: 'SKIPPED', failureReason: `Knowledge belum tersedia: ${missing.join(', ')}.` },
    })
    return 'SKIPPED'
  }

  const startedAt = Date.now()
  let result: SimulationResult
  try {
    result = await runSimulation({ message: testCase.inputText, ...seedContact(testCase.conversationSeed) })
  } catch (error) {
    // A thrown simulation is a genuine failure of the thing under test, not an infrastructure
    // problem to hide — so it is recorded as FAILED and the run continues to the next case.
    const message = error instanceof Error ? error.message : String(error)
    await prisma.botTestResult.create({
      data: { ...base, status: 'FAILED', failureReason: `Simulasi gagal: ${message}`, latencyMs: Date.now() - startedAt },
    })
    return 'FAILED'
  }

  const evaluated = evaluateCase(testCase, result)

  await prisma.botTestResult.create({
    data: {
      ...base,
      status: evaluated.status,
      actualStatus: result.status,
      actualFlowKey: result.mode,
      actualReply: result.reply,
      // The trace was already sanitised when the decision was recorded; this is the same
      // shape, stored so a failing case can be read without re-running it.
      actualTrace: result.flowSteps as unknown as Prisma.InputJsonValue,
      failureReason: evaluated.failureReason,
      latencyMs: result.latencyMs,
    },
  })

  return evaluated.status
}
