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
import { writeBotAuditLog, type AuditWriter } from '@/lib/bot-control/audit'
import { getBotRule } from '@/lib/bot-control/rule-registry'
import { invalidateRuntimeRuleCache } from '@/lib/bot-control/runtime-rules'

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
 * Called INSIDE the publish transaction and after the entities have moved, so what it records
 * is the state the release actually created — not the state that existed a moment before it.
 *
 * Runs `sanitizeTrace` over the result even though nothing it reads today can contain a
 * secret. Phase H puts channel policy in here, and channel policy is the one part of this
 * system that sits next to provider credentials — by the time that lands, the redaction has to
 * already be on the path rather than be something someone remembers to add. CLAUDE.md's
 * "Larangan Mutlak" says a snapshot may never carry a token; this is where that is enforced.
 */
export async function createReleaseSnapshot(
  testSummary: ReleaseTestSummary | null = null,
  client: AuditWriter = prisma
): Promise<ReleaseSnapshot> {
  // A rule the registry no longer knows about is left out: it describes behaviour the code no
  // longer implements, and restoring it later would resurrect nothing.
  const stored = await client.botRuleSetting.findMany({
    where: { status: 'PUBLISHED' },
    select: { id: true, key: true, name: true },
    orderBy: { key: 'asc' },
  })

  const snapshot: ReleaseSnapshot = {
    schemaVersion: RELEASE_SNAPSHOT_SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    // `version: null` throughout: a rule is configuration, not a versioned document.
    rules: stored
      .filter((row) => getBotRule(row.key) !== null)
      .map((row) => ({ id: row.id, key: row.key, name: row.name, version: null })),
    // Empty until Phases D, E and H add their readers — see the note at the top.
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
 * Counts only APPROVED rules, because those are the only ones publish will act on. A draft
 * still sitting in DRAFT or REVIEW is deliberately invisible here: showing it would tell an
 * operator that pressing Publish ships it, and it does not.
 *
 * The knowledge, flow and channel-policy counts stay zero until Phases D, E and H, and their
 * gates from SDD §11 arrive alongside them. An empty `blockingIssues` still means "nothing
 * further to check", not "everything checked out".
 */
export async function previewRelease(): Promise<ReleasePreview> {
  const approved = await prisma.botRuleSetting.findMany({
    where: { status: 'APPROVED' },
    select: { key: true, name: true },
  })

  // SDD §11 blocking condition 2. This is not hypothetical: a deploy that flips a rule to
  // `editable: false` in the registry can strand an already-approved draft, and publishing it
  // would apply a change the code has since decided may not be made from a web form.
  const blockingIssues = approved
    .filter((row) => getBotRule(row.key)?.editable !== true)
    .map((row) => `Rule "${row.name}" (${row.key}) sudah tidak boleh diubah dari UI — draft-nya harus ditolak.`)

  return {
    changes: { rules: approved.length, knowledge: 0, flows: 0, channelPolicy: 0 },
    // Flips to true in Phase F, when BotTestRun exists and a publish can actually be gated on one.
    requiresTestRun: false,
    blockingIssues,
  }
}

/** Raised when publish refuses because preview found something it will not ship. */
export class ReleaseBlockedError extends Error {
  readonly issues: string[]
  constructor(issues: string[]) {
    super(`Release diblokir: ${issues.join(' ')}`)
    this.name = 'ReleaseBlockedError'
    this.issues = issues
  }
}

/**
 * Moves every APPROVED rule into its published state, inside the caller's transaction.
 *
 * The draft columns are cleared as the values move across. Leaving them populated would make
 * the row read as "published, and also has a pending draft identical to it" — a state that
 * looks like unfinished work to the next person who opens the page.
 */
async function publishApprovedRules(
  tx: Prisma.TransactionClient,
  releaseId: string,
  actor: { id?: string | null; name?: string | null },
  req?: Request | null
): Promise<number> {
  const approved = await tx.botRuleSetting.findMany({ where: { status: 'APPROVED' } })
  const publishedAt = new Date()

  for (const row of approved) {
    // Re-checked here and not only in preview: preview and publish are separate requests, and
    // a deploy between them can change what the registry allows.
    if (getBotRule(row.key)?.editable !== true) {
      throw new ReleaseBlockedError([`Rule ${row.key} tidak boleh diubah dari UI.`])
    }

    const updated = await tx.botRuleSetting.update({
      where: { key: row.key },
      data: {
        status: 'PUBLISHED',
        // The draft becomes the live value. `draftEnabled` can legitimately be null on a
        // config-only draft, in which case the current enabled state is what carries forward.
        enabled: row.draftEnabled ?? row.enabled,
        config: (row.draftConfig ?? Prisma.DbNull) as Prisma.InputJsonValue,
        runtimeSource: 'database',
        publishedBy: actor.id ?? null,
        publishedAt,
        releaseId,
        draftConfig: Prisma.DbNull,
        draftEnabled: null,
        draftUpdatedAt: null,
        draftUpdatedBy: null,
      },
    })

    await writeBotAuditLog(
      {
        action: 'PUBLISH',
        entityType: 'RULE',
        entityId: row.id,
        entityKey: row.key,
        actorId: actor.id,
        actorName: actor.name,
        before: { enabled: row.enabled, config: row.config, status: row.status },
        after: { enabled: updated.enabled, config: updated.config, status: updated.status },
        releaseId,
        req,
      },
      tx
    )
  }

  return approved.length
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
    const release = await prisma.$transaction(async (tx) => {
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
          // Placeholder, replaced below. The release row has to exist first so the entities it
          // publishes can point at its id, and the snapshot has to be taken after they move so
          // it records what this release actually created rather than what preceded it.
          snapshot: {} as Prisma.InputJsonValue,
          notes: params.notes ?? null,
        },
        select: { id: true, version: true, title: true, status: true, publishedAt: true },
      })

      // Entities first, then the snapshot of what they became.
      await publishApprovedRules(tx, release.id, { id: params.actorId, name: params.actorName }, params.req)

      const snapshot = await createReleaseSnapshot(null, tx)
      await tx.botRelease.update({
        where: { id: release.id },
        data: { snapshot: snapshot as unknown as Prisma.InputJsonValue },
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

    // The runtime reads rules through a 30-second cache (runtime-rules.ts). Dropping it here
    // is what makes a publish take effect while the operator is still looking at the screen —
    // without it a change that appears not to have worked gets published again.
    invalidateRuntimeRuleCache()
    return release
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
    const release = await prisma.$transaction(async (tx) => {
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

    invalidateRuntimeRuleCache()
    return release
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ReleaseVersionConflictError()
    }
    throw error
  }
}
