/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { writeBotAuditLog } from '@/lib/bot-control/audit'
import {
  createReleaseSnapshot,
  previewRelease,
  publishRelease,
  readReleaseSnapshot,
  rollbackToRelease,
  ReleaseAlreadyActiveError,
  ReleaseNotFoundError,
  ReleaseBlockedError,
  ReleaseNotRestorableError,
  ReleaseTestGateError,
  ReleaseVersionConflictError,
  RELEASE_SNAPSHOT_SCHEMA_VERSION,
} from './release'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/bot-control/audit', () => ({ writeBotAuditLog: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
/** Publish is gated on a passing run now, so every publish test supplies one. */
const TEST_RUN_ID = 'run_1'

/** Stands in for what `$transaction` really hands the callback: a DIFFERENT client object. */
const mockTx = mockDeep<Prisma.TransactionClient>()

type TransactionCallback<T> = (tx: Prisma.TransactionClient) => Promise<T>

/**
 * Runs the transaction callback inline against `mockTx`.
 *
 * Handing it a distinct object rather than `mockPrisma` is the point: it is what lets the
 * tests below prove the writes went through the transaction client, which is the only thing
 * that makes them atomic in production.
 */
function runTransactionsInline() {
  mockPrisma.$transaction.mockImplementation((arg: unknown) => (arg as TransactionCallback<unknown>)(mockTx))
}

function release(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rel_1',
    version: 3,
    title: 'Release lama',
    description: null,
    status: 'SUPERSEDED',
    publishedBy: 'acc_1',
    publishedAt: new Date('2026-09-01T00:00:00.000Z'),
    rollbackOfId: null,
    testRunId: null,
    snapshot: { schemaVersion: 1, capturedAt: '2026-09-01T00:00:00.000Z', rules: [], knowledge: [], flows: [], channelPolicy: null, testSummary: null },
    notes: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  mockReset(mockTx)
  vi.clearAllMocks()
  runTransactionsInline()
  vi.mocked(writeBotAuditLog).mockResolvedValue('audit_1')
  mockTx.botRelease.findFirst.mockResolvedValue(null as never)
  mockTx.botRelease.updateMany.mockResolvedValue({ count: 0 } as never)
  mockTx.botRelease.update.mockResolvedValue({ id: 'rel_new' } as never)
  // No approved rules by default; the rule-publishing tests below opt in.
  mockTx.botRuleSetting.findMany.mockResolvedValue([] as never)
  mockTx.botRuleSetting.update.mockResolvedValue({ enabled: true, config: null, status: 'PUBLISHED' } as never)
  mockPrisma.botRuleSetting.findMany.mockResolvedValue([] as never)
  // No approved knowledge or flows by default either; those tests opt in.
  mockTx.botFlowVersion.findMany.mockResolvedValue([] as never)
  mockTx.botFlowVersion.findUnique.mockResolvedValue(null as never)
  mockTx.botFlowVersion.updateMany.mockResolvedValue({ count: 0 } as never)
  mockTx.botFlowVersion.update.mockResolvedValue({ version: 1, status: 'PUBLISHED' } as never)
  mockTx.botFlowDefinition.update.mockResolvedValue({ id: 'flow_1' } as never)
  mockPrisma.botFlowVersion.findMany.mockResolvedValue([] as never)
  mockTx.knowledgeRevision.findMany.mockResolvedValue([] as never)
  mockPrisma.botTestCase.count.mockResolvedValue(3 as never)
  // A passing run by default; the gate tests below opt into the failures.
  mockPrisma.botTestRun.findUnique.mockResolvedValue({
    id: 'run_1',
    status: 'PASSED',
    total: 3,
    passed: 3,
    failed: 0,
  } as never)
  mockTx.knowledgeRevision.findUnique.mockResolvedValue(null as never)
  mockTx.knowledgeRevision.updateMany.mockResolvedValue({ count: 0 } as never)
  mockTx.knowledgeRevision.update.mockResolvedValue({ version: 1, status: 'PUBLISHED' } as never)
  mockTx.knowledgeSource.update.mockResolvedValue({ id: 'ks_1' } as never)
  mockPrisma.knowledgeRevision.findMany.mockResolvedValue([] as never)
  mockTx.botRelease.create.mockResolvedValue({
    id: 'rel_new',
    version: 1,
    title: 'Release baru',
    status: 'PUBLISHED',
    publishedAt: new Date('2026-09-07T00:00:00.000Z'),
  } as never)
})

