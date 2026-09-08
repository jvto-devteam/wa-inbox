/**
 * Reads `catalog/*.json` into a searchable, human-readable list — straight off disk, the same
 * files the bot itself reads.
 *
 * --- Why this replaced a database mirror ---
 *
 * Knowledge Explorer used to be backed by a copy of the catalog in Postgres: 32 catalog-typed
 * `KnowledgeSource` rows plus their chunks, written by an indexer and kept in step by an
 * "Index ulang katalog" button. Nothing in the bot ever read that copy —
 * `src/lib/bot/knowledge.ts` and `src/lib/bot/catalog.ts` open the JSON files directly and
 * contain no `prisma` reference at all. So the mirror was a second copy of data that already
 * existed, one manual step away from disagreeing with it, and the page could show an operator
 * a "knowledge" the bot had stopped using.
 *
 * Reading disk instead removes the entire class of failure: what this page shows is what the
 * bot reads, with no sync step to forget. `loadCatalog()` already caches on an mtime
 * fingerprint of every file it touches (see catalog.ts), so an edited or redeployed catalog is
 * picked up on the next request with no restart — and no button.
 *
 * --- Read-only, on purpose ---
 *
 * This module must never import `prisma`. The indexer it replaces was the only code in the
 * repo that wrote `KnowledgeSource` rows it did not author, and therefore the only code that
 * could ever have overwritten an operator's `type='MANUAL'` knowledge (CLAUDE.md's absolute
 * rule). Keeping the catalog path a pure reader is what makes that rule unbreakable rather
 * than merely obeyed. `catalog-explorer.test.ts` asserts it.
 */
import { loadCatalog, readCatalogFile } from '@/lib/bot/catalog'

/** The general-knowledge module file, read verbatim rather than through the package join. */
const GENERAL_MODULES_FILE = 'general-modules.json'
const PROFILES_FILE = 'package-profiles.json'

/**
 * One searchable card in the explorer.
 *
 * `id` is derived from the file and the record's own key, not generated: it has to survive a
 * re-read so React keys and the "show more" toggle do not jump around between requests.
 */
export type CatalogEntry = {
  id: string
  /** The file on disk this came from, so an operator can go and edit the right one. */
  sourceFile: string
  topic: string
  title: string
  body: string
  links: string[]
  prices: number[]
  tags: string[]
}

export type CatalogEntryPage = {
  items: CatalogEntry[]
  page: number
  limit: number
  total: number
  /** `catalog/meta.json`'s `syncedAt` — when the files themselves were last refreshed. */
  syncedAt: string | null
}

const IDR = new Intl.NumberFormat('id-ID')

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/** A labelled paragraph, dropped entirely when the list behind it is empty. */
function section(label: string, values: string[]): string[] {
  return values.length > 0 ? [`${label}: ${values.join(', ')}`] : []
}

/**
 * Every package in the catalog, rendered as prose.
 *
 * This deliberately goes through `loadCatalog()` rather than re-parsing the profile files:
 * that function IS the bot's view of the catalog, joins included, so what an operator reads
 * here is what the bot was given — not a second interpretation of the same files that could
 * drift from it.
 */
function packageEntries(): CatalogEntry[] {
  const { packages } = loadCatalog()

  return packages.map((pkg) => {
    const lines: string[] = []
    lines.push(...section('Destinasi', pkg.destinationTokens))
    if (pkg.origin) lines.push(`Berangkat dari: ${pkg.origin}`)
    if (pkg.dayCount) lines.push(`Durasi: ${pkg.dayCount} hari`)
    lines.push(...section('Kota selesai', pkg.finishCities))
    if (pkg.priceIdr !== null) lines.push(`Harga mulai: Rp ${IDR.format(pkg.priceIdr)} / orang`)
    lines.push(
      ...section(
        'Tier harga',
        pkg.priceTiers.map(
          (tier) =>
            `${tier.minPax}-${tier.maxPax ?? '∞'} pax: Rp ${IDR.format(tier.priceIdr)}`
        )
      )
    )
    lines.push(...section('Termasuk', pkg.inclusions))
    lines.push(...section('Menginap', pkg.overnights))
    if (pkg.roomingAssumption) lines.push(`Asumsi kamar: ${pkg.roomingAssumption}`)
    if (pkg.vehicleCategory) lines.push(`Kendaraan: ${pkg.vehicleCategory}`)
    if (pkg.luggageRule) lines.push(`Bagasi: ${pkg.luggageRule}`)
    if (pkg.crewRoles) lines.push(`Kru: ${pkg.crewRoles}`)
    if (pkg.languageNote) lines.push(`Bahasa: ${pkg.languageNote}`)
    lines.push(...section('Catatan kebijakan', pkg.policyNotes))
    lines.push(...section('Catatan staging', pkg.stagingNotes))

    return {
      id: `${PROFILES_FILE}#${pkg.packageKey}`,
      sourceFile: PROFILES_FILE,
      topic: 'paket',
      title: pkg.title,
      body: lines.join('\n'),
      links: Object.values(pkg.links),
      prices: pkg.priceTiers.map((tier) => tier.priceIdr),
      tags: pkg.destinationTokens,
    }
  })
}

