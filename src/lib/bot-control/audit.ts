/**
 * The Bot Control history: who changed what the bot does, when, and why.
 *
 * --- Why this is a history and not a diff ---
 *
 * This used to store `before`/`after` for every change. That pair answers "prove to a third
 * party which of you changed this" — a multi-tenant SaaS question. wa-inbox is one business
 * with one small team where nobody can hold a role other than ADMIN or AGENT, so the writer and
 * the approver are always the same person and there is no third party to prove anything to.
 * The value that matters now lives on the entity itself (Settings, KnowledgeRevision), and the
 * question this table is actually opened for is narrower: when did I last turn this on, and why.
 *
 * The operator's network address and browser string left for the same reason. They were never
 * returned by the API and never rendered; all they did was keep a permanent record of
 * colleagues' locations and devices.
 *
 * --- Why `reason` is still sanitized ---
 *
 * `reason` is FREE TEXT typed by an operator during an incident, and an incident is exactly when
 * somebody pastes the thing that broke: "jeda META, token EAAG… ditolak". Dropping the diff
 * removed the structured places a secret could hide, not the unstructured one. So every stored
 * string still goes through `sanitizeTrace` — at WRITE time, so a secret never lands in the
 * database rather than merely being hidden by whichever component happens to draw it.
 *
 * --- What gets written here at all ---
 *
 * Only changes to what the bot DOES: activating or archiving knowledge, the global switches on
 * /chatbot, the outbound safety thresholds, pausing a provider, cancelling a queued message.
 * Drafts, flags and other work-in-progress are not written: a draft nobody published changed
 * nothing for a customer, and the draft row already records its own author and reason.
 *
 * --- Failure behaviour, and why it depends on the caller ---
 *
 * Called standalone, a failed audit write is logged and swallowed: losing the record of a
 * successful action is bad, but undoing the action itself because its footnote failed is worse.
 *
 * Called with a transaction client, it rethrows. An activation that records no audit row is not
 * an activation this system is willing to have happened, and the caller passing `tx` is asking
 * for exactly that all-or-nothing guarantee.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { sanitizeTrace } from '@/lib/bot-control/trace-sanitizer'

/** The four verbs left, one per kind of change the bot's behaviour can undergo. */
export const AUDIT_ACTIONS = ['UPDATE', 'PUBLISH', 'ENABLE', 'DISABLE'] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export type WriteAuditParams = {
  action: AuditAction
  /** What kind of thing changed: 'KNOWLEDGE', 'BOT_SETTING', 'OUTBOUND_PROVIDER', 'OUTBOUND_JOB'. */
  entityType: string
  entityId?: string | null
  /** The human-readable key where one exists, e.g. a provider's `META` or a source's key. */
  entityKey?: string | null
  actorId?: string | null
  actorName?: string | null
  reason?: string | null
}

/**
 * Prisma client or transaction client. `$transaction`'s callback argument has no `$transaction`
 * method of its own, which is what makes the two distinguishable at the type level.
 */
export type AuditWriter = Prisma.TransactionClient | typeof prisma

/**
 * Redacts and length-caps one stored string.
 *
 * `sanitizeTrace` returns a `JsonLike`; handed a string it returns a string, and the cast is
 * narrowing that fact rather than assuming it — a non-string can only come back if a non-string
 * went in, and the only call sites pass `string`.
 */
function clean(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  return sanitizeTrace(trimmed) as string
}

/**
 * Writes one history row. Returns its id, or null when a standalone write failed.
 *
 * `client` defaults to the shared Prisma client. Pass a transaction client to make the row part
 * of a larger all-or-nothing operation — see the note at the top of this file.
 */
export async function writeBotAuditLog(
  params: WriteAuditParams,
  client: AuditWriter = prisma
): Promise<string | null> {
  try {
    const row = await client.botControlAuditLog.create({
      data: {
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        // Sanitized as well as `reason`: today every key is machine-generated, but the column
        // is documented as "the human-readable key" and a future caller putting operator text
        // in it must not be the moment redaction stops happening.
        entityKey: clean(params.entityKey),
        actorId: params.actorId ?? null,
        actorName: params.actorName ?? null,
        reason: clean(params.reason),
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

/**
 * How long a history row is kept.
 *
 * A year, because the question this table answers is seasonal — "what did we change before last
 * dry season" — and because nothing here is a legal record anybody is required to retain. The
 * table had no retention at all before, which is not a policy of keeping everything forever so
 * much as never having chosen one; a row from 2031 answers nothing and is still being paged
 * through by every query that scans this table.
 */
export const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000

export type PruneResult = { deleted: number }

/**
 * Deletes history rows older than a year. Returns how many went.
 *
 * Idempotent: it deletes by age, so a second run in the same minute finds nothing left to
 * delete and returns 0. Concurrent runs are safe for the same reason — the losing DELETE simply
 * matches no rows.
 *
 * NEVER throws. This is housekeeping riding along on somebody else's job (the outbound cron
 * tick), and the same rule `recoverStuckOutboundJobs` follows applies here with more force: an
 * un-pruned audit table is untidy, an outbound queue that stopped draining because tidying
 * failed is customers not getting their messages.
 */
export async function pruneBotAuditLogs(now: Date = new Date()): Promise<PruneResult> {
  const cutoff = new Date(now.getTime() - AUDIT_RETENTION_MS)

  try {
    // Indexed on `createdAt`, so the common case (nothing old enough) is a cheap index probe
    // rather than a scan — which is what makes running this on every tick affordable.
    const { count } = await prisma.botControlAuditLog.deleteMany({ where: { createdAt: { lt: cutoff } } })
    if (count > 0) console.info('pruneBotAuditLogs: menghapus riwayat lama', { deleted: count, cutoff })
    return { deleted: count }
  } catch (error) {
    console.error('pruneBotAuditLogs gagal', { error })
    return { deleted: 0 }
  }
}
