#!/usr/bin/env tsx
/**
 * Writes the 11 general-JVTO-fact blocks in `src/lib/bot-control/faq-seed-data.ts` (formerly
 * the hardcoded `GENERAL_FAQ_FALLBACK` constant, removed in Task 11) into the database as
 * managed `KnowledgeSource`/`KnowledgeRevision` rows — the ONLY way this content can reach
 * production before this task's code is deployed there (Ruling R57): `main`'s
 * `knowledgeItemSchema` is `.strict()` without `topics`, so the production UI rejects a
 * topic-bearing entry outright, and `main`'s loader silently skips any revision whose body it
 * cannot read. Writing through a local build straight to the production database is itself a
 * production write from a developer machine — a script, run deliberately as a deploy step in a
 * documented order (seed DRAFT → `verify:revisions` → deploy → publish → `verify:revisions`,
 * see the plan's Checklist Deploy → Tahap 2), is the honest version of that write, not a
 * shortcut around it.
 *
 * --- What this does NOT do ---
 *
 * This never talks to `sendMessage`, `OutboundJob`, or any customer-facing channel — it only
 * writes `KnowledgeSource`/`KnowledgeRevision` rows through the exact same
 * `createManagedKnowledge`/`publishKnowledgeRevision` functions the `/bot-control/knowledge` UI
 * itself calls, so validation and audit logging are identical to a human doing this by hand.
 * The actor must pass `hasAdminPowers`, same rule as the UI (Fix round 1, R99, Minor 5d).
 *
 * --- Identifying "ours", not just "same title" (Fix round 1, R99, Important 1) ---
 *
 * Matching a title alone is not enough to call a source "already seeded": an operator can write
 * their own MANUAL source under the exact same title (nothing stops them — titles aren't
 * unique). The first version of `--publish` matched by title only, which meant an operator's own
 * same-titled source would be treated as "already seeded" and PUBLISHED by this script — either
 * publishing content the operator never asked to go live, or (if they had a v2 draft in
 * progress) pushing an unfinished edit live. Fixed: a title match is only ever treated as "ours"
 * when that source's FIRST EVER revision (version 1) has `changeReason === SEED_REASON` — a
 * string this script mints and nothing else does.
 *
 * Fix round 2 (R100), Minor 2: version 1's `changeReason` is NOT immutable evidence, and an
 * earlier version of this comment (and the code's blocked-reason message) wrongly called it
 * that. `saveKnowledgeDraft` (knowledge-workflow.ts) rewrites a DRAFT revision IN PLACE —
 * `changeReason` and `createdBy` included — for as long as that revision has never been
 * published; only once it IS published does a later edit create a genuinely new, separate
 * revision (version 2+), leaving version 1 untouched forever after. So an operator editing this
 * script's own still-DRAFT v1 (before anyone ever published it) rewrites the very row this check
 * reads, and `firstRevisionChangeReason !== SEED_REASON` becomes true for BOTH that case and a
 * genuinely unrelated operator source — this script cannot tell the two apart from that signal
 * alone. The blocked reason is worded to say only what is actually known (the current draft was
 * not written by this script's own run) rather than falsely asserting a specific origin story;
 * `createdBy` is still surfaced as diagnostic context, not as a claim of non-origin.
 *
 * Even a source THIS script genuinely did create (or does now, this run) can stop being
 * publishable: if its latest revision was edited since (a `changeReason` no longer
 * `SEED_REASON`, whether that is a deliberate v2 or an in-place v1 edit as above), or is already
 * `PUBLISHED`, or the source itself got `ARCHIVED` — `--publish` reports all of these as
 * `publishSkipped`/`blocked` with a reason, never overwrites them.
 *
 * --- Idempotent by title (for sources this script itself created) ---
 *
 * A MANUAL source whose title already matches one of `FAQ_SEED_DATA`'s titles, AND whose first
 * revision this script itself wrote, is left alone and reported as skipped — running this twice
 * (e.g. after a partial failure) never creates a duplicate source for the same block.
 *
 * --- Modes ---
 *
 * Default: creates each not-yet-seeded entry as a DRAFT via `createManagedKnowledge`. A DRAFT is
 * not knowledge the bot reads yet (see that function's own header) — this is deliberately a
 * separate, later step from publishing, per Ruling R80's corrected deploy order. A create
 * failure partway through prints everything already created before exiting 1 (Fix round 1,
 * Minor 5c) — the caller does not need to guess what state the database was left in.
 *
 * `--publish`: for every entry this script recognises as its own (just created, or already
 * seeded by an earlier run) with a genuinely publishable draft, calls `publishKnowledgeRevision`
 * — the exact function `/bot-control/knowledge`'s own "Aktifkan" button calls, so validation and
 * audit logging are identical. An entry with nothing left to publish (already published, edited
 * by an operator, blocked) is reported, not a fatal error — the other entries still get their
 * turn.
 *
 * `--dry-run`: prints the plan (what would be created/skipped/blocked/published) and writes
 * nothing — combine with `--publish` to preview the full two-step plan at once, including which
 * entries would be skipped as already-published or blocked as not-ours (Fix round 1, Minor 5a).
 * Read-only lookups (does a source with this title already exist, and whose is it?) still run,
 * since an accurate dry-run plan depends on them; only `createManagedKnowledge`/
 * `publishKnowledgeRevision` — the two functions that write — are skipped.
 *
 * --- Operator-only, at Gerbang G5 -- never run by an agent ---
 *
 * This writes real `KnowledgeSource`/`KnowledgeRevision` rows read by the live bot, in
 * production, on purpose: Task 11's Gerbang G5 is exactly the deliberate operator action of
 * seeding and publishing this content against the real database, following the documented
 * Checklist Deploy order (draft — `verify:revisions` — deploy — `--publish` —
 * `verify:revisions`). That deliberateness is the point, not something to avoid: this file's
 * whole header explains why a script, run by a human at that specific step, is the honest way
 * to make the write, not a shortcut around it.
 *
 * Fix round 2 (R100), Minor 7: earlier wording here said "Do NOT run this against production",
 * which read as contradicting G5 itself -- G5 IS running this against production, deliberately.
 * What must never happen is an AGENT running it, at any point, against any database — that
 * restriction is unconditional (CLAUDE.md, this task's own instructions) and has nothing to do
 * with which environment the operator eventually points it at.
 *
 * Usage:
 *   npm run seed:faq-knowledge -- --actor <accountId> [--dry-run]     # write DRAFTs
 *   npm run seed:faq-knowledge -- --actor <accountId> --publish       # publish the seeded drafts
 *
 * (or equivalently `npx tsx scripts/seed-faq-knowledge.ts --actor <accountId> ...`)
 *
 * The operator decided (6a) that a package.json `scripts` entry for a one-off operator script
 * like this one is fine — earlier guidance in this repo (Ruling R94) had left it out pending
 * that decision; `"seed:faq-knowledge"` is that entry, added with no new dependency.
 */
