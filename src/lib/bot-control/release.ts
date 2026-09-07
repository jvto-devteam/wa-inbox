/**
 * Releases: the record of what was published, and the thing rollback restores from.
 *
 * --- Why a release stores a copy, not a list of pointers ---
 *
 * `BotRelease.snapshot` holds the actual configuration that was live, not a list of row ids
 * pointing at it. That distinction is the entire reason rollback can work. Pointers only
 * describe the past for as long as the rows they point at still exist and still say the same
 * thing — and the whole point of the phases after this one is that those rows get edited. A
 * copy turns "put it back to how it was on the 7th" from a hope into a statement the system
 * can actually satisfy.
 *
 * --- What is in the snapshot today ---
 *
 * SDD Manage Second §7.2 requires the snapshot to carry active rule, knowledge and flow
 * versions, the active channel policy, and a test summary. In THIS phase every one of those
 * collections is empty, and that is correct rather than unfinished: `BotRuleSetting`,
 * `KnowledgeRevision`, `BotFlowVersion`, `ChannelPolicySetting` and `BotTestRun` arrive in
 * Phases C, D, E, H and F respectively. The shape is fixed now so those phases add a reader to
 * `createReleaseSnapshot` and nothing else — no migration of already-published snapshots, no
 * second snapshot format to support forever.
 *
 * `schemaVersion` exists for the same reason: a snapshot read years later has to say which
 * shape it was written in, because a rollback that misreads an old snapshot restores the wrong
 * configuration silently.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { sanitizeTrace } from '@/lib/bot-control/trace-sanitizer'
import { writeBotAuditLog } from '@/lib/bot-control/audit'

export const RELEASE_SNAPSHOT_SCHEMA_VERSION = 1

export const RELEASE_STATUSES = ['PUBLISHED', 'ROLLED_BACK', 'SUPERSEDED'] as const
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number]

/** One published thing, identified in a way that stays readable when its row is gone. */
export type ReleaseSnapshotEntry = {
  id: string
  key: string
  name: string
  /** Null for entities that are configuration rather than versioned documents. */
  version: number | null
}

export type ReleaseTestSummary = {
  testRunId: string | null
  status: string
  total: number
  passed: number
  failed: number
}

export type ReleaseSnapshot = {
  schemaVersion: number
  capturedAt: string
  rules: ReleaseSnapshotEntry[]
  knowledge: ReleaseSnapshotEntry[]
  flows: ReleaseSnapshotEntry[]
  channelPolicy: Record<string, unknown> | null
  testSummary: ReleaseTestSummary | null
}

/**
 * Captures what is currently active, ready to be stored on a release.
 *
 * Runs `sanitizeTrace` over the result even though nothing it reads today can contain a
 * secret. Phase H puts channel policy in here, and channel policy is the one part of this
 * system that sits next to provider credentials — by the time that lands, the redaction has to
 * already be on the path rather than be something someone remembers to add. CLAUDE.md's
 * "Larangan Mutlak" says a snapshot may never carry a token; this is where that is enforced.
 */
export async function createReleaseSnapshot(testSummary: ReleaseTestSummary | null = null): Promise<ReleaseSnapshot> {
  const snapshot: ReleaseSnapshot = {
    schemaVersion: RELEASE_SNAPSHOT_SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    // Empty until Phases C, D, E and H add their readers — see the note at the top.
    rules: [],
    knowledge: [],
    flows: [],
    channelPolicy: null,
    testSummary,
  }
  return sanitizeTrace(snapshot) as unknown as ReleaseSnapshot
}

/**
 * Reads a stored snapshot back, defensively.
 *
 * A Json column has no schema, and this value may have been written by an older version of
 * this file. Anything that does not look like a snapshot returns null, so a rollback refuses
 * rather than restoring a half-understood shape.
 */
export function readReleaseSnapshot(value: Prisma.JsonValue): ReleaseSnapshot | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.schemaVersion !== 'number') return null
  if (!Array.isArray(record.rules) || !Array.isArray(record.knowledge) || !Array.isArray(record.flows)) return null
  return value as unknown as ReleaseSnapshot
}

export type ReleasePreview = {
  changes: { rules: number; knowledge: number; flows: number; channelPolicy: number }
  requiresTestRun: boolean
  blockingIssues: string[]
}

/**
 * What a publish would do right now.
 *
 * Reports zero changes and no blocking issues in this phase, because there is nothing draftable
 * in the database yet to count or to block on. It deliberately does NOT pretend to gate: an
 * empty `blockingIssues` here means "nothing to check", not "everything checked out", and the
 * checks in SDD §11 (non-editable rule changed, unapproved revision, Official as outbound
 * default without an owner override, campaign rate above the system cap) land alongside the
 * entities they are about, in Phases C through H.
 */
export async function previewRelease(): Promise<ReleasePreview> {
  return {
    changes: { rules: 0, knowledge: 0, flows: 0, channelPolicy: 0 },
    // Flips to true in Phase F, when BotTestRun exists and a publish can actually be gated on one.
    requiresTestRun: false,
    blockingIssues: [],
  }
}

export type PublishReleaseParams = {
  title: string
  description?: string | null
  notes?: string | null
  testRunId?: string | null
  actorId?: string | null
  actorName?: string | null
  reason?: string | null
  req?: Request | null
}

export type PublishedRelease = {
  id: string
  version: number
  title: string
  status: string
  publishedAt: Date
}

/** Raised when two publishes race for the same version number. The caller answers 409. */
export class ReleaseVersionConflictError extends Error {
  constructor() {
    super('Ada publish lain yang berjalan bersamaan — coba lagi.')
    this.name = 'ReleaseVersionConflictError'
  }
}