describe('createReleaseSnapshot', () => {
  it('produces the full shape, stamped with a schema version', async () => {
    // The shape is fixed NOW so Phases C-H only add a reader, rather than inventing a second
    // snapshot format that every rollback afterwards has to support forever.
    const snapshot = await createReleaseSnapshot()

    expect(snapshot.schemaVersion).toBe(RELEASE_SNAPSHOT_SCHEMA_VERSION)
    expect(snapshot).toMatchObject({ rules: [], knowledge: [], flows: [], channelPolicy: null, testSummary: null })
    expect(new Date(snapshot.capturedAt).getTime()).not.toBeNaN()
  })

  it('carries a test summary when one is given', async () => {
    const summary = { testRunId: 'run_1', status: 'PASSED', total: 10, passed: 10, failed: 0 }
    expect((await createReleaseSnapshot(summary)).testSummary).toEqual(summary)
  })

  it('records every published rule, with a null version', async () => {
    // A rule is configuration, not a versioned document — there is no version to record.
    mockPrisma.botRuleSetting.findMany.mockResolvedValue([
      { id: 'brs_1', key: 'bot.handoff_on_human_request', name: 'Handoff', enabled: true, config: null },
    ] as never)

    const snapshot = await createReleaseSnapshot()
    expect(snapshot.rules).toEqual([
      { id: 'brs_1', key: 'bot.handoff_on_human_request', name: 'Handoff', version: null, enabled: true, config: null },
    ])
  })

  it('carries each rule VALUE, which is what makes a rollback able to restore it', async () => {
    // Schema v1 recorded only which rules were published. A rollback could name the
    // configuration to return to but had nothing to put back — the button was decorative.
    mockPrisma.botRuleSetting.findMany.mockResolvedValue([
      {
        id: 'brs_1',
        key: 'bot.handoff_on_human_request',
        name: 'Default outbound',
        enabled: true,
        config: { liveDefaultChannel: 'UNOFFICIAL' },
      },
    ] as never)

    const snapshot = await createReleaseSnapshot()
    expect(snapshot.schemaVersion).toBe(2)
    expect(snapshot.rules[0]).toMatchObject({ enabled: true, config: { liveDefaultChannel: 'UNOFFICIAL' } })
  })

  it('records published knowledge by REVISION, so the version is what gets restored', async () => {
    mockPrisma.knowledgeRevision.findMany.mockResolvedValue([
      { id: 'krev_9', version: 3, title: 'FAQ Harga ATV', knowledgeSourceId: 'ks_1', knowledgeSource: { key: 'managed/abc' } },
    ] as never)

    const snapshot = await createReleaseSnapshot()
    expect(snapshot.knowledge).toEqual([
      { id: 'krev_9', key: 'managed/abc', name: 'FAQ Harga ATV', version: 3 },
    ])
  })

  it('leaves out a stored rule the registry no longer knows about', async () => {
    // It describes behaviour the code no longer implements; restoring it later would resurrect
    // nothing, and listing it would promise otherwise.
    mockPrisma.botRuleSetting.findMany.mockResolvedValue([
      { id: 'brs_1', key: 'bot.aturan_yang_sudah_dihapus', name: 'Sudah tidak ada', enabled: true, config: null },
    ] as never)

    expect((await createReleaseSnapshot()).rules).toEqual([])
  })
})

describe('readReleaseSnapshot', () => {
  it('reads back a snapshot this build understands', () => {
    const value = { schemaVersion: 1, capturedAt: 'x', rules: [], knowledge: [], flows: [], channelPolicy: null, testSummary: null }
    expect(readReleaseSnapshot(value)).not.toBeNull()
  })

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'bukan snapshot'],
    ['an object with no schemaVersion', { rules: [], knowledge: [], flows: [] }],
    ['an object whose collections are not arrays', { schemaVersion: 1, rules: {}, knowledge: [], flows: [] }],
  ])('refuses %s rather than half-understanding it', (_label, value) => {
    // A Json column has no schema. A rollback that misreads an old snapshot restores the wrong
    // configuration silently, which is worse than refusing.
    expect(readReleaseSnapshot(value as Prisma.JsonValue)).toBeNull()
  })
})

