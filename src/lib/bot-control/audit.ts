/**
 * The Bot Control audit trail: who changed what, when, and why.
 *
 * Every entity in this phase carries an `updatedBy` of its own, and that is exactly the gap
 * this fills. `updatedBy` records the LAST writer and nothing else — the change before it is
 * gone, and the change before it is precisely what somebody goes looking for when the bot
 * starts answering wrongly on a Tuesday and nobody remembers what shipped on Monday.
 *
 * --- Why the diff is narrowed, and why it is sanitized ---
 *
 * `before`/`after` hold ONLY the fields that actually changed. Storing whole objects would make
 * every audit row a second copy of the full configuration, and sooner or later a second copy of
 * a token along with it. On top of that, both sides go through `sanitizeTrace`, the same
 * redactor the decision recorder uses: it strips secret-looking keys AND secrets embedded in
 * string values, at WRITE time. Redacting at render time instead would mean the secret is
 * already in the database and merely hidden by whichever component happens to draw it.
 *
 * --- Failure behaviour, and why it depends on the caller ---
 *
 * Called standalone, a failed audit write is logged and swallowed: losing the record of a
 * successful action is bad, but undoing the action itself because its footnote failed is worse.
 *
 * Called with a transaction client, it rethrows. A publish that records no audit row is not a
 * publish this system is willing to have happened, and the caller passing `tx` is asking for
 * exactly that all-or-nothing guarantee (SDD Manage Second §11).
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { sanitizeTrace, type JsonLike } from '@/lib/bot-control/trace-sanitizer'

/** SDD Manage Second §7.1. */
export const AUDIT_ACTIONS = [
  'CREATE_DRAFT',
  'UPDATE_DRAFT',
  'REQUEST_REVIEW',
  'APPROVE',
  'REJECT',
  'PUBLISH',
  'ROLLBACK',
  'ENABLE',
  'DISABLE',
  'RUN_TEST',
  'OVERRIDE_TEST_FAILURE',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

/** A plain record of field values — what an entity looked like at one moment. */
export type AuditFields = Record<string, unknown>

export type WriteAuditParams = {
  action: AuditAction
  /** What kind of thing changed: 'RULE', 'KNOWLEDGE', 'FLOW', 'CHANNEL_POLICY', 'RELEASE'. */
  entityType: string
  entityId?: string | null
  /** The human-readable key where one exists, e.g. a rule's `channel.unofficial_outbound_default`. */
  entityKey?: string | null
  actorId?: string | null
  actorName?: string | null
  before?: AuditFields | null
  after?: AuditFields | null
  reason?: string | null
  releaseId?: string | null
  /** The originating request, read only for its IP and user-agent headers. */
  req?: Request | null
}

/**
 * Prisma client or transaction client. `$transaction`'s callback argument has no `$transaction`
 * method of its own, which is what makes the two distinguishable at the type level.
 */
export type AuditWriter = Prisma.TransactionClient | typeof prisma

/**
 * Reduces a before/after pair to the fields that actually differ.
 *
 * Comparison is by serialised value, so a nested config object counts as changed only when its
 * contents changed — not merely because a new object identity was constructed on the way in.
 * A key present on one side and absent on the other is a change; its missing side is recorded
 * as `null` rather than dropped, because "this field did not exist before" is information.
 */
export function diffAuditFields(
  before: AuditFields | null | undefined,
  after: AuditFields | null | undefined
): { before: AuditFields; after: AuditFields } {
  const from = before ?? {}
  const to = after ?? {}
  const changedBefore: AuditFields = {}
  const changedAfter: AuditFields = {}

  for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
    if (stableStringify(from[key]) === stableStringify(to[key])) continue
    changedBefore[key] = key in from ? from[key] : null
    changedAfter[key] = key in to ? to[key] : null
  }

  return { before: changedBefore, after: changedAfter }
}

/**
 * JSON with object keys sorted, so `{a:1,b:2}` and `{b:2,a:1}` compare equal.
 *
 * Without the sort, a config rebuilt in a different key order would be reported as a change on
 * every save, and an audit log full of no-op entries is an audit log nobody reads.
 */
function stableStringify(value: unknown): string {
  if (value === undefined) return '__undefined__'
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) return inner
    const record = inner as Record<string, unknown>
    return Object.fromEntries(Object.keys(record).sort().map((k) => [k, record[k]]))
  })
}

/** Never store an empty `{}`: a diff with no changed fields is better recorded as absent. */
function orNull(fields: AuditFields): Prisma.InputJsonValue | undefined {
  if (Object.keys(fields).length === 0) return undefined
  return sanitizeTrace(fields) as Prisma.InputJsonValue
}

/**
 * Writes one audit row. Returns its id, or null when a standalone write failed.
 *
 * `client` defaults to the shared Prisma client. Pass a transaction client to make the audit
 * row part of a larger all-or-nothing operation — see the note at the top of this file.
 */
export async function writeBotAuditLog(
  params: WriteAuditParams,
  client: AuditWriter = prisma
): Promise<string | null> {
  const { before, after } = diffAuditFields(params.before, params.after)

  try {
    const row = await client.botControlAuditLog.create({
      data: {
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        entityKey: params.entityKey ?? null,
        actorId: params.actorId ?? null,
        actorName: params.actorName ?? null,
        before: orNull(before),
        after: orNull(after),
        reason: params.reason ?? null,
        releaseId: params.releaseId ?? null,
        // Behind a proxy the socket address is the proxy's, so the forwarded header is the
        // only thing that names the actual operator. Its first hop is the client.
        ipAddress: readIpAddress(params.req),
        userAgent: params.req?.headers.get('user-agent')?.slice(0, USER_AGENT_MAX) ?? null,
      },
      select: { id: true },
    })
    return row.id
  } catch (error) {
    // Inside a transaction the caller wants all-or-nothing, so the failure must propagate and
    // take the whole operation down with it.
    if (client !== prisma) throw error
    console.error('writeBotAuditLog gagal', { action: params.action, entityType: params.entityType, error })
    return null
  }
}

const USER_AGENT_MAX = 500

function readIpAddress(req: Request | null | undefined): string | null {
  if (!req) return null
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() || null
  return req.headers.get('x-real-ip')
}

/** Shape returned to the Audit Logs UI. The Json columns stay opaque; the page renders them. */
export type AuditLogRow = {
  id: string
  actorId: string | null
  actorName: string | null
  action: string
  entityType: string
  entityId: string | null
  entityKey: string | null
  before: JsonLike | null
  after: JsonLike | null
  reason: string | null
  releaseId: string | null
  createdAt: string
}