export class ReleaseNotFoundError extends Error {
  constructor() {
    super('Release tidak ditemukan.')
    this.name = 'ReleaseNotFoundError'
  }
}

export class ReleaseAlreadyActiveError extends Error {
  constructor() {
    super('Release ini sudah yang aktif — tidak ada yang perlu dikembalikan.')
    this.name = 'ReleaseAlreadyActiveError'
  }
}

/**
 * Publishes a new release. One transaction, per SDD §11 and CLAUDE.md.
 *
 * The transaction is not ceremony. It covers three writes that are meaningless apart: the
 * previous release stepping down to SUPERSEDED, the new release appearing, and the audit row
 * recording that it happened. A crash between the first two would leave the system with NO
 * published release; a crash before the third would leave a publish nobody can attribute.
 */
export async function publishRelease(params: PublishReleaseParams): Promise<PublishedRelease> {
  try {
    return await prisma.$transaction(async (tx) => {
      const snapshot = await createReleaseSnapshot()

      // Read inside the transaction, not before it. `version` is unique, so a concurrent
      // publish that wins the race makes this one fail its insert rather than quietly reuse a
      // number — which is why the catch below turns P2002 into a 409 instead of a 500.
      const latest = await tx.botRelease.findFirst({ orderBy: { version: 'desc' }, select: { version: true } })
      const version = (latest?.version ?? 0) + 1

      // Exactly one release is PUBLISHED at a time; the rest are history.
      await tx.botRelease.updateMany({ where: { status: 'PUBLISHED' }, data: { status: 'SUPERSEDED' } })

      const release = await tx.botRelease.create({
        data: {
          version,
          title: params.title,
          description: params.description ?? null,
          status: 'PUBLISHED',
          publishedBy: params.actorId ?? null,
          testRunId: params.testRunId ?? null,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          notes: params.notes ?? null,
        },
        select: { id: true, version: true, title: true, status: true, publishedAt: true },
      })

      // `tx`, not the shared client: an audit write that fails must take the publish with it.
      await writeBotAuditLog(
        {
          action: 'PUBLISH',
          entityType: 'RELEASE',
          entityId: release.id,
          entityKey: `release:${release.version}`,
          actorId: params.actorId,
          actorName: params.actorName,
          after: { version: release.version, title: release.title, status: release.status },
          reason: params.reason,
          releaseId: release.id,
          req: params.req,
        },
        tx
      )

      return release
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ReleaseVersionConflictError()
    }
    throw error
  }
}

export type RollbackParams = {
  targetReleaseId: string
  reason: string
  actorId?: string | null
  actorName?: string | null
  req?: Request | null
}

/**
 * Rolls back to a previous release by publishing its snapshot again.
 *
 * Nothing is deleted and nothing is rewritten in place (SDD §12). The target release row is
 * left exactly as it was; what happens is that a NEW release is created carrying a copy of the
 * target's snapshot and a `rollbackOfId` pointing at it. The history therefore reads forwards
 * — v12, v13, then "v14: rollback to v12" — instead of a v13 that mysteriously stops existing.
 */
export async function rollbackToRelease(params: RollbackParams): Promise<PublishedRelease> {
  try {
    return await prisma.$transaction(async (tx) => {
      const target = await tx.botRelease.findUnique({ where: { id: params.targetReleaseId } })
      if (!target) throw new ReleaseNotFoundError()

      // Rolling back to what is already live would publish a release that changes nothing —
      // noise in the history at exactly the moment the history matters most.
      if (target.status === 'PUBLISHED') throw new ReleaseAlreadyActiveError()

      // A snapshot this code cannot read is a snapshot it must not claim to restore.
      if (!readReleaseSnapshot(target.snapshot)) {
        throw new Error(`Snapshot release v${target.version} tidak bisa dibaca — rollback dibatalkan.`)
      }

      const latest = await tx.botRelease.findFirst({ orderBy: { version: 'desc' }, select: { version: true } })
      const version = (latest?.version ?? 0) + 1

      // The release being left behind is ROLLED_BACK, not SUPERSEDED: it did not simply age
      // out, it was actively withdrawn, and an operator reading the list needs to see that.
      const current = await tx.botRelease.findFirst({ where: { status: 'PUBLISHED' }, select: { id: true, version: true } })
      if (current) {
        await tx.botRelease.update({ where: { id: current.id }, data: { status: 'ROLLED_BACK' } })
      }

      const release = await tx.botRelease.create({
        data: {
          version,
          title: `Rollback ke versi ${target.version}`,
          description: target.title,
          status: 'PUBLISHED',
          publishedBy: params.actorId ?? null,
          rollbackOfId: target.id,
          // The target's snapshot verbatim: that IS the configuration being restored.
          snapshot: target.snapshot as Prisma.InputJsonValue,
          notes: params.reason,
        },
        select: { id: true, version: true, title: true, status: true, publishedAt: true },
      })

      await writeBotAuditLog(
        {
          action: 'ROLLBACK',
          entityType: 'RELEASE',
          entityId: release.id,
          entityKey: `release:${release.version}`,
          actorId: params.actorId,
          actorName: params.actorName,
          before: { activeVersion: current?.version ?? null },
          after: { activeVersion: release.version, restoredFromVersion: target.version },
          reason: params.reason,
          releaseId: release.id,
          req: params.req,
        },
        tx
      )

      return release
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ReleaseVersionConflictError()
    }
    throw error
  }
}
