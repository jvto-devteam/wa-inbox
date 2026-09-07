/**
 * Triage: what a human decided about one bot decision.
 *
 * --- Why this is separate from the decision it describes ---
 *
 * `BotDecisionRun` records what HAPPENED and must never change after it is written. Triage
 * records what somebody DECIDED about it, and that changes constantly — opened, assigned,
 * resolved. Keeping them in one row would mean every reassignment rewrites an audit record.
 *
 * --- Who may do what, and why the split is where it is ---
 *
 * An AGENT may open a triage and take it themselves. That is the whole point: the person who
 * notices the bot answering wrongly is the agent reading the conversation, and requiring an
 * admin to file it is how it never gets filed. What an AGENT may NOT do is assign work to
 * somebody else, or declare a problem resolved — both are claims about other people's time and
 * about whether a customer-facing defect still exists.
 */
import { prisma } from '@/lib/db'
import { writeBotAuditLog } from '@/lib/bot-control/audit'
import { CLOSED_TRIAGE_STATUSES, type TriageIssueType, type TriageStatus } from '@/lib/bot-control/triage-types'

// Re-exported so server-side callers can keep importing everything from one place; client
// components must import from `triage-types` directly — see that file's header for why.
export {
  TRIAGE_STATUSES,
  TRIAGE_ISSUE_TYPES,
  TRIAGE_SEVERITIES,
  type TriageStatus,
  type TriageIssueType,
} from '@/lib/bot-control/triage-types'

const CLOSED_STATUSES = CLOSED_TRIAGE_STATUSES

export class DecisionNotFoundError extends Error {
  constructor() {
    super('Keputusan tidak ditemukan.')
    this.name = 'DecisionNotFoundError'
  }
}

export class TriageForbiddenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TriageForbiddenError'
  }
}

export type TriageActor = { id: string; name: string | null; isAdmin: boolean }

export type TriageInput = {
  status?: TriageStatus
  issueType?: TriageIssueType | null
  severity?: string
  assignedTo?: string | null
  note?: string | null
  linkedEntityType?: string | null
  linkedEntityId?: string | null
}

export type TriageRecord = {
  id: string
  decisionRunId: string
  status: string
  issueType: string | null
  severity: string
  assignedTo: string | null
  note: string | null
  linkedEntityType: string | null
  linkedEntityId: string | null
  resolvedBy: string | null
  resolvedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** Audit-sized description. Never the whole row — see audit.ts. */
function triageFields(row: Pick<TriageRecord, 'status' | 'issueType' | 'severity' | 'assignedTo' | 'note'>) {
  return {
    status: row.status,
    issueType: row.issueType,
    severity: row.severity,
    assignedTo: row.assignedTo,
    note: row.note,
  }
}

/**
 * Applies the permission rules an AGENT is subject to.
 *
 * Assigning to somebody ELSE and closing a triage are both admin-only. Assigning to YOURSELF is
 * not: taking a piece of work is not a claim about anyone else.
 */
function assertAllowed(actor: TriageActor, input: TriageInput): void {
  if (actor.isAdmin) return

  if (input.assignedTo !== undefined && input.assignedTo !== null && input.assignedTo !== actor.id) {
    throw new TriageForbiddenError('Hanya admin yang bisa menugaskan ke orang lain.')
  }
  if (input.status && CLOSED_STATUSES.includes(input.status)) {
    throw new TriageForbiddenError('Hanya admin yang bisa menutup atau mengabaikan tindak lanjut.')
  }
}

/**
 * Derives the status when the caller did not state one.
 *
 * Assigning something implies it is being worked on, so an untouched OPEN row becomes ASSIGNED
 * — otherwise every operator has to remember two clicks to express one intention, and the
 * status column drifts away from what the assignment column says.
 */
function deriveStatus(input: TriageInput, current: string | null): string {
  if (input.status) return input.status
  if (input.assignedTo) return 'ASSIGNED'
  return current ?? 'OPEN'
}

/**
 * Creates the triage for a decision, or updates the one that exists.
 *
 * `decisionRunId` is unique, so this is an upsert by construction: two triages for one decision
 * would make "has this been dealt with?" unanswerable, which is the only thing the list is for.
 */
export async function upsertTriage(
  decisionRunId: string,
  input: TriageInput,
  actor: TriageActor,
  req?: Request
): Promise<TriageRecord> {
  assertAllowed(actor, input)

  const run = await prisma.botDecisionRun.findUnique({ where: { id: decisionRunId }, select: { id: true } })
  if (!run) throw new DecisionNotFoundError()

  const existing = await prisma.botDecisionTriage.findUnique({ where: { decisionRunId } })
  const status = deriveStatus(input, existing?.status ?? null)
  const closing = CLOSED_STATUSES.includes(status as TriageStatus)

  const data = {
    status,
    issueType: input.issueType !== undefined ? input.issueType : (existing?.issueType ?? null),
    severity: input.severity ?? existing?.severity ?? 'NORMAL',
    assignedTo: input.assignedTo !== undefined ? input.assignedTo : (existing?.assignedTo ?? null),
    note: input.note !== undefined ? input.note : (existing?.note ?? null),
    linkedEntityType: input.linkedEntityType !== undefined ? input.linkedEntityType : (existing?.linkedEntityType ?? null),
    linkedEntityId: input.linkedEntityId !== undefined ? input.linkedEntityId : (existing?.linkedEntityId ?? null),
    // Stamped on the transition into a closed state, and CLEARED on the way back out. A row
    // that says "resolved by Budi" while sitting at OPEN is a row nobody can read.
    resolvedBy: closing ? (existing?.resolvedBy ?? actor.id) : null,
    resolvedAt: closing ? (existing?.resolvedAt ?? new Date()) : null,
  }

  const saved = existing
    ? await prisma.botDecisionTriage.update({ where: { decisionRunId }, data })
    : await prisma.botDecisionTriage.create({ data: { decisionRunId, ...data } })

  await writeBotAuditLog({
    action: existing ? 'UPDATE_DRAFT' : 'CREATE_DRAFT',
    entityType: 'DECISION_TRIAGE',
    entityId: saved.id,
    entityKey: `decision:${decisionRunId}`,
    actorId: actor.id,
    actorName: actor.name,
    before: existing ? triageFields(existing) : null,
    after: triageFields(saved),
    reason: input.note ?? null,
    req,
  })

  return saved
}
