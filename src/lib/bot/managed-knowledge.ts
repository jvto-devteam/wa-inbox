/**
 * Knowledge the operator wrote, made available to the bot alongside the catalog.
 *
 * --- This ADDS to the catalog, it does not replace it ---
 *
 * `catalog/*.json` remains what it has always been: read straight off disk by the bot's own
 * code paths, unchanged by this phase. Nothing here rewrites, shadows, or reorders it. Managed
 * knowledge is a second, smaller pile of facts that an operator can add without a deploy, and
 * the merge happens at READ time in whoever calls this — never in the tables, and never by
 * having one overwrite the other.
 *
 * The direction matters. A managed entry that could override the catalog would let a web form
 * silently contradict the released package data, and the contradiction would be invisible:
 * both would be "the knowledge", with no way to see which one answered. Keeping them separate
 * and labelled is what makes `knowledgeRefs` in a decision trace able to say WHICH source a
 * given answer came from.
 *
 * --- Fail open, quietly ---
 *
 * A failure here returns an empty list, logged. The bot has always run on the catalog alone;
 * losing the managed additions degrades an answer, whereas throwing would end the turn. This
 * is the same reasoning as runtime-rules.ts, and the same short cache for the same reason —
 * this is read inside a bot turn, and a turn already spends its budget on LLM calls.
 */
import { prisma } from '@/lib/db'
import { getCandidateVersions } from '@/lib/bot-control/candidate-context'
import { readKnowledgeBody, type KnowledgeItem } from '@/lib/bot-control/knowledge-body'

/** Long enough to be worth having, short enough that a publish shows up while an operator watches. */
export const MANAGED_KNOWLEDGE_CACHE_TTL_MS = 30_000

/** Where a fact the bot used came from. Written into `knowledgeRefs` on every decision run. */
export type KnowledgeSourceType = 'CATALOG' | 'MANAGED'

export type ManagedKnowledgeEntry = {
  sourceId: string
  sourceKey: string
  sourceTitle: string
  revisionId: string
  version: number
  items: KnowledgeItem[]
}

export type ManagedKnowledge = {
  entries: ManagedKnowledgeEntry[]
  /** False when the read failed and the bot is running on the catalog alone. */
  available: boolean
  loadedAt: number
}

type CacheEntry = { value: ManagedKnowledge; expiresAt: number }
let cache: CacheEntry | null = null

/** Drops the cache. Called after a publish so an operator sees their change take effect. */
export function invalidateManagedKnowledgeCache(): void {
  cache = null
}

const EMPTY: ManagedKnowledge = { entries: [], available: true, loadedAt: 0 }

/**
 * Every published managed revision whose source is still active.
 *
 * Both filters are load-bearing. `status: 'PUBLISHED'` on the revision keeps drafts out of the
 * bot's mouth; excluding an ARCHIVED source is what makes "stop using this" actually stop it,
 * since archiving deliberately leaves the published revision in place so old release snapshots
 * still resolve.
 */
export async function loadPublishedManagedKnowledge(now: number = Date.now()): Promise<ManagedKnowledge> {
  // Neither read nor written under a candidate: an unpublished revision left in the process
  // cache would be quoted to real customers. See candidate-context.ts.
  const candidateIds = getCandidateVersions()?.knowledgeRevisionIds ?? []
  if (cache && cache.expiresAt > now && candidateIds.length === 0) return cache.value

  // The whole body is guarded, not just the query: this module's contract is "never throws", and
  // a try that covers only the await leaves every line after it able to end a customer's turn.
  try {
    const rows = await prisma.knowledgeRevision.findMany({
      where:
        candidateIds.length > 0
          ? {
              OR: [{ status: 'PUBLISHED' }, { id: { in: candidateIds } }],
              knowledgeSource: { status: { not: 'ARCHIVED' } },
            }
          : { status: 'PUBLISHED', knowledgeSource: { status: { not: 'ARCHIVED' } } },
      orderBy: [{ knowledgeSourceId: 'asc' }, { version: 'desc' }],
      select: {
        id: true,
        knowledgeSourceId: true,
        version: true,
        title: true,
        body: true,
        knowledgeSource: { select: { key: true, status: true } },
      },
    })
    if (!Array.isArray(rows)) return { ...EMPTY, available: false, loadedAt: now }

    const entries: ManagedKnowledgeEntry[] = []
    for (const row of rows) {
      // A body this build cannot read is SKIPPED, not passed through. Handing the bot a shape it
      // will dereference blindly mid-turn is how a malformed row becomes a customer seeing
      // "undefined" — or a thrown turn.
      const body = readKnowledgeBody(row.body)
      if (!body) {
        console.error('loadPublishedManagedKnowledge: isi revisi tidak terbaca, dilewati', {
          revisionId: row.id,
          version: row.version,
        })
        continue
      }

      entries.push({
        sourceId: row.knowledgeSourceId,
        sourceKey: row.knowledgeSource.key,
        sourceTitle: row.title,
        revisionId: row.id,
        version: row.version,
        items: body.items,
      })
    }

    // One entry per source. Under a candidate both its draft revision and the published one
    // come back for the same source, and folding BOTH into the prompt would let the bot answer
    // from the very text the draft is replacing — the failure a pre-release run exists to catch.
    let chosen = entries
    if (candidateIds.length > 0) {
      const bySource = new Map<string, ManagedKnowledgeEntry>()
      for (const entry of entries) {
        const kept = bySource.get(entry.sourceId)
        if (!kept || candidateIds.includes(entry.revisionId)) bySource.set(entry.sourceId, entry)
      }
      chosen = [...bySource.values()]
    }

    const value: ManagedKnowledge = { entries: chosen, available: true, loadedAt: now }
    if (candidateIds.length === 0) cache = { value, expiresAt: now + MANAGED_KNOWLEDGE_CACHE_TTL_MS }
    return value
  } catch (error) {
    // Not cached, so recovery is immediate once the database is back — and NOT rethrown, so a
    // configuration read cannot end a customer's conversation.
    console.error('loadPublishedManagedKnowledge: gagal membaca knowledge terkelola', { error })
    return { ...EMPTY, available: false, loadedAt: now }
  }
}

/** One entry in a decision trace's `knowledgeRefs`, labelled with where it came from. */
export type KnowledgeRef = {
  sourceType: KnowledgeSourceType
  sourceKey: string
  title: string
  /** Only managed knowledge is versioned; a catalog file is whatever is on disk right now. */
  version?: number
}

/**
 * Turns managed entries into trace refs.
 *
 * `sourceType` is the whole point (SDD Manage Second §10, and the Manage Second rules file):
 * once two sources of knowledge exist, a trace that only lists titles cannot answer "did that
 * answer come from the released catalog or from something somebody typed on Tuesday" — which
 * is the first question anyone asks when the bot says something wrong.
 */
export function toKnowledgeRefs(entries: ManagedKnowledgeEntry[]): KnowledgeRef[] {
  return entries.map((entry) => ({
    sourceType: 'MANAGED' as const,
    sourceKey: entry.sourceKey,
    title: entry.sourceTitle,
    version: entry.version,
  }))
}

/** Marks refs that came from a `catalog/*.json` file, so both sides of a trace are labelled. */
export function toCatalogKnowledgeRefs(sourceKeys: string[]): KnowledgeRef[] {
  return sourceKeys.map((key) => ({ sourceType: 'CATALOG' as const, sourceKey: key, title: key }))
}
