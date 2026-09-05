/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  chunksFromJson,
  discoverCatalogFiles,
  extractFacts,
  extractLinks,
  extractPrices,
  extractTags,
  hashRecord,
  indexCatalogKnowledge,
  renderBody,
  titleForRecord,
  titleFromPath,
  topicFromPath,
  buildSourceRecord,
  type JsonValue,
} from './knowledge-indexer'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

let root: string

function writeCatalog(files: Record<string, unknown>) {
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = path.join(root, relative)
    mkdirSync(path.dirname(absolute), { recursive: true })
    writeFileSync(absolute, typeof contents === 'string' ? contents : JSON.stringify(contents))
  }
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'wa-inbox-index-'))
  mockReset(mockPrisma)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('discoverCatalogFiles', () => {
  it('finds nested JSON files and returns repo-relative paths, sorted', () => {
    writeCatalog({
      'catalog/policy-cards.json': [],
      'catalog/itinerary-intelligence/04-route-leg-index.json': [],
      'catalog/accommodation-rules.json': [],
    })
    expect(discoverCatalogFiles(root)).toEqual([
      'catalog/accommodation-rules.json',
      'catalog/itinerary-intelligence/04-route-leg-index.json',
      'catalog/policy-cards.json',
    ])
  })

  it('ignores non-JSON files', () => {
    writeCatalog({ 'catalog/meta.json': {}, 'catalog/.gitkeep': '', 'catalog/notes.md': '# hi' })
    expect(discoverCatalogFiles(root)).toEqual(['catalog/meta.json'])
  })

  it('skips deployment-gate.json — operational state, not knowledge', () => {
    // It is also VPS-only and gitignored, so indexing it would make the index differ between
    // machines for a file that says nothing about what the bot knows.
    writeCatalog({ 'catalog/deployment-gate.json': { approved: true }, 'catalog/meta.json': {} })
    expect(discoverCatalogFiles(root)).toEqual(['catalog/meta.json'])
  })

  it('returns an empty list when catalog/ does not exist, rather than throwing', () => {
    // A fresh checkout that has never run `npm run sync:knowledge` is a real state.
    expect(discoverCatalogFiles(root)).toEqual([])
  })
})

describe('titleFromPath / topicFromPath', () => {
  it('humanises a filename and strips a numeric prefix', () => {
    expect(titleFromPath('catalog/itinerary-intelligence/04-route-leg-index.json')).toBe('Route Leg Index')
    expect(titleFromPath('catalog/policy-cards.json')).toBe('Policy Cards')
  })

  it('keeps the folder in the topic so nested files stay distinguishable', () => {
    expect(topicFromPath('catalog/itinerary-intelligence/08-meal-logic.json')).toBe('itinerary-intelligence/meal-logic')
    expect(topicFromPath('catalog/policy-cards.json')).toBe('policy-cards')
  })
})

describe('hashRecord', () => {
  it('is stable across key order, so a re-ordered file does not rewrite every chunk', () => {
    expect(hashRecord({ a: 1, b: 2 })).toBe(hashRecord({ b: 2, a: 1 }))
  })

  it('is stable across nested key order too', () => {
    expect(hashRecord({ x: { a: 1, b: [1, 2] } })).toBe(hashRecord({ x: { b: [1, 2], a: 1 } }))
  })

  it('changes when a value changes', () => {
    expect(hashRecord({ a: 1 })).not.toBe(hashRecord({ a: 2 }))
  })

  it('does not treat array order as interchangeable', () => {
    // Day 1 then day 2 is not the same itinerary as day 2 then day 1.
    expect(hashRecord([1, 2])).not.toBe(hashRecord([2, 1]))
  })
})