describe('previewRelease', () => {
  it('reports nothing to publish when no rule is approved, and still requires a test run', async () => {
    expect(await previewRelease()).toEqual({
      changes: { rules: 0, knowledge: 0, flows: 0, channelPolicy: 0 },
      requiresTestRun: true,
      blockingIssues: [],
      candidate: { ruleDraftKeys: [], knowledgeRevisionIds: [], flowVersionIds: [] },
    })
  })

  it('warns when the suite has no enabled cases, so the gate is not silently vacuous', async () => {
    // An advisory, not a hard block: refusing to publish because an account has not written
    // tests yet would make the gate impossible to adopt.
    mockPrisma.botTestCase.count.mockResolvedValue(0 as never)

    const preview = await previewRelease()
    expect(preview.blockingIssues.some((issue) => issue.includes('kasus uji aktif'))).toBe(true)
  })

  it('counts only APPROVED rules', async () => {
    // A draft still in DRAFT or REVIEW is deliberately invisible: showing it would tell an
    // operator that pressing Publish ships it, and it does not.
    mockPrisma.botRuleSetting.findMany.mockResolvedValue([
      { key: 'bot.handoff_on_human_request', name: 'Handoff' },
    ] as never)

    const preview = await previewRelease()
    expect(mockPrisma.botRuleSetting.findMany.mock.calls[0][0]?.where).toEqual({ status: 'APPROVED' })
    expect(preview.changes.rules).toBe(1)
    expect(preview.blockingIssues).toEqual([])
  })

  it('blocks an approved draft whose rule the registry has since locked', async () => {
    // SDD section 11 blocking condition 2, and not hypothetical: a deploy can flip a rule to
    // editable:false and strand an already-approved draft.
    mockPrisma.botRuleSetting.findMany.mockResolvedValue([
      { key: 'bot.no_invented_price', name: 'Tidak mengarang harga' },
    ] as never)

    const preview = await previewRelease()
    expect(preview.blockingIssues).toHaveLength(1)
    expect(preview.blockingIssues[0]).toContain('bot.no_invented_price')
  })
})

