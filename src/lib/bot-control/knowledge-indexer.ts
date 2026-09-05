/**
 * Indexes `catalog/*.json` into KnowledgeSource/KnowledgeChunk rows so an operator can read
 * what the bot knows without opening a single JSON file.
 *
 * --- What this is NOT ---
 *
 * It is not a new source of truth for the bot. `src/lib/bot/catalog.ts` and
 * `src/lib/bot/knowledge.ts` keep reading the same files off disk exactly as before, and
 * nothing in this module is imported by them. Guidebook §24 (Risiko 2) is explicit about why:
 * an index can drift from disk, and a bot answering from a stale index is worse than a bot
 * with no explorer at all. This is a mirror, and it is labelled as one in the UI.
 *
 * --- Why the chunker is generic rather than per-file ---
 *
 * `catalog.ts` is a hand-written adapter because the bot needs 16 exact `CatalogPackage`
 * objects joined across ten files. This module has the opposite job: show ALL 32 files,
 * including the nine that `catalog.ts` deliberately ignores because `CatalogPackage` has no
 * field for them. A per-file mapper would have to be extended every time the release adds a
 * file, and the file it did not know about would silently not appear — which is precisely the
 * invisibility being fixed. So the shape rules are structural (array element, object key) and
 * the field rules are name-based, and an unrecognised file still shows up with readable
 * content.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs'
import path from 'node:path'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/** Rows the `type` column may hold. Only CATALOG_JSON is ever written or overwritten here. */
export const CATALOG_SOURCE_TYPE = 'CATALOG_JSON'

export const CATALOG_DIR = 'catalog'

/**
 * `deployment-gate.json` is operational state (has an admin approved the current release?),
 * not knowledge the bot answers from — `catalog.ts` ignores it for the same reason. It is also
 * VPS-only and gitignored, so indexing it would make the index differ between machines for a
 * file that says nothing about what the bot knows.
 */
const IGNORED_FILES = new Set(['deployment-gate.json'])

/** Field names carrying prose a human would actually want to read, in the order to read them. */
const BODY_FIELDS = [
  'title',
  'label',
  'description',
  'short_answer',
  'detail_summary',
  'body',
  'customer_note',
  'note',
  'notes',
  'summary',
  'recommendation',
  'condition',
  'purpose',
]

/** Field names that identify a record, in priority order. */
const TITLE_FIELDS = ['title', 'label', 'package_key', 'module_id', 'id', 'node_id', 'destination_id', 'package_id', 'event_type']

/** Substrings that mark a numeric field as a price. Matched case-insensitively on the key. */
const PRICE_KEY_HINTS = ['price', 'idr', 'rate', 'amount', 'fee', 'cost_idr']

/** Field names whose values are useful as filter tags. */
const TAG_FIELDS = [
  'category',
  'scope',
  'origin',
  'approval_status',
  'destination_tokens',
  'package_key',
  'location_group',
  'severity',
  'confidence',
  'price_type',
  'event_type',
]

export type RawChunk = {
  topic: string
  title: string
  body: string
  facts: string[]
  links: string[]
  prices: number[]
  tags: string[]
  hash: string
}

export type SourceRecord = {
  key: string
  title: string
  type: string
  sourcePath: string
  summary: string
  metadata: {
    fileSize: number
    lastModified: string
    topLevelKeys: string[]
    rootShape: 'array' | 'object' | 'scalar'
    recordCount: number
  }
}

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Every `.json` under `catalog/`, recursively, as repo-relative POSIX paths, sorted.
 *
 * Sorted deliberately: the order decides nothing functionally, but a stable order makes two
 * runs of the indexer comparable and keeps test expectations from depending on the filesystem's
 * directory ordering, which differs between macOS and the Linux VPS.
 */
export function discoverCatalogFiles(repoRoot: string, dir = CATALOG_DIR): string[] {
  const absolute = path.join(repoRoot, dir)
  // Typed via `Dirent` explicitly: `ReturnType<typeof readdirSync>` resolves to the Buffer
  // overload under this @types/node version and makes `entry.name` a Buffer.
  let entries: Dirent[]
  try {
    entries = readdirSync(absolute, { withFileTypes: true })
  } catch {
    // A missing catalog/ directory is a real state on a fresh checkout that has never synced.
    // It means "nothing to index", not a crash.
    return []
  }

  const files: string[] = []
  for (const entry of entries) {
    const relative = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(...discoverCatalogFiles(repoRoot, relative))
      continue
    }
    if (!entry.name.endsWith('.json')) continue
    if (IGNORED_FILES.has(entry.name)) continue
    files.push(relative)
  }
  return files.sort()
}

