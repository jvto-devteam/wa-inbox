/**
 * Creating and moving managed knowledge through draft → review → approve → publish.
 *
 * --- Managed knowledge sits BESIDE the catalog mirror, never on top of it ---
 *
 * `KnowledgeSource` already holds one row per `catalog/*.json` file, written by the indexer.
 * Those rows are a mirror of disk and must stay that way: the indexer overwrites them on every
 * sync, and `type=MANUAL` is explicitly protected from it by CLAUDE.md. So everything here
 * creates rows with `type='MANUAL'` and never touches a `CATALOG_JSON` row. The two sources
 * are merged at read time (src/lib/bot/managed-knowledge.ts), not merged in the table.
 *
 * --- Why a published revision is immutable ---
 *
 * Editing a PUBLISHED revision would change the past. A release snapshot naming version 3
 * would then describe content different from what the bot actually used when that release was
 * live, and the audit trail would be quietly wrong precisely where somebody is relying on it.
 * Every change therefore creates a NEW revision, and the version number goes up.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { writeBotAuditLog, type AuditAction } from '@/lib/bot-control/audit'
import { validateKnowledgeBody, type ManagedKnowledgeBody } from '@/lib/bot-control/knowledge-body'

export const REVISION_STATUSES = ['DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED', 'REJECTED'] as const
export type RevisionStatus = (typeof REVISION_STATUSES)[number]

/** The only source type this module ever creates or edits. */
export const MANAGED_SOURCE_TYPE = 'MANUAL'

/** Lifecycle values on the SOURCE, reusing its existing `status` column. */
export const SOURCE_LIFECYCLES = ['PUBLISHED', 'DRAFT', 'ARCHIVED'] as const

/**
 * Which statuses each transition may start from.
 *
 * A revision may be re-edited from DRAFT, REVIEW, APPROVED or REJECTED. Re-editing an APPROVED
 * revision sends it back to DRAFT for the same reason it does for rules: approval attaches to
 * particular content, and carrying it silently onto different content publishes something
 * nobody read.
 */
const ALLOWED_FROM: Record<'DRAFT' | 'REVIEW' | 'APPROVE' | 'REJECT', readonly RevisionStatus[]> = {
  DRAFT: ['DRAFT', 'REVIEW', 'APPROVED', 'REJECTED'],
  REVIEW: ['DRAFT', 'REJECTED'],
  APPROVE: ['REVIEW'],
  REJECT: ['DRAFT', 'REVIEW', 'APPROVED'],
}

export class KnowledgeNotFoundError extends Error {
  constructor(message = 'Knowledge tidak ditemukan.') {
    super(message)
    this.name = 'KnowledgeNotFoundError'
  }
}

export class KnowledgeNotEditableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KnowledgeNotEditableError'
  }
}

export class KnowledgeTransitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KnowledgeTransitionError'
  }
}

export type Actor = { id: string; name: string | null }

export type RevisionResult = {
  sourceId: string
  revisionId: string
  version: number
  status: string
  title: string
}

/** Audit-sized description of a revision. Never the whole body — see audit.ts. */
function revisionFields(row: { version: number; title: string; status: string; summary: string | null }) {
  return { version: row.version, title: row.title, status: row.status, summary: row.summary }
}