describe('publishRelease', () => {
  it('numbers the first release v1', async () => {
    await publishRelease({ testRunId: TEST_RUN_ID, title: 'Release pertama' })
    expect(mockTx.botRelease.create.mock.calls[0][0].data.version).toBe(1)
  })

  it('continues from the highest existing version', async () => {
    mockTx.botRelease.findFirst.mockResolvedValue({ version: 12 } as never)
    await publishRelease({ testRunId: TEST_RUN_ID, title: 'Release ke-13' })
    expect(mockTx.botRelease.create.mock.calls[0][0].data.version).toBe(13)
  })

  it('reads the version inside the transaction, not before it', async () => {
    // Reading outside would let two publishes see the same number and both believe they won.
    await publishRelease({ testRunId: TEST_RUN_ID, title: 'x' })
    expect(mockTx.botRelease.findFirst).toHaveBeenCalled()
    expect(mockPrisma.botRelease.findFirst).not.toHaveBeenCalled()
  })

  it('steps the previous release down to SUPERSEDED', async () => {
    // Exactly one release is PUBLISHED at a time; the rest are history.
    await publishRelease({ testRunId: TEST_RUN_ID, title: 'x' })
    expect(mockTx.botRelease.updateMany).toHaveBeenCalledWith({
      where: { status: 'PUBLISHED' },
      data: { status: 'SUPERSEDED' },
    })
  })

  it('takes the snapshot AFTER the entities move, so it records what the release created', async () => {
    // The row is created with a placeholder and the real snapshot written back, because the
    // entities need the release id to point at and the snapshot needs their post-publish state.
    await publishRelease({ testRunId: TEST_RUN_ID, title: 'x' })

    const snapshot = mockTx.botRelease.update.mock.calls[0][0].data.snapshot as Record<string, unknown>
    expect(snapshot.schemaVersion).toBe(RELEASE_SNAPSHOT_SCHEMA_VERSION)
    // Read through the transaction client, so it sees the rules this transaction just published.
    expect(mockTx.botRuleSetting.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'PUBLISHED' } })
    )
  })

  it('writes the audit row through the transaction client', async () => {
    // Second argument is `tx`: an audit write that fails has to take the publish with it, or
    // the system ends up with a publish nobody can attribute.
    await publishRelease({ testRunId: TEST_RUN_ID, title: 'x', actorId: 'acc_1', actorName: 'Budi' })

    expect(writeBotAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PUBLISH', entityType: 'RELEASE', actorId: 'acc_1' }),
      mockTx
    )
  })

  it('does everything in one transaction', async () => {
    await publishRelease({ testRunId: TEST_RUN_ID, title: 'x' })
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('moves an approved rule to PUBLISHED with its draft values', async () => {
    mockTx.botRuleSetting.findMany.mockResolvedValue([
      {
        id: 'brs_1',
        key: 'bot.handoff_on_human_request',
        enabled: true,
        config: null,
        status: 'APPROVED',
        draftEnabled: false,
        draftConfig: { catatan: 'baru' },
      },
    ] as never)

    await publishRelease({ testRunId: TEST_RUN_ID, title: 'x', actorId: 'acc_1' })

    const data = mockTx.botRuleSetting.update.mock.calls[0][0].data
    expect(data).toMatchObject({
      status: 'PUBLISHED',
      enabled: false,
      config: { catatan: 'baru' },
      runtimeSource: 'database',
      releaseId: 'rel_new',
    })
  })

  it('clears the draft columns as the values move across', async () => {
    // A row that is published AND still carries an identical draft reads as unfinished work to
    // the next person who opens the page.
    mockTx.botRuleSetting.findMany.mockResolvedValue([
      {
        id: 'brs_1',
        key: 'bot.handoff_on_human_request',
        enabled: true,
        config: null,
        status: 'APPROVED',
        draftEnabled: false,
        draftConfig: {},
      },
    ] as never)

    await publishRelease({ testRunId: TEST_RUN_ID, title: 'x' })

    const data = mockTx.botRuleSetting.update.mock.calls[0][0].data
    expect(data).toMatchObject({ draftEnabled: null, draftUpdatedAt: null, draftUpdatedBy: null })
  })

  it('keeps the current enabled state for a config-only draft', async () => {
    // `draftEnabled` is legitimately null when only the config changed; reading it as `false`
    // would silently switch the rule off.
    mockTx.botRuleSetting.findMany.mockResolvedValue([
      {
        id: 'brs_1',
        key: 'bot.handoff_on_human_request',
        enabled: true,
        config: null,
        status: 'APPROVED',
        draftEnabled: null,
        draftConfig: { liveDefaultChannel: 'UNOFFICIAL' },
      },
    ] as never)

    await publishRelease({ testRunId: TEST_RUN_ID, title: 'x' })
    expect(mockTx.botRuleSetting.update.mock.calls[0][0].data.enabled).toBe(true)
  })

  it('audits each published rule against the release', async () => {
    mockTx.botRuleSetting.findMany.mockResolvedValue([
      { id: 'brs_1', key: 'bot.handoff_on_human_request', enabled: true, config: null, status: 'APPROVED', draftEnabled: false, draftConfig: {} },
    ] as never)

    await publishRelease({ testRunId: TEST_RUN_ID, title: 'x', actorId: 'acc_1' })

    expect(writeBotAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PUBLISH', entityType: 'RULE', entityKey: 'bot.handoff_on_human_request', releaseId: 'rel_new' }),
      mockTx
    )
  })

  it('refuses to publish a rule the registry has locked since it was approved', async () => {
    // Re-checked here and not only in preview: preview and publish are separate requests, and
    // a deploy between them can change what the registry allows.
    mockTx.botRuleSetting.findMany.mockResolvedValue([
      { id: 'brs_1', key: 'bot.no_invented_price', enabled: true, config: null, status: 'APPROVED', draftEnabled: false, draftConfig: {} },
    ] as never)

    await expect(publishRelease({ testRunId: TEST_RUN_ID, title: 'x' })).rejects.toBeInstanceOf(ReleaseBlockedError)
    expect(mockTx.botRuleSetting.update).not.toHaveBeenCalled()
  })

  it('moves an approved flow version to PUBLISHED and repoints the definition', async () => {
    mockTx.botFlowVersion.findMany.mockResolvedValue([
      {
        id: 'ver_2',
        flowId: 'flow_1',
        version: 2,
        status: 'APPROVED',
        flow: { key: 'whatsapp-existing-bot-v1', editableLevel: 'SAFE_CONFIG' },
      },
    ] as never)

    await publishRelease({ testRunId: TEST_RUN_ID, title: 'x', actorId: 'acc_1' })

    // The previous one steps aside first: two PUBLISHED versions on one flow would make "which
    // config is the bot reading" unanswerable.
    expect(mockTx.botFlowVersion.updateMany).toHaveBeenCalledWith({
      where: { flowId: 'flow_1', status: 'PUBLISHED' },
      data: { status: 'ARCHIVED' },
    })
    expect(mockTx.botFlowDefinition.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { activeVersionId: 'ver_2', runtimeSource: 'database' } })
    )
  })

  it('refuses to publish a flow the code has since locked to READ_ONLY', async () => {
    // Preview and publish are separate requests; a deploy between them can drop the level.
    mockTx.botFlowVersion.findMany.mockResolvedValue([
      {
        id: 'ver_2',
        flowId: 'flow_1',
        version: 2,
        status: 'APPROVED',
        flow: { key: 'whatsapp-existing-bot-v1', editableLevel: 'READ_ONLY' },
      },
    ] as never)

    await expect(publishRelease({ testRunId: TEST_RUN_ID, title: 'x' })).rejects.toBeInstanceOf(ReleaseBlockedError)
  })

  it('refuses to publish a flow whose key the registry no longer has', async () => {
    mockTx.botFlowVersion.findMany.mockResolvedValue([
      { id: 'ver_2', flowId: 'flow_1', version: 2, status: 'APPROVED', flow: { key: 'flow-hantu', editableLevel: 'SAFE_CONFIG' } },
    ] as never)

    await expect(publishRelease({ testRunId: TEST_RUN_ID, title: 'x' })).rejects.toBeInstanceOf(ReleaseBlockedError)
  })

  it('records published flows in the snapshot by version', async () => {
    mockPrisma.botFlowVersion.findMany.mockResolvedValue([
      { id: 'ver_2', version: 2, flow: { key: 'whatsapp-existing-bot-v1', name: 'WhatsApp Existing Bot' } },
    ] as never)

    const snapshot = await createReleaseSnapshot()
    expect(snapshot.flows).toEqual([
      { id: 'ver_2', key: 'whatsapp-existing-bot-v1', name: 'WhatsApp Existing Bot', version: 2 },
    ])
  })

  it('refuses a publish with no test run at all', async () => {
    // A gate that only checks runs it is GIVEN is a gate anyone walks around by not mentioning
    // one.
    await expect(publishRelease({ title: 'x' })).rejects.toBeInstanceOf(ReleaseTestGateError)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('refuses a failing test run', async () => {
    mockPrisma.botTestRun.findUnique.mockResolvedValue({
      id: TEST_RUN_ID,
      status: 'FAILED',
      total: 5,
      passed: 3,
      failed: 2,
    } as never)

    await expect(publishRelease({ testRunId: TEST_RUN_ID, title: 'x' })).rejects.toThrow('gagal')
  })

  it('refuses a run that is still going', async () => {
    // A RUNNING run is not PASSED, so a process that died mid-suite cannot gate anything.
    mockPrisma.botTestRun.findUnique.mockResolvedValue({
      id: TEST_RUN_ID,
      status: 'RUNNING',
      total: 5,
      passed: 0,
      failed: 0,
    } as never)

    await expect(publishRelease({ testRunId: TEST_RUN_ID, title: 'x' })).rejects.toThrow('masih berjalan')
  })

  it('refuses a test run id that does not exist', async () => {
    mockPrisma.botTestRun.findUnique.mockResolvedValue(null as never)
    await expect(publishRelease({ testRunId: 'run_hantu', title: 'x' })).rejects.toBeInstanceOf(ReleaseTestGateError)
  })

  it('refuses an ADMIN trying to override a failed run', async () => {
    // §13 reserves the override for OWNER. An ADMIN who could wave away a failing test would
    // make the gate advisory.
    mockPrisma.botTestRun.findUnique.mockResolvedValue({
      id: TEST_RUN_ID,
      status: 'FAILED',
      total: 2,
      passed: 1,
      failed: 1,
    } as never)

    await expect(
      publishRelease({
        testRunId: TEST_RUN_ID,
        title: 'x',
        actorRole: 'ADMIN',
        overrideFailedTest: true,
        reason: 'Perlu terbit sekarang juga',
      })
    ).rejects.toThrow('Hanya OWNER')
  })

  it('requires a reason from an OWNER who overrides', async () => {
    // An override with no explanation is worse than the override: nobody reading the audit log
    // later can tell whether it was justified.
    mockPrisma.botTestRun.findUnique.mockResolvedValue({
      id: TEST_RUN_ID,
      status: 'FAILED',
      total: 2,
      passed: 1,
      failed: 1,
    } as never)

    await expect(
      publishRelease({ testRunId: TEST_RUN_ID, title: 'x', actorRole: 'OWNER', overrideFailedTest: true })
    ).rejects.toThrow('alasan')
  })

  it('lets an OWNER with a reason through, and records the override separately', async () => {
    mockPrisma.botTestRun.findUnique.mockResolvedValue({
      id: TEST_RUN_ID,
      status: 'FAILED',
      total: 2,
      passed: 1,
      failed: 1,
    } as never)

    await publishRelease({
      testRunId: TEST_RUN_ID,
      title: 'x',
      actorRole: 'OWNER',
      overrideFailedTest: true,
      reason: 'Perbaikan darurat, kasus ujinya sendiri yang salah',
    })

    // Its own filterable row: auditing "were tests ever bypassed" must not mean reading every
    // PUBLISH row.
    expect(writeBotAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'OVERRIDE_TEST_FAILURE', entityType: 'RELEASE' }),
      mockTx
    )
  })

  it('freezes the test counts into the snapshot', async () => {
    // Read from the run's stored columns, so the numbers that gated this publish keep saying
    // what they said even after the cases behind them change.
    await publishRelease({ testRunId: TEST_RUN_ID, title: 'x' })

    const snapshot = mockTx.botRelease.update.mock.calls[0][0].data.snapshot as { testSummary: unknown }
    expect(snapshot.testSummary).toEqual({ testRunId: TEST_RUN_ID, status: 'PASSED', total: 3, passed: 3, failed: 0 })
  })

  it('turns a version collision into a typed conflict the route can answer 409 with', async () => {
    // `version` is unique, so the publish that loses a race fails its insert rather than
    // quietly reusing a number.
    mockTx.botRelease.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7' })
    )

    await expect(publishRelease({ testRunId: TEST_RUN_ID, title: 'x' })).rejects.toBeInstanceOf(ReleaseVersionConflictError)
  })

  it('lets an unrelated database error through unchanged', async () => {
    mockTx.botRelease.create.mockRejectedValue(new Error('db down'))
    await expect(publishRelease({ testRunId: TEST_RUN_ID, title: 'x' })).rejects.toThrow('db down')
  })
})