/** "catalog/itinerary-intelligence/04-route-leg-index.json" -> "Route Leg Index". */
export function titleFromPath(relativePath: string): string {
  const base = path.basename(relativePath, '.json')
  return base
    .replace(/^\d+[-_]/, '')
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** "catalog/policy-cards.json" -> "policy-cards"; nested files keep their folder for context. */
export function topicFromPath(relativePath: string): string {
  const withoutRoot = relativePath.replace(new RegExp(`^${CATALOG_DIR}/`), '')
  return withoutRoot.replace(/\.json$/, '').replace(/\/(\d+)[-_]/, '/')
}

export function hashRecord(value: JsonValue): string {
  return createHash('sha256').update(canonicalize(value)).digest('hex')
}

/**
 * Stable JSON serialisation with object keys sorted at every depth.
 *
 * `JSON.stringify` preserves insertion order, so two runs over a file whose generator emitted
 * the same fields in a different order would hash differently and every chunk would be
 * rewritten as "new" — quietly defeating the whole point of hashing.
 */
function canonicalize(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (isRecord(value)) {
    const parts = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    return `{${parts.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** Flattens a record into readable "path: value" lines, one fact per scalar leaf. */
export function extractFacts(value: JsonValue, prefix = '', out: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, i) => extractFacts(item, prefix ? `${prefix}[${i}]` : `[${i}]`, out))
    return out
  }
  if (isRecord(value)) {
    for (const key of Object.keys(value)) {
      extractFacts(value[key], prefix ? `${prefix}.${key}` : key, out)
    }
    return out
  }
  if (value === null || value === '') return out
  out.push(prefix ? `${prefix}: ${String(value)}` : String(value))
  return out
}

/**
 * URLs the bot may legitimately cite. Both absolute (`https://...`) and site-relative
 * (`/tours/...`) forms count: the catalog stores public pages as relative paths plus a
 * `base_url`, and a URL check that only recognised absolute links would report zero links for
 * every package profile in the release.
 */
export function extractLinks(value: JsonValue, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) extractLinks(item, out)
    return out
  }
  if (isRecord(value)) {
    for (const key of Object.keys(value)) extractLinks(value[key], out)
    return out
  }
  if (typeof value !== 'string') return out
  const trimmed = value.trim()
  const looksAbsolute = /^https?:\/\/\S+$/i.test(trimmed)
  // A single leading slash followed by a path segment. Excludes "/" alone and Markdown prose
  // that merely contains a slash.
  const looksRelative = /^\/[A-Za-z0-9][\w\-./]*$/.test(trimmed)
  if ((looksAbsolute || looksRelative) && !out.includes(trimmed)) out.push(trimmed)
  return out
}

/** Numeric values sitting under a price-ish key, deduped and sorted ascending. */
export function extractPrices(value: JsonValue, key = '', out: number[] = []): number[] {
  if (Array.isArray(value)) {
    for (const item of value) extractPrices(item, key, out)
    return out
  }
  if (isRecord(value)) {
    for (const childKey of Object.keys(value)) extractPrices(value[childKey], childKey, out)
    return out
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return out
  const lowered = key.toLowerCase()
  if (!PRICE_KEY_HINTS.some((hint) => lowered.includes(hint))) return out
  // `min_pax`/`max_pax` sit next to prices in the tier ladder and would otherwise be indexed
  // as if 2 and 11 were rupiah amounts.
  if (lowered.includes('pax') || lowered.includes('count')) return out
  if (!out.includes(value)) out.push(value)
  return out.sort((a, b) => a - b)
}

export function extractTags(record: JsonValue): string[] {
  if (!isRecord(record)) return []
  const tags: string[] = []
  for (const field of TAG_FIELDS) {
    const value = record[field]
    if (typeof value === 'string' && value) tags.push(value)
    else if (Array.isArray(value)) {
      for (const item of value) if (typeof item === 'string' && item) tags.push(item)
    }
  }
  return [...new Set(tags)]
}

export function titleForRecord(record: JsonValue, fallback: string): string {
  if (isRecord(record)) {
    for (const field of TITLE_FIELDS) {
      const value = record[field]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }
  return fallback
}

/**
 * A readable rendering of one record.
 *
 * Prose fields first, in a fixed order, because that is what an operator is scanning for.
 * A record with no prose at all (a price tier row, a route leg) falls back to its flattened
 * facts — still readable, and far better than an empty body that makes the chunk look broken.
 */
export function renderBody(record: JsonValue): string {
  if (!isRecord(record)) return String(record ?? '')

  const parts: string[] = []
  for (const field of BODY_FIELDS) {
    const value = record[field]
    if (typeof value === 'string' && value.trim()) parts.push(value.trim())
    else if (Array.isArray(value)) {
      const strings = value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      if (strings.length > 0) parts.push(strings.join('\n'))
    }
  }

  if (parts.length > 0) return parts.join('\n\n')
  return extractFacts(record).join('\n')
}

function buildChunk(record: JsonValue, topic: string, fallbackTitle: string): RawChunk {
  return {
    topic,
    title: titleForRecord(record, fallbackTitle),
    body: renderBody(record),
    facts: extractFacts(record),
    links: extractLinks(record),
    prices: extractPrices(record),
    tags: extractTags(record),
    hash: hashRecord(record),
  }
}

/**
 * Splits a parsed catalog file into chunks.
 *
 * Three shapes, chosen structurally so an unfamiliar file still produces something useful:
 *   - array root         -> one chunk per element (package profiles, modules, policy cards)
 *   - object root        -> one chunk per top-level key, EXCEPT a key holding an array of
 *                           objects, which becomes one chunk per element (gap-report's `gaps`)
 *   - scalar/empty root  -> a single chunk, so the file is still visible rather than silently
 *                           absent from the explorer
 */
export function chunksFromJson(relativePath: string, parsed: JsonValue): RawChunk[] {
  const topic = topicFromPath(relativePath)
  const label = titleFromPath(relativePath)

  if (Array.isArray(parsed)) {
    return parsed.map((record, i) => buildChunk(record, topic, `${label} #${i + 1}`))
  }

  if (isRecord(parsed)) {
    const chunks: RawChunk[] = []
    for (const key of Object.keys(parsed)) {
      const value = parsed[key]
      const keyTopic = `${topic}/${key}`
      if (Array.isArray(value) && value.length > 0 && value.every(isRecord)) {
        value.forEach((record, i) => chunks.push(buildChunk(record, keyTopic, `${key} #${i + 1}`)))
        continue
      }
      // A bare key/value pair is wrapped so the chunk carries its own name; without the wrapper
      // two keys holding the same value (two `"available"` readiness flags, say) would hash
      // identically and the second would be dropped as a duplicate of the first.
      chunks.push(buildChunk({ [key]: value }, keyTopic, key))
    }
    return chunks
  }

  return [buildChunk(parsed, topic, label)]
}

export function buildSourceRecord(repoRoot: string, relativePath: string, parsed: JsonValue): SourceRecord {
  const stats = statSync(path.join(repoRoot, relativePath))
  const rootShape = Array.isArray(parsed) ? 'array' : isRecord(parsed) ? 'object' : 'scalar'
  const topLevelKeys = isRecord(parsed) ? Object.keys(parsed) : []
  const recordCount = Array.isArray(parsed) ? parsed.length : topLevelKeys.length

  return {
    key: relativePath,
    title: titleFromPath(relativePath),
    type: CATALOG_SOURCE_TYPE,
    sourcePath: relativePath,
    summary:
      rootShape === 'array'
        ? `${recordCount} record dari ${path.basename(relativePath)}`
        : `${recordCount} bagian top-level dari ${path.basename(relativePath)}`,
    metadata: {
      fileSize: stats.size,
      lastModified: stats.mtime.toISOString(),
      topLevelKeys,
      rootShape,
      recordCount,
    },
  }
}

export type IndexResult = {
  sourcesIndexed: number
  chunksIndexed: number
  /** Files that could not be parsed. Reported, not thrown — one broken file must not hide 31 good ones. */
  errors: Array<{ sourcePath: string; message: string }>
}

/**
 * Reads every catalog file and brings the index in line with what is on disk.
 *
 * Idempotent by construction: a source is matched by its path (`key`) and a chunk by its
 * content hash, so re-running over unchanged files creates nothing new. Chunks whose hash has
 * disappeared from a file are DELETED rather than kept — a leftover chunk would tell an
 * operator the bot still knows a fact that was removed from the release, which is the one
 * mistake an explorer must not make.
 */
export async function indexCatalogKnowledge(repoRoot: string = process.cwd()): Promise<IndexResult> {
  const files = discoverCatalogFiles(repoRoot)
  const errors: IndexResult['errors'] = []
  let sourcesIndexed = 0
  let chunksIndexed = 0
  const seenKeys: string[] = []

  for (const relativePath of files) {
    let parsed: JsonValue
    try {
      parsed = JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8')) as JsonValue
    } catch (error) {
      errors.push({ sourcePath: relativePath, message: error instanceof Error ? error.message : 'Gagal membaca file' })
      continue
    }

    const source = buildSourceRecord(repoRoot, relativePath, parsed)
    const chunks = chunksFromJson(relativePath, parsed)

    // A manually curated source that happens to share this path is left completely alone.
    // Guidebook §10.1 rule 2: the indexer may own CATALOG_JSON rows and nothing else.
    const existing = await prisma.knowledgeSource.findUnique({ where: { key: source.key } })
    if (existing && existing.type !== CATALOG_SOURCE_TYPE) {
      errors.push({
        sourcePath: relativePath,
        message: `Dilewati: sumber dengan key ini bertipe ${existing.type} (dibuat manual), tidak ditimpa indexer`,
      })
      continue
    }

    const metadata = source.metadata as unknown as Prisma.InputJsonValue
    const stored = await prisma.knowledgeSource.upsert({
      where: { key: source.key },
      create: {
        key: source.key,
        title: source.title,
        type: source.type,
        sourcePath: source.sourcePath,
        summary: source.summary,
        metadata,
        lastSyncedAt: new Date(),
      },
      update: {
        title: source.title,
        sourcePath: source.sourcePath,
        summary: source.summary,
        metadata,
        // A file that came back after being archived is published again; otherwise a source
        // would stay marked ARCHIVED forever while its chunks are current.
        status: 'PUBLISHED',
        lastSyncedAt: new Date(),
      },
    })

    seenKeys.push(source.key)
    sourcesIndexed += 1

    const hashes = chunks.map((chunk) => chunk.hash)
    await prisma.knowledgeChunk.deleteMany({
      where: { knowledgeSourceId: stored.id, hash: { notIn: hashes } },
    })

    for (const chunk of chunks) {
      await prisma.knowledgeChunk.upsert({
        where: { knowledgeSourceId_hash: { knowledgeSourceId: stored.id, hash: chunk.hash } },
        create: {
          knowledgeSourceId: stored.id,
          topic: chunk.topic,
          title: chunk.title,
          body: chunk.body,
          facts: chunk.facts,
          links: chunk.links,
          prices: chunk.prices,
          tags: chunk.tags,
          hash: chunk.hash,
        },
        update: {
          topic: chunk.topic,
          title: chunk.title,
          body: chunk.body,
          facts: chunk.facts,
          links: chunk.links,
          prices: chunk.prices,
          tags: chunk.tags,
        },
      })
      chunksIndexed += 1
    }
  }

  // A catalog file that is gone from disk is archived, and its chunks removed. Keeping them
  // would leave the explorer asserting knowledge the bot can no longer read. The source row
  // itself survives so the disappearance is visible as history rather than as a silent gap.
  await archiveMissingSources(seenKeys)

  return { sourcesIndexed, chunksIndexed, errors }
}

async function archiveMissingSources(seenKeys: string[]): Promise<void> {
  const missing = await prisma.knowledgeSource.findMany({
    where: { type: CATALOG_SOURCE_TYPE, status: { not: 'ARCHIVED' }, key: { notIn: seenKeys } },
    select: { id: true },
  })
  if (missing.length === 0) return

  const ids = missing.map((source) => source.id)
  await prisma.knowledgeChunk.deleteMany({ where: { knowledgeSourceId: { in: ids } } })
  await prisma.knowledgeSource.updateMany({ where: { id: { in: ids } }, data: { status: 'ARCHIVED' } })
}
