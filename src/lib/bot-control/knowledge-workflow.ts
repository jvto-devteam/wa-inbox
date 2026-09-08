/**
 * Creating managed knowledge, saving it as a draft, and activating it.
 *
 * --- Two states, because there are not two people ---
 *
 * This used to be a six-state workflow: DRAFT → REVIEW → APPROVED → PUBLISHED, plus REJECTED
 * and a release to actually ship it. The separation of duties that shape existed to enforce
 * never existed here: wa-inbox runs one business with one small team, and the person who
 * writes a fact is the person who decides it is true. Every "approval" was somebody approving
 * their own paragraph, one click after writing it, and the only thing the ceremony reliably
 * produced was knowledge sitting unpublished because the author did not realise there were
 * three more buttons.
 *
 * What is left is what an operator actually does: write it down (`saveKnowledgeDraft`), and
 * turn it on (`publishKnowledgeRevision`).
 *
 * --- Managed knowledge sits BESIDE the catalog, never on top of it ---
 *
 * `KnowledgeSource` used to also hold one row per `catalog/*.json` file, written by an indexer
 * that overwrote them on every sync. That mirror is gone — the bot always read the files
 * themselves, so the copy served nobody — and with it the only code in the repo that could
 * ever have overwritten an operator's row, which CLAUDE.md forbids absolutely.
 *
 * Everything here still creates and edits rows with `type='MANUAL'` ONLY, and every mutation
 * still refuses a row of any other type. That guard is now belt-and-braces rather than
 * load-bearing, and it stays exactly for that reason: it is what makes reintroducing a
 * filesystem-driven writer fail loudly instead of silently eating somebody's paragraph. The
 * two bodies of knowledge are merged at read time (src/lib/bot/managed-knowledge.ts), never in
 * the table.
 *
 * --- Why a published revision is immutable ---
 *
 * Editing a PUBLISHED revision would change the past. The history panel showing version 3
 * would then describe content different from what the bot actually used while v3 was live, and
 * the trail would be quietly wrong precisely where somebody is relying on it. Every change
 * therefore creates a NEW revision, and the version number goes up.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { writeBotAuditLog } from '@/lib/bot-control/audit'
import { validateKnowledgeBody } from '@/lib/bot-control/knowledge-body'
import { invalidateManagedKnowledgeCache } from '@/lib/bot/managed-knowledge'

/**
 * The states a revision can be in.
 *
 * Only two of them are chosen by anybody: DRAFT (written, not live) and PUBLISHED (what the bot
 * reads). ARCHIVED is written by the system alone, to the revision a newer one just replaced.
 *
 * That third value is not ceremony, it is a runtime requirement: the loader in
 * `src/lib/bot/managed-knowledge.ts` selects every row with `status='PUBLISHED'` and does not
 * deduplicate by source, so leaving v3 published while v4 goes live would feed the bot both
 * the old answer and the new one. Demoting v3 to DRAFT instead would be worse — the history
 * panel would then claim a version that answered customers for a month was never live.
 */
export const REVISION_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const
export type RevisionStatus = (typeof REVISION_STATUSES)[number]

/** The only source type this module ever creates or edits. */
export const MANAGED_SOURCE_TYPE = 'MANUAL'

/**
 * Lifecycle values on the SOURCE, reusing its existing `status` column.
 *
 * ARCHIVED stays: retiring a body of knowledge that no longer applies is a real operation with
 * a real answer ("stop using this"), and has nothing to do with the review flow that left.
 */
export const SOURCE_LIFECYCLES = ['PUBLISHED', 'DRAFT', 'ARCHIVED'] as const

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