describe('extractLinks', () => {
  it('finds absolute and site-relative URLs', () => {
    expect(extractLinks({ public_url: '/tours/from-bali/bromo-ijen-3d2n', site: 'https://jvto.example/x' })).toEqual([
      '/tours/from-bali/bromo-ijen-3d2n',
      'https://jvto.example/x',
    ])
  })

  it('does not mistake prose containing a slash for a link', () => {
    expect(extractLinks({ note: 'bring a jacket and/or gloves' })).toEqual([])
    expect(extractLinks({ ratio: '/' })).toEqual([])
  })

  it('deduplicates the same URL found in two places', () => {
    expect(extractLinks({ a: '/tours/x', b: { c: '/tours/x' } })).toEqual(['/tours/x'])
  })
})

describe('extractPrices', () => {
  it('picks up numbers under price-ish keys', () => {
    expect(extractPrices({ pax_tiers: [{ idr_per_person: 1500000 }, { idr_per_person: 1200000 }] })).toEqual([
      1200000, 1500000,
    ])
  })

  it('ignores pax counts sitting right next to the prices', () => {
    // min_pax/max_pax live in the same tier object; without the guard 2 and 11 would be
    // indexed as rupiah amounts and shown to an operator as prices.
    expect(extractPrices({ pax_tiers: [{ min_pax: 2, max_pax: 11, idr_per_person: 900000 }] })).toEqual([900000])
  })

  it('ignores numbers under unrelated keys', () => {
    expect(extractPrices({ day_count: 3, distance_km: 120 })).toEqual([])
  })
})

describe('extractFacts', () => {
  it('flattens nested values into readable path: value lines', () => {
    expect(extractFacts({ readiness: { policy: 'available' }, tokens: ['ijen', 'bromo'] })).toEqual([
      'readiness.policy: available',
      'tokens[0]: ijen',
      'tokens[1]: bromo',
    ])
  })

  it('drops nulls and empty strings rather than emitting empty facts', () => {
    expect(extractFacts({ a: null, b: '', c: 'x' })).toEqual(['c: x'])
  })
})

describe('extractTags / titleForRecord / renderBody', () => {
  it('collects destination tokens, category and package key as tags', () => {
    // Order follows TAG_FIELDS, not the record's own key order, so the same tags come out in
    // the same sequence regardless of how a release generator happened to emit the fields.
    expect(extractTags({ package_key: 'bali/x', category: 'policy', destination_tokens: ['ijen'] })).toEqual([
      'policy',
      'ijen',
      'bali/x',
    ])
  })

  it('prefers a real title, then falls back to an identifier, then to the supplied label', () => {
    expect(titleForRecord({ title: 'Anti-Fraud', module_id: 'policy_anti_fraud' }, 'fallback')).toBe('Anti-Fraud')
    expect(titleForRecord({ module_id: 'policy_anti_fraud' }, 'fallback')).toBe('policy_anti_fraud')
    expect(titleForRecord({ nothing: 1 }, 'fallback')).toBe('fallback')
  })

  it('renders prose fields in reading order', () => {
    const body = renderBody({ title: 'Judul', short_answer: 'Jawaban singkat', body: 'Isi panjang' })
    expect(body).toBe('Judul\n\nJawaban singkat\n\nIsi panjang')
  })

  it('falls back to flattened facts for a record with no prose at all', () => {
    // A price tier row has no description. An empty body would make the chunk look broken.
    expect(renderBody({ min_pax: 2, idr_per_person: 900000 })).toBe('min_pax: 2\nidr_per_person: 900000')
  })
})

