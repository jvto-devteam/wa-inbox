/**
 * @vitest-environment node
 *
 * Integration check against the REAL synced release in `catalog/`.
 *
 * knowledge-indexer.test.ts pins behaviour with fixtures; this file answers what fixtures
 * cannot — "does the chunker actually produce something readable from the 32 files on disk?"
 * That is the same gap catalog.real.test.ts exists to close: every unit test passed while
 * `loadCatalog()` returned 190 field-less objects, because nothing ran it against real data.
 *
 * `catalog/*.json` is gitignored (synced by `npm run sync:knowledge`, never committed), so this
 * suite skips itself when the release is absent rather than failing on a fresh clone.
 * Assertions are structural — counts, non-empty bodies, no crashes — so a legitimate re-sync
 * with different tours cannot break them.
 *
 * No database is touched: only the pure chunking functions run here.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { chunksFromJson, discoverCatalogFiles, buildSourceRecord, type JsonValue } from './knowledge-indexer'

const ROOT = process.cwd()
const RELEASE_PRESENT = existsSync(path.join(ROOT, 'catalog', 'package-profiles.json'))

function parse(relativePath: string): JsonValue {
  return JSON.parse(readFileSync(path.join(ROOT, relativePath), 'utf8')) as JsonValue
}

describe.skipIf(!RELEASE_PRESENT)('knowledge indexer against the real catalog/', () => {
  const files = RELEASE_PRESENT ? discoverCatalogFiles(ROOT) : []

  it('discovers the release, including the nested itinerary-intelligence folder', () => {
    expect(files.length).toBeGreaterThan(20)
    expect(files).toContain('catalog/package-profiles.json')
    expect(files.some((f) => f.startsWith('catalog/itinerary-intelligence/'))).toBe(true)
  })

  it('parses and chunks every single file without throwing', () => {
    // The one failure mode that would make the explorer useless is a file shape the chunker
    // cannot handle. There is no per-file mapper, so this must hold for all of them.
    for (const relativePath of files) {
      expect(() => chunksFromJson(relativePath, parse(relativePath)), relativePath).not.toThrow()
    }
  })

  it('gives every chunk a topic, a title and a non-empty body', () => {
    for (const relativePath of files) {
      for (const chunk of chunksFromJson(relativePath, parse(relativePath))) {
        expect(chunk.topic, `${relativePath} topic`).toBeTruthy()
        expect(chunk.title, `${relativePath} title`).toBeTruthy()
        expect(chunk.body.length, `${relativePath} / ${chunk.title} body`).toBeGreaterThan(0)
      }
    }
  })

  it('produces no duplicate hashes within a single source', () => {
    // A collision here would mean the upsert silently drops a real record, so the explorer
    // would show fewer facts than the bot actually has.
    for (const relativePath of files) {
      const hashes = chunksFromJson(relativePath, parse(relativePath)).map((c) => c.hash)
      expect(new Set(hashes).size, relativePath).toBe(hashes.length)
    }
  })

  it('extracts the package price ladder as prices, not as pax counts', () => {
    const chunks = chunksFromJson('catalog/standard-price-tiers.json', parse('catalog/standard-price-tiers.json'))
    const withPrices = chunks.filter((c) => c.prices.length > 0)
    expect(withPrices.length).toBeGreaterThan(0)
    // Real per-person rupiah amounts are six or seven figures; a leaked min_pax would be < 100.
    for (const chunk of withPrices) {
      for (const price of chunk.prices) expect(price, chunk.title).toBeGreaterThan(1000)
    }
  })

  it('extracts the public package URLs so an operator can see what the bot may link to', () => {
    const chunks = chunksFromJson('catalog/package-profiles.json', parse('catalog/package-profiles.json'))
    expect(chunks.every((c) => c.links.length > 0)).toBe(true)
  })

  it('titles package profiles with their real tour names, not with fallback labels', () => {
    const chunks = chunksFromJson('catalog/package-profiles.json', parse('catalog/package-profiles.json'))
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.every((c) => !/^Package Profiles #\d+$/.test(c.title))).toBe(true)
  })

  it('records real file metadata for every source', () => {
    for (const relativePath of files) {
      const source = buildSourceRecord(ROOT, relativePath, parse(relativePath))
      expect(source.metadata.fileSize, relativePath).toBeGreaterThan(0)
      expect(source.type).toBe('CATALOG_JSON')
    }
  })
})