import { FAQ_SEED_DATA, type FaqSeedEntry } from '@/lib/bot-control/faq-seed-data'
import type { RevisionResult, Actor } from '@/lib/bot-control/knowledge-workflow'
import { hasAdminPowers } from '@/lib/bot-control/permissions'
import type { AccountRoleName } from '@/lib/auth/session'

/** Raised for a usage error (missing/unknown actor, insufficient role) — distinct from a write actually failing. */
export class SeedUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SeedUsageError'
  }
}

/**
 * Raised when a create fails partway through the entry list (Fix round 1, Minor 5c). Carries
 * everything `runSeed` had already accomplished, so the caller can report exactly what state the
 * database was left in instead of a bare error with no context.
 */
export class SeedPartialFailureError extends Error {
  constructor(
    message: string,
    public readonly partial: SeedResult
  ) {
    super(message)
    this.name = 'SeedPartialFailureError'
  }
}

export type SeedOptions = {
  actorId: string | undefined
  publish: boolean
  dryRun: boolean
}

/** Parses `process.argv.slice(2)`-shaped args. Pure, so it's testable without touching argv. */
export function parseArgs(argv: string[]): SeedOptions {
  const actorIndex = argv.indexOf('--actor')
  const actorId = actorIndex !== -1 ? argv[actorIndex + 1] : undefined
  return {
    actorId,
    publish: argv.includes('--publish'),
    dryRun: argv.includes('--dry-run'),
  }
}