describe('chunksFromJson', () => {
  it('makes one chunk per element for an array-rooted file', () => {
    const chunks = chunksFromJson('catalog/policy-cards.json', [
      { id: 'policies/a', title: 'A', body: 'isi a' },
      { id: 'policies/b', title: 'B', body: 'isi b' },
    ])
    expect(chunks).toHaveLength(2)
    expect(chunks.map((c) => c.title)).toEqual(['A', 'B'])
    expect(chunks.every((c) => c.topic === 'policy-cards')).toBe(true)
  })

  it('makes one chunk per top-level key for an object-rooted file', () => {
    const chunks = chunksFromJson('catalog/module-manifest.json', { release_id: 'r1', general_module_count: 77 })
    expect(chunks.map((c) => c.topic)).toEqual(['module-manifest/release_id', 'module-manifest/general_module_count'])
  })

  it('expands an object-array under a key into one chunk per element', () => {
    const chunks = chunksFromJson('catalog/gap-report.json', {
      gap_count: 2,
      gaps: [{ id: 'g1', label: 'Gap satu' }, { id: 'g2', label: 'Gap dua' }],
    })
    expect(chunks.map((c) => c.title)).toEqual(['gap_count', 'Gap satu', 'Gap dua'])
  })

  it('gives two identical values under different keys distinct hashes', () => {
    // Without wrapping each key/value pair, two "available" flags would hash the same and the
    // second would be silently dropped as a duplicate.
    const chunks = chunksFromJson('catalog/coverage-report.json', { policy: 'available', rooming: 'available' })
    expect(chunks).toHaveLength(2)
    expect(chunks[0].hash).not.toBe(chunks[1].hash)
  })

  it('still produces a chunk for a scalar-rooted file, so it is visible in the explorer', () => {
    expect(chunksFromJson('catalog/weird.json', 'just a string')).toHaveLength(1)
  })

  it('produces identical chunks on a second pass over unchanged data', () => {
    const data: JsonValue = [{ id: 'a', title: 'A' }]
    expect(chunksFromJson('catalog/x.json', data).map((c) => c.hash)).toEqual(
      chunksFromJson('catalog/x.json', data).map((c) => c.hash)
    )
  })
})

