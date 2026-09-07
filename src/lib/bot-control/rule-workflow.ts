/**
 * The draft → review → approve → publish lifecycle for one rule.
 *
 * --- Why the transitions are a table ---
 *
 * The interesting property of this workflow is not any single step; it is which steps are
 * REFUSED. Approving something nobody sent to review, re-reviewing an approved change, or
 * editing a draft that is already queued for publish all have to fail, and they have to fail
 * for a reason a human can read. Spelling the legal transitions out once means each route only
 * has to say which transition it is attempting.
 *
 * --- Why a draft never touches the live columns ---
 *
 * `draftConfig`/`draftEnabled` sit next to `config`/`enabled`, never on top of them. That makes
 * "a draft has not changed the bot's behaviour" a property of the data rather than something
 * every reader has to remember, and it makes reject a matter of clearing three columns instead
 * of restoring a value from somewhere.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { writeBotAuditLog, type AuditAction } from '@/lib/bot-control/audit'
import { validateRuleDraft } from '@/lib/bot-control/rule-config'

export const RULE_STATUSES = ['PUBLISHED', 'DRAFT', 'REVIEW', 'APPROVED', 'REJECTED'] as const
export type RuleStatus = (typeof RULE_STATUSES)[number]

/**
 * Which statuses each transition may start from.
 *
 * A draft may be re-edited while it is DRAFT, REVIEW or APPROVED — an approver who spots a typo
 * should not have to reject and start over. Re-editing an APPROVED draft deliberately sends it
 * back to DRAFT (see `saveRuleDraft`): approval attaches to a specific set of values, and
 * silently carrying it over to different ones is how an unreviewed change gets published.
 */
const ALLOWED_FROM: Record<'DRAFT' | 'REVIEW' | 'APPROVE' | 'REJECT', readonly RuleStatus[]> = {
  DRAFT: ['PUBLISHED', 'DRAFT', 'REVIEW', 'APPROVED', 'REJECTED'],
  REVIEW: ['DRAFT', 'REJECTED'],
  APPROVE: ['REVIEW'],
  REJECT: ['DRAFT', 'REVIEW', 'APPROVED'],
}

export class RuleNotFoundError extends Error {
  constructor(key: string) {
    super(`Rule ${key} tidak ditemukan. Jalankan seed rule terlebih dahulu.`)
    this.name = 'RuleNotFoundError'
  }
}

export class RuleTransitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuleTransitionError'
  }
}

export class RuleNotEditableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuleNotEditableError'
  }
}

export type Actor = { id: string; name: string | null }

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** The fields an audit diff should compare for a rule. Never the whole row. */
function draftFields(row: { draftEnabled: boolean | null; draftConfig: unknown; status: string }) {
  return { status: row.status, draftEnabled: row.draftEnabled, draftConfig: asRecord(row.draftConfig) }
}

export type RuleWorkflowResult = {
  key: string
  status: string
  draftEnabled: boolean | null
  draftConfig: Record<string, unknown> | null
}

/**
 * Creates or updates a rule's draft.
 *
 * Validation runs against the REGISTRY, not the stored row — see rule-config.ts. A stored row
 * that could raise its own `editable` would turn this table into a way to unlock exactly the
 * rules that were deliberately locked.
 */
export async function saveRuleDraft(
  key: string,
  input: { enabled: boolean; config?: Record<string, unknown>; reason: string },
  actor: Actor,
  req?: Request
): Promise<RuleWorkflowResult> {
  const existing = await prisma.botRuleSetting.findUnique({ where: { key } })
  if (!existing) throw new RuleNotFoundError(key)

  const validated = validateRuleDraft(key, { enabled: input.enabled, config: input.config })
  if (!validated.ok) throw new RuleNotEditableError(validated.error)

  if (!ALLOWED_FROM.DRAFT.includes(existing.status as RuleStatus)) {
    throw new RuleTransitionError(`Rule ${key} sedang berstatus ${existing.status} dan tidak bisa diubah.`)
  }

  const updated = await prisma.botRuleSetting.update({
    where: { key },
    data: {
      // Back to DRAFT even from APPROVED: an approval was given for particular values, and
      // carrying it across to different ones publishes something nobody reviewed.
      status: 'DRAFT',
      draftEnabled: validated.enabled,
      draftConfig: validated.config as Prisma.InputJsonValue,
      draftUpdatedBy: actor.id,
      draftUpdatedAt: new Date(),
    },
  })

  await writeBotAuditLog({
    action: existing.draftUpdatedAt ? 'UPDATE_DRAFT' : 'CREATE_DRAFT',
    entityType: 'RULE',
    entityId: existing.id,
    entityKey: key,
    actorId: actor.id,
    actorName: actor.name,
    before: draftFields(existing),
    after: draftFields(updated),
    reason: input.reason,
    req,
  })

  return {
    key,
    status: updated.status,
    draftEnabled: updated.draftEnabled,
    draftConfig: asRecord(updated.draftConfig),
  }
}

/** Moves a draft between review states. One function because the shape is identical. */
export async function transitionRule(
  key: string,
  transition: 'REVIEW' | 'APPROVE' | 'REJECT',
  actor: Actor,
  reason: string | null,
  req?: Request
): Promise<RuleWorkflowResult> {
  const existing = await prisma.botRuleSetting.findUnique({ where: { key } })
  if (!existing) throw new RuleNotFoundError(key)

  if (!ALLOWED_FROM[transition].includes(existing.status as RuleStatus)) {
    throw new RuleTransitionError(
      `Rule ${key} berstatus ${existing.status}; transisi ${transition} tidak diizinkan dari sana.`
    )
  }

  // Nothing to review or approve without one. Letting an empty draft through would publish the
  // values already live, as though a change had been made.
  if (transition !== 'REJECT' && existing.draftUpdatedAt === null) {
    throw new RuleTransitionError(`Rule ${key} belum punya draft.`)
  }

  const nextStatus: RuleStatus =
    transition === 'REVIEW' ? 'REVIEW' : transition === 'APPROVE' ? 'APPROVED' : 'REJECTED'

  const updated = await prisma.botRuleSetting.update({
    where: { key },
    data:
      transition === 'REJECT'
        ? // Reject discards the draft outright. Keeping a rejected draft around invites
          // somebody to approve it later without re-reading why it was rejected.
          { status: 'REJECTED', draftEnabled: null, draftConfig: Prisma.DbNull, draftUpdatedAt: null, draftUpdatedBy: null }
        : { status: nextStatus },
  })

  const action: AuditAction =
    transition === 'REVIEW' ? 'REQUEST_REVIEW' : transition === 'APPROVE' ? 'APPROVE' : 'REJECT'

  await writeBotAuditLog({
    action,
    entityType: 'RULE',
    entityId: existing.id,
    entityKey: key,
    actorId: actor.id,
    actorName: actor.name,
    before: draftFields(existing),
    after: draftFields(updated),
    reason,
    req,
  })

  return {
    key,
    status: updated.status,
    draftEnabled: updated.draftEnabled,
    draftConfig: asRecord(updated.draftConfig),
  }
}
