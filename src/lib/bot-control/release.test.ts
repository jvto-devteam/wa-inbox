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
  ReleaseVersionConflictError,
  RELEASE_SNAPSHOT_SCHEMA_VERSION,
} from './release'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/bot-control/audit', () => ({ writeBotAuditLog: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
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
  it('reports nothing to publish and nothing blocking, in this phase', async () => {
    // Empty blockingIssues here means "nothing to check", not "everything checked out" — the
    // real gates land alongside the entities they are about, in Phases C through H.
    expect(await previewRelease()).toEqual({
      changes: { rules: 0, knowledge: 0, flows: 0, channelPolicy: 0 },
      requiresTestRun: false,
      blockingIssues: [],
    })
  })
})

describe('publishRelease', () => {
  it('numbers the first release v1', async () => {
    await publishRelease({ title: 'Release pertama' })
    expect(mockTx.botRelease.create.mock.calls[0][0].data.version).toBe(1)
  })

  it('continues from the highest existing version', async () => {
    mockTx.botRelease.findFirst.mockResolvedValue({ version: 12 } as never)
    await publishRelease({ title: 'Release ke-13' })
    expect(mockTx.botRelease.create.mock.calls[0][0].data.version).toBe(13)
  })

  it('reads the version inside the transaction, not before it', async () => {
    // Reading outside would let two publishes see the same number and both believe they won.
    await publishRelease({ title: 'x' })
    expect(mockTx.botRelease.findFirst).toHaveBeenCalled()
    expect(mockPrisma.botRelease.findFirst).not.toHaveBeenCalled()
  })

  it('steps the previous release down to SUPERSEDED', async () => {
    // Exactly one release is PUBLISHED at a time; the rest are history.
    await publishRelease({ title: 'x' })
    expect(mockTx.botRelease.updateMany).toHaveBeenCalledWith({
      where: { status: 'PUBLISHED' },
      data: { status: 'SUPERSEDED' },
    })
  })

  it('stores a snapshot on the release', async () => {
    await publishRelease({ title: 'x' })
    const snapshot = mockTx.botRelease.create.mock.calls[0][0].data.snapshot as Record<string, unknown>
    expect(snapshot.schemaVersion).toBe(RELEASE_SNAPSHOT_SCHEMA_VERSION)
  })

  it('writes the audit row through the transaction client', async () => {
    // Second argument is `tx`: an audit write that fails has to take the publish with it, or
    // the system ends up with a publish nobody can attribute.
    await publishRelease({ title: 'x', actorId: 'acc_1', actorName: 'Budi' })

    expect(writeBotAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PUBLISH', entityType: 'RELEASE', actorId: 'acc_1' }),
      mockTx
    )
  })

  it('does everything in one transaction', async () => {
    await publishRelease({ title: 'x' })
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('turns a version collision into a typed conflict the route can answer 409 with', async () => {
    // `version` is unique, so the publish that loses a race fails its insert rather than
    // quietly reusing a number.
    mockTx.botRelease.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7' })
    )

    await expect(publishRelease({ title: 'x' })).rejects.toBeInstanceOf(ReleaseVersionConflictError)
  })

  it('lets an unrelated database error through unchanged', async () => {
    mockTx.botRelease.create.mockRejectedValue(new Error('db down'))
    await expect(publishRelease({ title: 'x' })).rejects.toThrow('db down')
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
})