describe('rollbackToRelease', () => {
  beforeEach(() => {
    mockTx.botRelease.findUnique.mockResolvedValue(release())
    mockTx.botRelease.findFirst.mockResolvedValue({ version: 5 } as never)
    mockTx.botRelease.update.mockResolvedValue({ id: 'rel_current' } as never)
  })

  it('publishes a NEW release carrying the target snapshot, deleting nothing', async () => {
    // SDD Manage Second §12: the history reads forwards -- v12, v13, then "v14: rollback to
    // v12" -- instead of a v13 that mysteriously stops existing.
    mockTx.botRelease.findFirst
      .mockResolvedValueOnce({ version: 5 } as never)
      .mockResolvedValueOnce({ id: 'rel_current', version: 5 } as never)

    await rollbackToRelease({ targetReleaseId: 'rel_1', reason: 'Jawaban pricing jadi salah' })

    const data = mockTx.botRelease.create.mock.calls[0][0].data
    expect(data.version).toBe(6)
    expect(data.rollbackOfId).toBe('rel_1')
    expect(data.title).toBe('Rollback ke versi 3')
    expect(mockTx.botRelease.delete).not.toHaveBeenCalled()
    expect(mockTx.botRelease.deleteMany).not.toHaveBeenCalled()
  })

  it('marks the release being left behind ROLLED_BACK, not SUPERSEDED', async () => {
    // It did not simply age out; it was actively withdrawn, and the list has to show that.
    mockTx.botRelease.findFirst
      .mockResolvedValueOnce({ version: 5 } as never)
      .mockResolvedValueOnce({ id: 'rel_current', version: 5 } as never)

    await rollbackToRelease({ targetReleaseId: 'rel_1', reason: 'Jawaban pricing jadi salah' })

    expect(mockTx.botRelease.update).toHaveBeenCalledWith({
      where: { id: 'rel_current' },
      data: { status: 'ROLLED_BACK' },
    })
  })

  it('stores the reason and audits it', async () => {
    await rollbackToRelease({
      targetReleaseId: 'rel_1',
      reason: 'FAQ baru menyebabkan jawaban pricing salah',
      actorId: 'acc_1',
    })

    expect(mockTx.botRelease.create.mock.calls[0][0].data.notes).toBe('FAQ baru menyebabkan jawaban pricing salah')
    expect(writeBotAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ROLLBACK', reason: 'FAQ baru menyebabkan jawaban pricing salah' }),
      mockTx
    )
  })

  it('refuses a release that does not exist', async () => {
    mockTx.botRelease.findUnique.mockResolvedValue(null as never)
    await expect(rollbackToRelease({ targetReleaseId: 'nope', reason: 'apa pun' })).rejects.toBeInstanceOf(
      ReleaseNotFoundError
    )
  })

  it('refuses to roll back to what is already live', async () => {
    // It would publish a release that changes nothing -- noise in the history at exactly the
    // moment the history matters most.
    mockTx.botRelease.findUnique.mockResolvedValue(release({ status: 'PUBLISHED' }))
    await expect(rollbackToRelease({ targetReleaseId: 'rel_1', reason: 'apa pun' })).rejects.toBeInstanceOf(
      ReleaseAlreadyActiveError
    )
  })

  it('refuses a snapshot it cannot read, rather than claiming to restore it', async () => {
    mockTx.botRelease.findUnique.mockResolvedValue(release({ snapshot: { bentuk: 'asing' } }))
    await expect(rollbackToRelease({ targetReleaseId: 'rel_1', reason: 'apa pun' })).rejects.toThrow(
      'tidak bisa dibaca'
    )
    expect(mockTx.botRelease.create).not.toHaveBeenCalled()
  })

  it('does everything in one transaction', async () => {
    await rollbackToRelease({ targetReleaseId: 'rel_1', reason: 'apa pun' })
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('actually puts the snapshot rule values back', async () => {
    // Creating a release row that NAMES an earlier configuration without restoring it is worse
    // than having no rollback button: the operator presses it, sees the entry appear, and walks
    // away believing the bot changed.
    mockTx.botRelease.findUnique.mockResolvedValue(
      release({
        snapshot: {
          schemaVersion: 2,
          capturedAt: 'x',
          rules: [
            {
              id: 'brs_1',
              key: 'bot.handoff_on_human_request',
              name: 'Default outbound',
              version: null,
              enabled: true,
              config: { liveDefaultChannel: 'UNOFFICIAL' },
            },
          ],
          knowledge: [],
          flows: [],
          channelPolicy: null,
          testSummary: null,
        },
      })
    )
    mockTx.botRuleSetting.findUnique.mockResolvedValue({
      id: 'brs_1',
      enabled: true,
      config: { liveDefaultChannel: 'OFFICIAL' },
    } as never)

    await rollbackToRelease({ targetReleaseId: 'rel_1', reason: 'Default salah arah' })

    expect(mockTx.botRuleSetting.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'bot.handoff_on_human_request' },
        data: expect.objectContaining({ enabled: true, config: { liveDefaultChannel: 'UNOFFICIAL' } }),
      })
    )
  })

  it('skips a rule whose value is already what the snapshot says', async () => {
    // Rewriting an unchanged row would fill the audit log with rollbacks that changed nothing.
    mockTx.botRelease.findUnique.mockResolvedValue(
      release({
        snapshot: {
          schemaVersion: 2,
          capturedAt: 'x',
          rules: [
            { id: 'brs_1', key: 'bot.handoff_on_human_request', name: 'H', version: null, enabled: false, config: null },
          ],
          knowledge: [],
          flows: [],
          channelPolicy: null,
          testSummary: null,
        },
      })
    )
    mockTx.botRuleSetting.findUnique.mockResolvedValue({ id: 'brs_1', enabled: false, config: null } as never)

    await rollbackToRelease({ targetReleaseId: 'rel_1', reason: 'apa pun' })
    expect(mockTx.botRuleSetting.update).not.toHaveBeenCalled()
  })

  it('refuses a v1 snapshot rather than restoring it from whatever the rows hold now', async () => {
    // v1 recorded which rules were published but never their values. "Restoring" from it would
    // set every rule to the state being rolled back FROM.
    mockTx.botRelease.findUnique.mockResolvedValue(
      release({
        snapshot: {
          schemaVersion: 1,
          capturedAt: 'x',
          rules: [{ id: 'brs_1', key: 'bot.handoff_on_human_request', name: 'H', version: null }],
          knowledge: [],
          flows: [],
          channelPolicy: null,
          testSummary: null,
        },
      })
    )

    await expect(rollbackToRelease({ targetReleaseId: 'rel_1', reason: 'apa pun' })).rejects.toBeInstanceOf(
      ReleaseNotRestorableError
    )
  })

  it('republishes the knowledge revision the snapshot names, archiving whatever superseded it', async () => {
    mockTx.botRelease.findUnique.mockResolvedValue(
      release({
        snapshot: {
          schemaVersion: 2,
          capturedAt: 'x',
          rules: [],
          knowledge: [{ id: 'krev_3', key: 'managed/abc', name: 'FAQ ATV', version: 3 }],
          flows: [],
          channelPolicy: null,
          testSummary: null,
        },
      })
    )
    mockTx.knowledgeRevision.findUnique.mockResolvedValue({
      id: 'krev_3',
      knowledgeSourceId: 'ks_1',
      version: 3,
      status: 'ARCHIVED',
      title: 'FAQ ATV',
      summary: null,
    } as never)

    await rollbackToRelease({ targetReleaseId: 'rel_1', reason: 'Versi 4 salah harga' })

    // The newer one steps aside first, so a source never has two published revisions at once.
    expect(mockTx.knowledgeRevision.updateMany).toHaveBeenCalledWith({
      where: { knowledgeSourceId: 'ks_1', status: 'PUBLISHED' },
      data: { status: 'ARCHIVED' },
    })
    expect(mockTx.knowledgeRevision.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'krev_3' }, data: expect.objectContaining({ status: 'PUBLISHED' }) })
    )
  })

  it('republishes the flow version the snapshot names and repoints the definition', async () => {
    mockTx.botRelease.findUnique.mockResolvedValue(
      release({
        snapshot: {
          schemaVersion: 2,
          capturedAt: 'x',
          rules: [],
          knowledge: [],
          flows: [{ id: 'ver_1', key: 'whatsapp-existing-bot-v1', name: 'WhatsApp Existing Bot', version: 1 }],
          channelPolicy: null,
          testSummary: null,
        },
      })
    )
    mockTx.botFlowVersion.findUnique.mockResolvedValue({
      id: 'ver_1',
      flowId: 'flow_1',
      version: 1,
      status: 'ARCHIVED',
    } as never)

    await rollbackToRelease({ targetReleaseId: 'rel_1', reason: 'Kalimat baru membingungkan customer' })

    expect(mockTx.botFlowVersion.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ver_1' }, data: expect.objectContaining({ status: 'PUBLISHED' }) })
    )
    expect(mockTx.botFlowDefinition.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { activeVersionId: 'ver_1', runtimeSource: 'database' } })
    )
  })

  it('skips a snapshot revision that no longer exists rather than failing the whole rollback', async () => {
    mockTx.botRelease.findUnique.mockResolvedValue(
      release({
        snapshot: {
          schemaVersion: 2,
          capturedAt: 'x',
          rules: [],
          knowledge: [{ id: 'krev_hilang', key: 'managed/abc', name: 'FAQ', version: 3 }],
          flows: [],
          channelPolicy: null,
          testSummary: null,
        },
      })
    )
    mockTx.knowledgeRevision.findUnique.mockResolvedValue(null as never)

    await rollbackToRelease({ targetReleaseId: 'rel_1', reason: 'apa pun' })
    expect(mockTx.knowledgeRevision.update).not.toHaveBeenCalled()
  })
})