/** A key nothing else mints, kept path-shaped so old `managed/...` keys still read the same. */
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
export async function createManagedKnowledge(params: CreateSourceParams, actor: Actor): Promise<RevisionResult> {
  const validated = validateKnowledgeBody(params.body)
  if (!validated.ok) throw new KnowledgeNotEditableError(validated.error)

  const result = await prisma.$transaction(async (tx) => {
    const source = await tx.knowledgeSource.create({
      data: {
        key: managedKey(),
        title: params.title,
        // Always MANUAL. Every guard in this module that protects operator-written knowledge
        // is keyed on this value, so a row created with anything else would be unprotected.
        type: MANAGED_SOURCE_TYPE,
        // The SOURCE is a draft until its first revision is activated. Listing it as PUBLISHED
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

    // No audit row: a draft is not knowledge the bot reads. The revision itself already
    // records `createdBy` and `changeReason`, and the history entry is written when somebody
    // ACTIVATES it — which is the moment a customer can notice.
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
 * Writes the source's editable revision, creating a new one when the last is already live.
 *
 * The version number only goes up, and only when a published revision is superseded. Editing a
 * draft repeatedly reuses its version — otherwise a source would reach v40 through nothing but
 * typo fixes, and the numbers an operator uses to talk about it would stop meaning anything.
 */
export async function saveKnowledgeDraft(
  sourceId: string,
  params: SaveDraftParams,
  actor: Actor
): Promise<RevisionResult> {
  const validated = validateKnowledgeBody(params.body)
  if (!validated.ok) throw new KnowledgeNotEditableError(validated.error)

  const source = await prisma.knowledgeSource.findUnique({ where: { id: sourceId } })
  if (!source) throw new KnowledgeNotFoundError()

  // Only operator-written knowledge is editable here. Anything else came from somewhere this
  // form does not own, and writing to it would put the edit somewhere its own source overwrites.
  if (source.type !== MANAGED_SOURCE_TYPE) {
    throw new KnowledgeNotEditableError(
      `Sumber ini bertipe ${source.type} dan tidak dikelola dari halaman ini; ubah di sumber aslinya.`
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

  const title = params.title ?? latest.title
  const summary = params.summary === undefined ? latest.summary : params.summary

  // A DRAFT is the only thing that can be written over. Everything else is history.
  if (latest.status === 'DRAFT') {
    const updated = await prisma.knowledgeRevision.update({
      where: { id: latest.id },
      data: {
        title,
        summary,
        body: validated.body as unknown as Prisma.InputJsonValue,
        changeReason: params.reason,
        createdBy: actor.id,
      },
    })

    return { sourceId, revisionId: updated.id, version: updated.version, status: updated.status, title: updated.title }
  }

  // The latest revision is PUBLISHED or ARCHIVED, so it is history now. A change means a new
  // version, which is what keeps "what did the bot know in August" answerable.
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

  return { sourceId, revisionId: created.id, version: created.version, status: created.status, title: created.title }
}

/**
 * Turns the source's draft revision into the one the bot reads. The other half of the feature.
 *
 * One transaction, because three writes are meaningless apart: the previously live revision
 * stepping aside, the draft becoming live, and the source itself leaving DRAFT. A crash between
 * the first two would leave a source with NO published revision — knowledge that silently
 * stopped answering.
 *
 * `publishedBy` and `publishedAt` are kept from the old workflow. "Who turned this on, and
 * when" survives the removal of reviewer and approver because it is the question that actually
 * gets asked when the bot starts saying something new.
 */
export async function publishKnowledgeRevision(
  sourceId: string,
  actor: Actor,
  reason: string | null
): Promise<RevisionResult> {
  const source = await prisma.knowledgeSource.findUnique({ where: { id: sourceId } })
  if (!source) throw new KnowledgeNotFoundError()

  // Only operator-written knowledge has revisions to activate.
  if (source.type !== MANAGED_SOURCE_TYPE) {
    throw new KnowledgeNotEditableError(
      `Sumber ini bertipe ${source.type} dan tidak punya revisi untuk diaktifkan.`
    )
  }
  if (source.status === 'ARCHIVED') {
    throw new KnowledgeTransitionError('Sumber ini sudah diarsipkan. Buat knowledge baru bila masih diperlukan.')
  }

  const latest = await prisma.knowledgeRevision.findFirst({
    where: { knowledgeSourceId: sourceId },
    orderBy: { version: 'desc' },
  })
  if (!latest) throw new KnowledgeNotFoundError('Sumber ini belum punya revisi sama sekali.')
  if (latest.status !== 'DRAFT') {
    throw new KnowledgeTransitionError(`Revisi v${latest.version} berstatus ${latest.status}; tidak ada draft untuk diaktifkan.`)
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Whatever this source had live steps aside FIRST. Two PUBLISHED revisions on one source
    // would make "what is the bot reading" unanswerable, and the loader would feed it both.
    await tx.knowledgeRevision.updateMany({
      where: { knowledgeSourceId: sourceId, status: 'PUBLISHED' },
      data: { status: 'ARCHIVED' },
    })

    const published = await tx.knowledgeRevision.update({
      where: { id: latest.id },
      data: { status: 'PUBLISHED', publishedBy: actor.id, publishedAt: new Date() },
    })

    // The source's own row follows the revision that is now live. Its title and summary are
    // what the list and the explorer show, and they would otherwise still describe v1.
    //
    // This writes a MANUAL source — the row CLAUDE.md forbids anything else to overwrite.
    // Nothing else writes KnowledgeSource at all any more: the catalog reader
    // (src/lib/bot-control/catalog-explorer.ts) does not import prisma, and its own test
    // asserts that.
    await tx.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: 'PUBLISHED', title: published.title, summary: published.summary },
    })

    // The history entry rides inside the transaction: an activation that recorded nothing is
    // not an activation this system is willing to have happened.
    await writeBotAuditLog(
      {
        action: 'PUBLISH',
        entityType: 'KNOWLEDGE',
        entityId: sourceId,
        entityKey: source.key,
        actorId: actor.id,
        actorName: actor.name,
        reason,
      },
      tx
    )

    return published
  })

  // The runtime reads managed knowledge through a 30-second cache. Dropping it here is what
  // makes "Aktifkan" take effect while the operator is still looking at the screen — without
  // it, a change that appears not to have worked gets typed in again.
  invalidateManagedKnowledgeCache()

  return {
    sourceId,
    revisionId: updated.id,
    version: updated.version,
    status: updated.status,
    title: updated.title,
  }
}

/**
 * Archives a source. Nothing is deleted (SDD Manage Second §8.2).
 *
 * The revisions stay exactly as they are, including the published one, so the history still
 * reads. What changes is that the runtime loader stops reading it — archiving answers "stop
 * using this", not "pretend it never existed".
 */
export async function archiveKnowledgeSource(
  sourceId: string,
  reason: string,
  actor: Actor
): Promise<{ sourceId: string; status: string }> {
  const source = await prisma.knowledgeSource.findUnique({ where: { id: sourceId } })
  if (!source) throw new KnowledgeNotFoundError()
  if (source.type !== MANAGED_SOURCE_TYPE) {
    throw new KnowledgeNotEditableError(`Sumber bertipe ${source.type} tidak diarsipkan dari sini.`)
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
    reason,
  })

  // Archiving takes knowledge AWAY from the bot; the same cache stands between that decision
  // and the next customer turn.
  invalidateManagedKnowledgeCache()

  return { sourceId, status: updated.status }
}