describe('buildSourceRecord', () => {
  it('records file size, last modified, top-level keys and the root shape', () => {
    writeCatalog({ 'catalog/meta.json': { syncedAt: '2026-09-04T00:00:00.000Z' } })
    const source = buildSourceRecord(root, 'catalog/meta.json', { syncedAt: '2026-09-04T00:00:00.000Z' })

    expect(source.key).toBe('catalog/meta.json')
    expect(source.type).toBe('CATALOG_JSON')
    expect(source.sourcePath).toBe('catalog/meta.json')
    expect(source.metadata.rootShape).toBe('object')
    expect(source.metadata.topLevelKeys).toEqual(['syncedAt'])
    expect(source.metadata.fileSize).toBeGreaterThan(0)
    expect(source.metadata.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('counts array records for an array-rooted file', () => {
    writeCatalog({ 'catalog/policy-cards.json': [{ id: 'a' }, { id: 'b' }] })
    const source = buildSourceRecord(root, 'catalog/policy-cards.json', [{ id: 'a' }, { id: 'b' }])
    expect(source.metadata.rootShape).toBe('array')
    expect(source.metadata.recordCount).toBe(2)
  })
})

describe('indexCatalogKnowledge', () => {
  function stubSourceUpsert(id = 'src_1') {
    mockPrisma.knowledgeSource.findUnique.mockResolvedValue(null)
    mockPrisma.knowledgeSource.upsert.mockResolvedValue({ id } as never)
    mockPrisma.knowledgeChunk.deleteMany.mockResolvedValue({ count: 0 } as never)
    mockPrisma.knowledgeChunk.upsert.mockResolvedValue({ id: 'chunk_1' } as never)
    mockPrisma.knowledgeSource.findMany.mockResolvedValue([] as never)
  }

  it('indexes every catalog file and reports the counts', async () => {
    writeCatalog({
      'catalog/policy-cards.json': [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
      'catalog/meta.json': { syncedAt: '2026-09-04T00:00:00.000Z' },
    })
    stubSourceUpsert()

    const result = await indexCatalogKnowledge(root)

    expect(result.sourcesIndexed).toBe(2)
    expect(result.chunksIndexed).toBe(3)
    expect(result.errors).toEqual([])
  })

  it('stamps lastSyncedAt and stores the source path for crosscheck', async () => {
    writeCatalog({ 'catalog/meta.json': { syncedAt: 'x' } })
    stubSourceUpsert()

    await indexCatalogKnowledge(root)

    const call = mockPrisma.knowledgeSource.upsert.mock.calls[0][0]
    expect(call.where).toEqual({ key: 'catalog/meta.json' })
    expect(call.create.sourcePath).toBe('catalog/meta.json')
    expect(call.create.lastSyncedAt).toBeInstanceOf(Date)
  })

  it('matches chunks on their content hash so a re-run creates no duplicates', async () => {
    writeCatalog({ 'catalog/policy-cards.json': [{ id: 'a', title: 'A' }] })
    stubSourceUpsert()

    await indexCatalogKnowledge(root)

    const call = mockPrisma.knowledgeChunk.upsert.mock.calls[0][0]
    expect(call.where.knowledgeSourceId_hash).toEqual({
      knowledgeSourceId: 'src_1',
      hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
  })

  it('deletes chunks whose hash is gone from the file', async () => {
    // A fact removed from the release must disappear from the explorer. Leaving it would tell
    // an operator the bot still knows something it can no longer read.
    writeCatalog({ 'catalog/policy-cards.json': [{ id: 'a', title: 'A' }] })
    stubSourceUpsert()

    await indexCatalogKnowledge(root)

    // deleteMany's argument is optional in Prisma's types, so it is narrowed rather than
    // asserted through with a cast.
    const call = mockPrisma.knowledgeChunk.deleteMany.mock.calls[0][0]
    expect(call?.where).toEqual({ knowledgeSourceId: 'src_1', hash: { notIn: [expect.any(String)] } })
  })

  it('never overwrites a manually created source that shares a path', async () => {
    writeCatalog({ 'catalog/policy-cards.json': [{ id: 'a' }] })
    stubSourceUpsert()
    mockPrisma.knowledgeSource.findUnique.mockResolvedValue({ id: 'src_manual', type: 'MANUAL' } as never)

    const result = await indexCatalogKnowledge(root)

    expect(mockPrisma.knowledgeSource.upsert).not.toHaveBeenCalled()
    expect(result.sourcesIndexed).toBe(0)
    expect(result.errors[0].message).toContain('MANUAL')
  })

  it('reports a broken JSON file instead of aborting the whole run', async () => {
    writeCatalog({ 'catalog/broken.json': '{ not json', 'catalog/meta.json': { syncedAt: 'x' } })
    stubSourceUpsert()

    const result = await indexCatalogKnowledge(root)

    expect(result.sourcesIndexed).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].sourcePath).toBe('catalog/broken.json')
  })

  it('archives a catalog source whose file has disappeared, and drops its chunks', async () => {
    writeCatalog({ 'catalog/meta.json': { syncedAt: 'x' } })
    stubSourceUpsert()
    mockPrisma.knowledgeSource.findMany.mockResolvedValue([{ id: 'src_gone' }] as never)
    mockPrisma.knowledgeSource.updateMany.mockResolvedValue({ count: 1 } as never)

    await indexCatalogKnowledge(root)

    expect(mockPrisma.knowledgeSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ key: { notIn: ['catalog/meta.json'] } }) })
    )
    expect(mockPrisma.knowledgeChunk.deleteMany).toHaveBeenCalledWith({
      where: { knowledgeSourceId: { in: ['src_gone'] } },
    })
    expect(mockPrisma.knowledgeSource.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['src_gone'] } },
      data: { status: 'ARCHIVED' },
    })
  })

  it('only ever archives CATALOG_JSON sources', async () => {
    writeCatalog({ 'catalog/meta.json': { syncedAt: 'x' } })
    stubSourceUpsert()

    await indexCatalogKnowledge(root)

    const call = mockPrisma.knowledgeSource.findMany.mock.calls[0][0]
    expect(call).toBeDefined()
    expect(call?.where).toMatchObject({ type: 'CATALOG_JSON' })
  })

  it('does nothing at all when there is no catalog directory', async () => {
    mockPrisma.knowledgeSource.findMany.mockResolvedValue([] as never)

    const result = await indexCatalogKnowledge(root)

    expect(result).toMatchObject({ sourcesIndexed: 0, chunksIndexed: 0, errors: [] })
    expect(mockPrisma.knowledgeSource.upsert).not.toHaveBeenCalled()
  })
})
