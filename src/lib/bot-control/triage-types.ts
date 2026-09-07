/**
 * Triage vocabulary, with no runtime dependencies.
 *
 * Split out of `triage.ts` because the Decision Logs page and `TriagePanel` need these lists to
 * render dropdowns, and `triage.ts` imports Prisma. Importing it from a client component pulled
 * `@prisma/adapter-pg` and the whole `pg` driver into the BROWSER bundle — Node built-ins and
 * all — which Next reports as a client/server boundary warning and which ships hundreds of
 * kilobytes nobody can use.
 *
 * So the shared vocabulary lives here, where both sides can read it, and the database work
 * stays in triage.ts where only the server goes.
 */

export const TRIAGE_STATUSES = ['OPEN', 'ASSIGNED', 'RESOLVED', 'IGNORED'] as const
export type TriageStatus = (typeof TRIAGE_STATUSES)[number]

/** SDD Manage Second §7.10. */
export const TRIAGE_ISSUE_TYPES = [
  'KNOWLEDGE_GAP',
  'WRONG_FLOW',
  'BAD_REPLY',
  'HALLUCINATION_BLOCKED',
  'UNNECESSARY_HANDOFF',
  'MISSED_HANDOFF',
  'PROVIDER_FAILURE',
  'OTHER',
] as const
export type TriageIssueType = (typeof TRIAGE_ISSUE_TYPES)[number]

export const TRIAGE_SEVERITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const

/** Statuses that mean the work is finished, one way or the other. */
export const CLOSED_TRIAGE_STATUSES: readonly TriageStatus[] = ['RESOLVED', 'IGNORED']