/**
 * The general-knowledge modules — policies, locations, services, route legs.
 *
 * These are NOT reachable through `loadCatalog()`'s packages: its join deliberately keeps only
 * the package-scoped policy and staging modules (a `global` policy attached to all 16 packages
 * is not a per-package disclosure, see catalog.ts). Global ones are exactly the material an
 * operator searches this page for — "anti-fraud", "masker", "pembayaran" — so they are read
 * from the file directly.
 */
function moduleEntries(): CatalogEntry[] {
  const parsed = readCatalogFile(GENERAL_MODULES_FILE)
  if (!Array.isArray(parsed)) return []

  const entries: CatalogEntry[] = []
  // Named `mod`, not `module`: assigning to `module` is a build-level error in this project
  // (@next/next/no-assign-module-variable).
  for (const mod of parsed) {
    if (!isObject(mod)) continue
    const moduleId = asString(mod.module_id)
    if (!moduleId) continue

    const lines: string[] = []
    const shortAnswer = asString(mod.short_answer)
    const detail = asString(mod.detail_summary)
    if (shortAnswer) lines.push(shortAnswer)
    // Both, when both exist: the short answer is what the bot quotes, the detail is what an
    // operator needs to judge whether the short answer is still true.
    if (detail && detail !== shortAnswer) lines.push(detail)

    const tags: string[] = []
    const scope = asString(mod.scope)
    if (scope) tags.push(scope)
    const approval = asString(mod.approval_status)
    // Surfaced as a tag rather than filtered out: an unapproved module is still in the file,
    // and an operator wondering why the bot never says something needs to see that.
    if (approval) tags.push(approval)
    if (mod.customer_visible === false) tags.push('internal')

    entries.push({
      id: `${GENERAL_MODULES_FILE}#${moduleId}`,
      sourceFile: GENERAL_MODULES_FILE,
      topic: asString(mod.category) ?? 'lainnya',
      title: asString(mod.title) ?? moduleId,
      body: lines.join('\n\n'),
      links: [],
      prices: [],
      tags,
    })
  }
  return entries
}

/**
 * The whole catalog as searchable entries, read fresh from disk on every call.
 *
 * No cache of its own. `loadCatalog()` already has one keyed on file mtimes, and adding a
 * second layer here with its own expiry is precisely how the mirror this replaced went stale:
 * the page would again be showing something other than the current files.
 */
export function loadCatalogEntries(): { entries: CatalogEntry[]; syncedAt: string | null } {
  const { syncedAt } = loadCatalog()
  const entries = [...packageEntries(), ...moduleEntries()]
  // Grouped by topic, then alphabetical, so a filtered list reads as a table a human can scan
  // rather than in file order.
  entries.sort((a, b) => a.topic.localeCompare(b.topic) || a.title.localeCompare(b.title))
  return { entries, syncedAt }
}

function matches(entry: CatalogEntry, needle: string): boolean {
  return (
    entry.title.toLowerCase().includes(needle) ||
    entry.body.toLowerCase().includes(needle) ||
    entry.tags.some((tag) => tag.toLowerCase().includes(needle))
  )
}

/**
 * Search, filter and page in one pass.
 *
 * Filtering happens BEFORE the slice, and `total` counts the filtered set — the same rule the
 * database-backed endpoints follow. Slicing first would show "the first 50 entries, of which
 * the matching ones", which is legitimately empty while matches exist.
 */
export function searchCatalogEntries(options: {
  q?: string | null
  topic?: string | null
  page: number
  limit: number
  skip: number
}): CatalogEntryPage {
  const { entries, syncedAt } = loadCatalogEntries()
  const needle = options.q?.trim().toLowerCase()
  const topic = options.topic?.trim()

  let filtered = entries
  if (topic) filtered = filtered.filter((entry) => entry.topic === topic)
  if (needle) filtered = filtered.filter((entry) => matches(entry, needle))

  return {
    items: filtered.slice(options.skip, options.skip + options.limit),
    page: options.page,
    limit: options.limit,
    total: filtered.length,
    syncedAt,
  }
}

/** The topics present on disk right now, for the filter control. */
export function catalogTopics(): string[] {
  return [...new Set(loadCatalogEntries().entries.map((entry) => entry.topic))].sort()
}