/**
 * What the create loop needs to know about an existing MANUAL source with a matching title, to
 * decide whether it is "ours" (Fix round 1, Important 1) and, if so, whether its current draft
 * is still safe to publish.
 */
export type ManualSourceLookup = {
  id: string
  /** The SOURCE's own lifecycle status ('DRAFT' | 'PUBLISHED' | 'ARCHIVED') — see schema.prisma. */
  status: string
  createdBy: string | null
  /**
   * `changeReason` of the source's FIRST EVER revision (version 1) — a strong signal of origin,
   * NOT immutable proof (Fix round 2, R100, Minor 2): `saveKnowledgeDraft` rewrites this in
   * place, `changeReason` included, for as long as version 1 has never been published.
   */
  firstRevisionChangeReason: string | null
  /** The revision that would be published next, or null if the source somehow has none. */
  latestRevision: { status: string; changeReason: string | null } | null
  /**
   * How many MANUAL sources in total share this exact title (Fix round 2, R100, Minor 3) — 1 in
   * the normal case. Titles are not unique (see the "Identifying 'ours'" section above), so more
   * than one is possible; this lookup always resolves to ONE of them deterministically (the
   * oldest, by `createdAt` — see `findManualSourceByTitle`'s real implementation in `main()`),
   * but a count above 1 is worth surfacing to the operator explicitly rather than silently acting
   * on "whichever one happened to sort first".
   */
  matchCount: number
}

/**
 * The subset of the real Prisma/knowledge-workflow calls this script needs, injected so tests
 * can supply an in-memory fake instead of a real database — CLAUDE.md forbids running this
 * script (or any DB-touching script) as part of implementing it, so the logic below is exercised
 * entirely through this seam.
 */
export type SeedDeps = {
  findAccount: (id: string) => Promise<{ id: string; name: string | null; role: AccountRoleName } | null>
  findManualSourceByTitle: (title: string) => Promise<ManualSourceLookup | null>
  createManagedKnowledge: (
    params: { title: string; body: unknown; reason: string },
    actor: Actor
  ) => Promise<RevisionResult>
  publishKnowledgeRevision: (sourceId: string, actor: Actor, reason: string | null) => Promise<RevisionResult>
}

export type SeedResult = {
  created: string[]
  /** Idempotent skip: a source this script itself created earlier already exists. Safe, expected on a rerun. */
  skipped: string[]
  /**
   * A same-titled MANUAL source exists whose current draft this script did not write (a
   * genuinely unrelated operator source, OR this script's own version-1 draft edited by an
   * operator before it was ever published — Fix round 2, R100, Minor 2: these two are NOT always
   * distinguishable, see `ManualSourceLookup.firstRevisionChangeReason`'s own header), or IS ours
   * but has since been archived — never created over, never used, never published
   * (Important 1 / Minor 5b).
   */
  blocked: Array<{ title: string; reason: string }>
  /** More than one MANUAL source shares a seed title (Fix round 2, R100, Minor 3) — reported, not silently resolved. */
  duplicateTitles: Array<{ title: string; count: number }>
  published: string[]
  publishSkipped: Array<{ title: string; reason: string }>
}

const SEED_REASON = 'Seed FAQ knowledge dari blok GENERAL_FAQ_FALLBACK (Task 11, Ruling R57/R94).'

/**
 * Whether `latest` (a source's latest revision) is safe for THIS script to publish. `null`
 * means "yes, publish it"; anything else is the reason it should be skipped instead.
 *
 * Deliberately a pure function of the revision alone (not the whole source), so the SAME
 * decision applies whether the source was just created this run (always publishable — its only
 * revision is a fresh `SEED_REASON` draft) or found already existing (Fix round 1, Important 1 /
 * Minor 5a): an already-PUBLISHED revision or one an operator has since edited must not be
 * silently republished/overwritten, in a real run OR a `--dry-run` preview.
 */
