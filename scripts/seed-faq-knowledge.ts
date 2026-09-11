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
 *
 * --- Idempotent by title ---
 *
 * A MANUAL source whose title already matches one of `FAQ_SEED_DATA`'s titles is left alone and
 * reported as skipped — running this twice (e.g. after a partial failure) never creates a
 * duplicate source for the same block.
 *
 * --- Modes ---
 *
 * Default: creates each not-yet-seeded entry as a DRAFT via `createManagedKnowledge`. A DRAFT is
 * not knowledge the bot reads yet (see that function's own header) — this is deliberately a
 * separate, later step from publishing, per Ruling R80's corrected deploy order.
 *
 * `--publish`: for every entry this script knows a source id for (just created, or already
 * existing), calls `publishKnowledgeRevision` — the exact function `/bot-control/knowledge`'s
 * own "Aktifkan" button calls, so validation and audit logging are identical. An entry with
 * nothing left to publish (already published, no draft) is reported as skipped, not a fatal
 * error — the other entries still get their turn.
 *
 * `--dry-run`: prints the plan (what would be created/skipped/published) and writes nothing —
 * combine with `--publish` to preview the full two-step plan at once. Read-only lookups (does a
 * source with this title already exist?) still run, since an accurate dry-run plan depends on
 * them; only `createManagedKnowledge`/`publishKnowledgeRevision` — the two functions that write
 * — are skipped.
 *
 * --- Do NOT run this against production ---
 *
 * This writes real `KnowledgeSource`/`KnowledgeRevision` rows read by the live bot. It is meant
 * to be run once, deliberately, by the operator (or whoever is executing the documented deploy
 * checklist) as part of Task 11's Gerbang G5 — never by an agent, and never against a database
 * this repo's `DATABASE_URL` does not obviously point at on purpose.
 *
 * Usage:
 *   npx tsx scripts/seed-faq-knowledge.ts --actor <accountId> [--publish] [--dry-run]
 *
 * Deliberately NOT added to package.json's `scripts` (confirmed with the operator, Ruling R94)
 * — run directly with `npx tsx`, matching this repo's other one-off operator scripts that are
 * invoked the same way (e.g. `approve-deployment.ts`'s own header shows the pattern, though that
 * one happens to also have an npm alias).
 */
import { config } from 'dotenv'

config()

import { FAQ_SEED_DATA, type FaqSeedEntry } from '@/lib/bot-control/faq-seed-data'
import type { RevisionResult, Actor } from '@/lib/bot-control/knowledge-workflow'

/** Raised for a usage error (missing/unknown actor) — distinct from a write actually failing. */
export class SeedUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SeedUsageError'
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
 * The subset of the real Prisma/knowledge-workflow calls this script needs, injected so tests
 * can supply an in-memory fake instead of a real database — CLAUDE.md forbids running this
 * script (or any DB-touching script) as part of implementing it, so the logic below is exercised
 * entirely through this seam.
 */
export type SeedDeps = {
  findAccount: (id: string) => Promise<{ id: string; name: string | null } | null>
  findManualSourceByTitle: (title: string) => Promise<{ id: string } | null>
  createManagedKnowledge: (
    params: { title: string; body: unknown; reason: string },
    actor: Actor
  ) => Promise<RevisionResult>
  publishKnowledgeRevision: (sourceId: string, actor: Actor, reason: string | null) => Promise<RevisionResult>
}

export type SeedResult = {
  created: string[]
  skipped: string[]
  published: string[]
  publishSkipped: Array<{ title: string; reason: string }>
}

const SEED_REASON = 'Seed FAQ knowledge dari blok GENERAL_FAQ_FALLBACK (Task 11, Ruling R57/R94).'

/**
 * The whole script's logic, minus argv/process.exit — a pure(ish) function over injected `deps`
 * so it's fully unit-testable. Never calls `createManagedKnowledge`/`publishKnowledgeRevision`
 * (the two writes) when `options.dryRun` is true; every other lookup still runs so the reported
 * plan reflects real state.
 */
export async function runSeed(entries: FaqSeedEntry[], options: SeedOptions, deps: SeedDeps): Promise<SeedResult> {
  if (!options.actorId) {
    throw new SeedUsageError('--actor <accountId> wajib diisi.')
  }
  const account = await deps.findAccount(options.actorId)
  if (!account) {
    throw new SeedUsageError(`Akun dengan id "${options.actorId}" tidak ditemukan.`)
  }
  const actor: Actor = { id: account.id, name: account.name }

  const result: SeedResult = { created: [], skipped: [], published: [], publishSkipped: [] }
  // sourceId for every entry this run knows about (just created, or already existed) — the
  // publish phase below needs this even for entries this run itself skipped creating.
  const sourceIdByTitle = new Map<string, string>()

  for (const entry of entries) {
    const existing = await deps.findManualSourceByTitle(entry.title)
    if (existing) {
      result.skipped.push(entry.title)
      sourceIdByTitle.set(entry.title, existing.id)
      continue
    }
    if (options.dryRun) {
      result.created.push(entry.title)
      continue
    }
    const created = await deps.createManagedKnowledge(
      { title: entry.title, body: knowledgeBodyFor(entry), reason: SEED_REASON },
      actor
    )
    result.created.push(entry.title)
    sourceIdByTitle.set(entry.title, created.sourceId)
  }

  if (options.publish) {
    for (const entry of entries) {
      // Dry-run preview: every entry above either already had a real source (skipped) or would
      // be created moments before this step ran for real, so the full two-step plan always
      // reaches a publish attempt for every entry — no `publishKnowledgeRevision` call to make
      // (nothing was actually written), just the plan.
      if (options.dryRun) {
        result.published.push(entry.title)
        continue
      }
      const sourceId = sourceIdByTitle.get(entry.title)
      if (!sourceId) {
        // Not reachable in practice outside dry-run (every entry above either already existed
        // or was just created), kept as a named failure mode rather than a thrown exception so
        // one missing entry doesn't abort publishing the rest.
        result.publishSkipped.push({ title: entry.title, reason: 'sumber tidak ditemukan' })
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

function printPlan(result: SeedResult, options: SeedOptions): void {
  const prefix = options.dryRun ? '[dry-run] ' : ''
  console.log(`${prefix}Dibuat (DRAFT): ${result.created.length ? result.created.join(', ') : '(tidak ada)'}`)
  console.log(`${prefix}Dilewati (sudah ada): ${result.skipped.length ? result.skipped.join(', ') : '(tidak ada)'}`)
  if (options.publish) {
    console.log(`${prefix}Diterbitkan: ${result.published.length ? result.published.join(', ') : '(tidak ada)'}`)
    if (result.publishSkipped.length > 0) {
      console.log(`${prefix}Penerbitan dilewati:`)
      for (const { title, reason } of result.publishSkipped) console.log(`  - ${title}: ${reason}`)
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  const { prisma } = await import('@/lib/db')
  const { createManagedKnowledge, publishKnowledgeRevision } = await import('@/lib/bot-control/knowledge-workflow')

  const deps: SeedDeps = {
    findAccount: (id) => prisma.account.findUnique({ where: { id }, select: { id: true, name: true } }),
    findManualSourceByTitle: (title) =>
      prisma.knowledgeSource.findFirst({ where: { title, type: 'MANUAL' }, select: { id: true } }),
    createManagedKnowledge,
    publishKnowledgeRevision,
  }

  try {
    const result = await runSeed(FAQ_SEED_DATA, options, deps)
    printPlan(result, options)
  } finally {
    await prisma.$disconnect()
  }
}

// Only runs main() when executed directly (`npx tsx scripts/seed-faq-knowledge.ts`) — importing
// this file's exports from a test must never touch a real database.
if (require.main === module) {
  main().catch((error) => {
    console.error('Gagal:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