/** A key that cannot collide with the indexer's, which uses the file path. */
function managedKey(): string {
  return `managed/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export type CreateSourceParams = {
  title: string
  summary?: string | null
  body: unknown
  reason: string
  type?: string
}

/**
 * Creates a managed source together with its first revision, as one transaction.
 *
 * A source with no revision is a row claiming knowledge that has no content — it would show up
 * in the explorer and in every count, and answer nothing. The two are created together or not
 * at all.
 */
export async function createManagedKnowledge(
  params: CreateSourceParams,
  actor: Actor,
  req?: Request
): Promise<RevisionResult> {
  const validated = validateKnowledgeBody(params.body)
  if (!validated.ok) throw new KnowledgeNotEditableError(validated.error)

  const result = await prisma.$transaction(async (tx) => {
    const source = await tx.knowledgeSource.create({
      data: {
        key: managedKey(),
        title: params.title,
        // Always MANUAL: the indexer is contractually forbidden from touching these rows, and
        // that protection is keyed on the type.
        type: MANAGED_SOURCE_TYPE,
        // The SOURCE is a draft until its first revision is published. Listing it as PUBLISHED
        // straight away would put unpublished content in front of an operator as though the
        // bot were already using it.
        status: 'DRAFT',
        summary: params.summary ?? null,
        ownerId: actor.id,
        createdBy: actor.id,
      },
    })

    const revision = await tx.knowledgeRevision.create({
      data: {
        knowledgeSourceId: source.id,
        version: 1,
        title: params.title,
        body: validated.body as unknown as Prisma.InputJsonValue,
        summary: params.summary ?? null,
        status: 'DRAFT',
        changeReason: params.reason,
        createdBy: actor.id,
      },
    })

    await writeBotAuditLog(
      {
        action: 'CREATE_DRAFT',
        entityType: 'KNOWLEDGE',
        entityId: source.id,
        entityKey: source.key,
        actorId: actor.id,
        actorName: actor.name,
        after: revisionFields(revision),
        reason: params.reason,
        req,
      },
      tx
    )

    return { source, revision }
  })

  return {
    sourceId: result.source.id,
    revisionId: result.revision.id,
    version: result.revision.version,
    status: result.revision.status,
    title: result.revision.title,
  }
}

export type SaveDraftParams = {
  title?: string
  summary?: string | null
  body: unknown
  reason: string
}

/**
 * Writes the source's editable revision, creating a new one when the last is published.
 *
 * The version number only goes up, and only when a published revision is superseded. Editing a
 * draft repeatedly reuses its version — otherwise a source would reach v40 through nothing but
 * typo fixes, and the numbers an operator uses to talk about it would stop meaning anything.
 */
export async function saveKnowledgeDraft(
  sourceId: string,
  params: SaveDraftParams,
  actor: Actor,
  req?: Request
): Promise<RevisionResult> {
  const validated = validateKnowledgeBody(params.body)
  if (!validated.ok) throw new KnowledgeNotEditableError(validated.error)

  const source = await prisma.knowledgeSource.findUnique({ where: { id: sourceId } })
  if (!source) throw new KnowledgeNotFoundError()

  // The catalog mirror is written by the indexer from files on disk. Editing one here would be
  // overwritten by the next sync, so the edit would silently disappear — worse than refusing.
  if (source.type !== MANAGED_SOURCE_TYPE) {
    throw new KnowledgeNotEditableError(
      `Sumber ini dicerminkan dari ${source.sourcePath ?? 'catalog/'} dan hanya bisa diubah dengan mengedit filenya.`
    )
  }
  if (source.status === 'ARCHIVED') {
    throw new KnowledgeNotEditableError('Sumber ini sudah diarsipkan. Buat knowledge baru bila masih diperlukan.')
  }

  const latest = await prisma.knowledgeRevision.findFirst({
    where: { knowledgeSourceId: sourceId },
    orderBy: { version: 'desc' },
  })
  if (!latest) throw new KnowledgeNotFoundError('Sumber ini belum punya revisi sama sekali.')

  const editable = ALLOWED_FROM.DRAFT.includes(latest.status as RevisionStatus)
  const title = params.title ?? latest.title
  const summary = params.summary === undefined ? latest.summary : params.summary

  if (editable) {
    const updated = await prisma.knowledgeRevision.update({
      where: { id: latest.id },
      data: {
        title,
        summary,
        body: validated.body as unknown as Prisma.InputJsonValue,
        // Back to DRAFT even from APPROVED: see the note on ALLOWED_FROM.
        status: 'DRAFT',
        changeReason: params.reason,
        createdBy: actor.id,
        reviewedBy: null,
        reviewedAt: null,
      },
    })

    await writeBotAuditLog({
      action: 'UPDATE_DRAFT',
      entityType: 'KNOWLEDGE',
      entityId: sourceId,
      entityKey: source.key,
      actorId: actor.id,
      actorName: actor.name,
      before: revisionFields(latest),
      after: revisionFields(updated),
      reason: params.reason,
      req,
    })

    return { sourceId, revisionId: updated.id, version: updated.version, status: updated.status, title: updated.title }
  }

  // The latest revision is PUBLISHED or ARCHIVED, so it is history now. A change means a new
  // version, which is what keeps a release snapshot naming v3 describing what v3 actually was.
  const created = await prisma.knowledgeRevision.create({
    data: {
      knowledgeSourceId: sourceId,
      version: latest.version + 1,
      title,
      summary,
      body: validated.body as unknown as Prisma.InputJsonValue,
      status: 'DRAFT',
      changeReason: params.reason,
      createdBy: actor.id,
    },
  })

  await writeBotAuditLog({
    action: 'CREATE_DRAFT',
    entityType: 'KNOWLEDGE',
    entityId: sourceId,
    entityKey: source.key,
    actorId: actor.id,
    actorName: actor.name,
    before: revisionFields(latest),
    after: revisionFields(created),
    reason: params.reason,
    req,
  })

  return { sourceId, revisionId: created.id, version: created.version, status: created.status, title: created.title }
}

/** Moves the source's pending revision between review states. */
export async function transitionKnowledge(
  sourceId: string,
  transition: 'REVIEW' | 'APPROVE' | 'REJECT',
  actor: Actor,
  reason: string | null,
  req?: Request
): Promise<RevisionResult> {
  const source = await prisma.knowledgeSource.findUnique({ where: { id: sourceId } })
  if (!source) throw new KnowledgeNotFoundError()

  const latest = await prisma.knowledgeRevision.findFirst({
    where: { knowledgeSourceId: sourceId },
    orderBy: { version: 'desc' },
  })
  if (!latest) throw new KnowledgeNotFoundError('Sumber ini belum punya revisi sama sekali.')

  if (!ALLOWED_FROM[transition].includes(latest.status as RevisionStatus)) {
    throw new KnowledgeTransitionError(
      `Revisi v${latest.version} berstatus ${latest.status}; transisi ${transition} tidak diizinkan dari sana.`
    )
  }

  const nextStatus: RevisionStatus =
    transition === 'REVIEW' ? 'REVIEW' : transition === 'APPROVE' ? 'APPROVED' : 'REJECTED'

  const updated = await prisma.knowledgeRevision.update({
    where: { id: latest.id },
    data:
      transition === 'APPROVE'
        ? { status: nextStatus, reviewedBy: actor.id, reviewedAt: new Date() }
        : // A rejected revision is KEPT, unlike a rejected rule draft. Rules hold a handful of
          // settings that can be retyped in seconds; a knowledge revision is written prose, and
          // throwing away somebody's afternoon because a reviewer disagreed with one paragraph
          // is a good way to make nobody write knowledge again. It stays as history, and the
          // next edit supersedes it.
          { status: nextStatus, changeReason: reason ?? latest.changeReason },
  })

  const action: AuditAction =
    transition === 'REVIEW' ? 'REQUEST_REVIEW' : transition === 'APPROVE' ? 'APPROVE' : 'REJECT'

  await writeBotAuditLog({
    action,
    entityType: 'KNOWLEDGE',
    entityId: sourceId,
    entityKey: source.key,
    actorId: actor.id,
    actorName: actor.name,
    before: revisionFields(latest),
    after: revisionFields(updated),
    reason,
    req,
  })

  return { sourceId, revisionId: updated.id, version: updated.version, status: updated.status, title: updated.title }
}

/**
 * Archives a source. Nothing is deleted (SDD Manage Second §8.2).
 *
 * The revisions stay exactly as they are, including the published one, so a release snapshot
 * that names a version still resolves. What changes is that the runtime loader stops reading
 * it — archiving answers "stop using this", not "pretend it never existed".
 */
export async function archiveKnowledgeSource(
  sourceId: string,
  reason: string,
  actor: Actor,
  req?: Request
): Promise<{ sourceId: string; status: string }> {
  const source = await prisma.knowledgeSource.findUnique({ where: { id: sourceId } })
  if (!source) throw new KnowledgeNotFoundError()
  if (source.type !== MANAGED_SOURCE_TYPE) {
    throw new KnowledgeNotEditableError('Sumber katalog diarsipkan otomatis saat filenya hilang, bukan dari sini.')
  }
  if (source.status === 'ARCHIVED') {
    throw new KnowledgeTransitionError('Sumber ini sudah diarsipkan.')
  }

  const updated = await prisma.knowledgeSource.update({
    where: { id: sourceId },
    data: { status: 'ARCHIVED' },
  })

  await writeBotAuditLog({
    action: 'DISABLE',
    entityType: 'KNOWLEDGE',
    entityId: sourceId,
    entityKey: source.key,
    actorId: actor.id,
    actorName: actor.name,
    before: { status: source.status },
    after: { status: updated.status },
    reason,
    req,
  })

  return { sourceId, status: updated.status }
}