export function publishBlockReason(latest: { status: string; changeReason: string | null } | null): string | null {
  if (!latest) return 'Sumber ini belum punya revisi sama sekali.'
  if (latest.status === 'PUBLISHED') return 'Revisi terbaru sudah PUBLISHED -- tidak ada draft untuk diterbitkan.'
  if (latest.status !== 'DRAFT') return `Revisi terbaru berstatus ${latest.status}, bukan draft.`
  if (latest.changeReason !== SEED_REASON) {
    return 'Draft terbaru bukan ditulis oleh seed ini (kemungkinan sudah diedit operator) -- tidak diterbitkan oleh skrip ini.'
  }
  return null
}

/**
 * The whole script's logic, minus argv/process.exit — a pure(ish) function over injected `deps`
 * so it's fully unit-testable. Never calls `createManagedKnowledge`/`publishKnowledgeRevision`
 * (the two writes) when `options.dryRun` is true; every other lookup still runs so the reported
 * plan reflects real state (Minor 5a).
 */
export async function runSeed(entries: FaqSeedEntry[], options: SeedOptions, deps: SeedDeps): Promise<SeedResult> {
  if (!options.actorId) {
    throw new SeedUsageError('--actor <accountId> wajib diisi.')
  }
  const account = await deps.findAccount(options.actorId)
  if (!account) {
    throw new SeedUsageError(`Akun dengan id "${options.actorId}" tidak ditemukan.`)
  }
  // Fix round 1 (R99), Minor 5d: same authorization rule as every mutation in this app (CLAUDE.md
  // §6) -- there is no separate permission matrix for scripts.
  if (!hasAdminPowers(account.role)) {
    throw new SeedUsageError(`Akun "${options.actorId}" berperan ${account.role} -- perlu wewenang admin (ADMIN/OWNER) untuk menulis knowledge.`)
  }
  const actor: Actor = { id: account.id, name: account.name }

  const result: SeedResult = { created: [], skipped: [], blocked: [], duplicateTitles: [], published: [], publishSkipped: [] }
  // sourceId for every entry this run recognises as its own (just created, or already existing
  // and genuinely seed-created) — the publish phase below needs this even for entries this run
  // itself skipped creating. A `blocked` entry never gets one, by construction.
  const sourceIdByTitle = new Map<string, string>()
  // Whether the entry's current draft is safe for THIS script to publish -- see
  // `publishBlockReason`'s own header. Populated for every non-blocked entry, real or dry-run.
  const publishableByTitle = new Map<string, string | null>()

  for (const entry of entries) {
    // Fix round 2 (R100), Minor 4 (the "5c gap"): a lookup failure here used to propagate
    // unwrapped all the way to the generic top-level `console.error('Gagal:', ...)` handler,
    // which prints no summary of what THIS run had already accomplished before the failure --
    // the exact gap Minor 5c's `SeedPartialFailureError` exists to close for a create failure.
    // Wrapped the same way, so a lookup failure gets the same "what did we already do" report.
    let existing: ManualSourceLookup | null
    try {
      existing = await deps.findManualSourceByTitle(entry.title)
    } catch (error) {
      throw new SeedPartialFailureError(
        `Gagal memeriksa sumber MANUAL yang sudah ada untuk "${entry.title}": ${error instanceof Error ? error.message : String(error)}`,
        result
      )
    }
    if (existing) {
      // Fix round 2 (R100), Minor 3: reported explicitly rather than silently resolved --
      // `existing` is deterministically the OLDEST match (see `findManualSourceByTitle`'s real
      // implementation in `main()`), but an operator should know there was a choice to make.
      if (existing.matchCount > 1) {
        result.duplicateTitles.push({ title: entry.title, count: existing.matchCount })
      }
      if (existing.status === 'ARCHIVED') {
        result.blocked.push({
          title: entry.title,
          reason: 'Sumber MANUAL berjudul sama sudah diarsipkan -- tidak dibuat ulang atau diterbitkan oleh skrip ini.',
        })
        continue
      }
      if (existing.firstRevisionChangeReason !== SEED_REASON) {
        // Fix round 2 (R100), Minor 2: does NOT claim "BUKAN dibuat oleh seed ini" -- that
        // would be asserting a specific origin this script cannot actually prove (see
        // `ManualSourceLookup.firstRevisionChangeReason`'s own header: rewriting version 1's
        // `changeReason` in place, by editing a still-DRAFT source THIS script created, produces
        // the exact same signal as a genuinely unrelated operator source). States only what is
        // actually known -- the current draft does not match what this script would have
        // written -- using the operator-edit phrasing as the LEADING, most likely explanation
        // (an admin deliberately runs this script against titles it owns; a coincidental
        // unrelated same-titled source is the unlikely case, not the default assumption).
        result.blocked.push({
          title: entry.title,
          reason: `Sumber MANUAL berjudul sama sudah ada, dibuat oleh akun ${existing.createdBy ?? 'tidak diketahui'} -- draft seed sudah diedit operator (atau ini sumber operator sendiri yang kebetulan berjudul sama) -- tidak diterbitkan oleh skrip ini.`,
        })
        continue
      }
      // Genuinely ours, from an earlier run of this same script -- normal idempotent skip.
      result.skipped.push(entry.title)
      sourceIdByTitle.set(entry.title, existing.id)
      publishableByTitle.set(entry.title, publishBlockReason(existing.latestRevision))
      continue
    }
    if (options.dryRun) {
      result.created.push(entry.title)
      // A hypothetical fresh creation would always be an immediately-publishable SEED_REASON draft.
      publishableByTitle.set(entry.title, null)
      continue
    }
    try {
      const created = await deps.createManagedKnowledge(
        { title: entry.title, body: knowledgeBodyFor(entry), reason: SEED_REASON },
        actor
      )
      result.created.push(entry.title)
      sourceIdByTitle.set(entry.title, created.sourceId)
      publishableByTitle.set(entry.title, null)
    } catch (error) {
      throw new SeedPartialFailureError(
        `Gagal membuat "${entry.title}": ${error instanceof Error ? error.message : String(error)}`,
        result
      )
    }
  }

  if (options.publish) {
    const blockedTitles = new Set(result.blocked.map((b) => b.title))
    for (const entry of entries) {
      if (blockedTitles.has(entry.title)) continue // never touched -- see the create loop above.

      // `.get()` alone can't distinguish "publishable" (stored as `null`) from "never recorded
      // at all" -- `null ?? fallback` would wrongly resolve to the fallback, since `??` treats
      // `null` as nullish too. `.has()` first is what keeps those two cases apart.
      const blockReason = publishableByTitle.has(entry.title) ? publishableByTitle.get(entry.title)! : 'Sumber tidak ditemukan.'
      if (blockReason !== null) {
        result.publishSkipped.push({ title: entry.title, reason: blockReason })
        continue
      }
      if (options.dryRun) {
        result.published.push(entry.title)
        continue
      }
      const sourceId = sourceIdByTitle.get(entry.title)
      if (!sourceId) {
        // Not reachable outside dry-run: every non-blocked, non-dry-run entry above either
        // already existed or was just created, both of which set a sourceId.
        result.publishSkipped.push({ title: entry.title, reason: 'Sumber tidak ditemukan.' })
        continue
      }
      try {
        await deps.publishKnowledgeRevision(sourceId, actor, SEED_REASON)
        result.published.push(entry.title)
      } catch (error) {
        result.publishSkipped.push({
          title: entry.title,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  return result
}

/** The one-item `KnowledgeItem[]` body `validateKnowledgeBody`/`createManagedKnowledge` expect. */
function knowledgeBodyFor(entry: FaqSeedEntry): unknown {
  return { items: [{ question: entry.question, answer: entry.answer, topics: entry.topics }] }
}

/** Renders a finished (or dry-run) `SeedResult` as the operator-facing plan/report. */
export function printPlan(result: SeedResult, options: SeedOptions): void {
  const prefix = options.dryRun ? '[dry-run] ' : ''
  console.log(`${prefix}Dibuat (DRAFT): ${result.created.length ? result.created.join(', ') : '(tidak ada)'}`)
  console.log(`${prefix}Dilewati (sudah ada, milik seed ini): ${result.skipped.length ? result.skipped.join(', ') : '(tidak ada)'}`)
  if (result.blocked.length > 0) {
    console.log(`${prefix}Diblokir (judul sama, draft bukan milik run ini, atau sudah diarsipkan):`)
    for (const { title, reason } of result.blocked) console.log(`  - ${title}: ${reason}`)
  }
  if (result.duplicateTitles.length > 0) {
    console.log(`${prefix}Judul dengan LEBIH DARI SATU sumber MANUAL (yang tertua yang dipakai):`)
    for (const { title, count } of result.duplicateTitles) console.log(`  - ${title}: ${count} sumber`)
  }
  if (options.publish) {
    console.log(`${prefix}Diterbitkan: ${result.published.length ? result.published.join(', ') : '(tidak ada)'}`)
    if (result.publishSkipped.length > 0) {
      console.log(`${prefix}Penerbitan dilewati:`)
      for (const { title, reason } of result.publishSkipped) console.log(`  - ${title}: ${reason}`)
    }
  }
}

/** Renders a `SeedPartialFailureError`'s message plus what had already been created before it (Minor 5c). */
export function printPartialFailure(error: SeedPartialFailureError): void {
  console.error(error.message)
  console.log(
    `Sudah dibuat sebelum gagal: ${error.partial.created.length ? error.partial.created.join(', ') : '(tidak ada)'}`
  )
  if (error.partial.skipped.length > 0) console.log(`Sudah dilewati (idempoten) sebelum gagal: ${error.partial.skipped.join(', ')}`)
  if (error.partial.blocked.length > 0) console.log(`Sudah diblokir sebelum gagal: ${error.partial.blocked.map((b) => b.title).join(', ')}`)
  if (error.partial.duplicateTitles.length > 0) {
    console.log(`Judul dengan lebih dari satu sumber ditemukan sebelum gagal: ${error.partial.duplicateTitles.map((d) => d.title).join(', ')}`)
  }
}

async function main(): Promise<void> {
  // Fix round 1 (R99), Minor 5e: loaded here, not at module scope -- importing this file's
  // exports (as every test in the sibling `.test.ts` does) must never have the side effect of
  // reading `.env`. `main()` only ever runs under the `require.main === module` guard below.
  const { config } = await import('dotenv')
  config()

  const options = parseArgs(process.argv.slice(2))

  const { prisma } = await import('@/lib/db')
  const { createManagedKnowledge, publishKnowledgeRevision } = await import('@/lib/bot-control/knowledge-workflow')

  const deps: SeedDeps = {
    findAccount: (id) => prisma.account.findUnique({ where: { id }, select: { id: true, name: true, role: true } }),
    findManualSourceByTitle: async (title) => {
      // Fix round 2 (R100), Minor 3: `findFirst` with no `orderBy` has undefined (and in
      // practice, not necessarily stable) ordering -- which one of several same-titled sources
      // got picked, and therefore what the whole run's report said, could differ between
      // otherwise-identical runs. `findMany` + `orderBy: createdAt: 'asc'` makes "the oldest one"
      // a deterministic, repeatable choice, and surfaces the count so `runSeed` can report a
      // duplicate explicitly instead of silently resolving it.
      const sources = await prisma.knowledgeSource.findMany({
        where: { title, type: 'MANUAL' },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          status: true,
          createdBy: true,
          revisions: {
            orderBy: { version: 'asc' },
            select: { version: true, status: true, changeReason: true },
          },
        },
      })
      if (sources.length === 0) return null
      const source = sources[0]
      const revisions = source.revisions
      return {
        id: source.id,
        status: source.status,
        createdBy: source.createdBy,
        firstRevisionChangeReason: revisions[0]?.changeReason ?? null,
        latestRevision: revisions.length > 0 ? revisions[revisions.length - 1] : null,
        matchCount: sources.length,
      }
    },
    createManagedKnowledge,
    publishKnowledgeRevision,
  }

  try {
    const result = await runSeed(FAQ_SEED_DATA, options, deps)
    printPlan(result, options)
  } catch (error) {
    if (error instanceof SeedPartialFailureError) {
      printPartialFailure(error)
      process.exitCode = 1
      return
    }
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Only runs main() when executed directly (`npx tsx scripts/seed-faq-knowledge.ts`, or via
// `npm run seed:faq-knowledge`) — importing this file's exports from a test must never touch a
// real database or read `.env`.
if (require.main === module) {
  main().catch((error) => {
    console.error('Gagal:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
