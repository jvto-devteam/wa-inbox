/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { loadCatalogEntries, searchCatalogEntries, catalogTopics } from './catalog-explorer'
import { __resetCatalogCacheForTests } from '@/lib/bot/catalog'

// Same explicit factory catalog.test.ts uses: a bare `vi.mock('fs')` does not automock a
// built-in module's methods in this environment, so the real `existsSync` would survive.
// `statSync` is mocked here too — it is what drives loadCatalog's mtime fingerprint, and the
// "an edit shows up with no sync step" test is precisely a test of that fingerprint.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  const mocks = {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    statSync: vi.fn(),
  }
  return { ...actual, default: { ...actual, ...mocks }, ...mocks }
})

/** An in-memory `catalog/` directory: `{ filename: json }` plus one mtime per file. */
function mockCatalogFiles(files: Record<string, unknown>, mtimes: Record<string, number> = {}) {
  vi.mocked(fs.existsSync).mockImplementation((p) => {
    const name = String(p).split('/').pop()!
    return name === 'catalog' || Object.prototype.hasOwnProperty.call(files, name)
  })
  vi.mocked(fs.readFileSync).mockImplementation((p) => {
    const name = String(p).split('/').pop()!
    const contents = files[name]
    return typeof contents === 'string' ? contents : JSON.stringify(contents)
  })
  vi.mocked(fs.statSync).mockImplementation(((p: fs.PathLike) => {
    const name = String(p).split('/').pop()!
    if (!Object.prototype.hasOwnProperty.call(files, name)) throw new Error('ENOENT')
    return { mtimeMs: mtimes[name] ?? 1_000 } as fs.Stats
  }) as typeof fs.statSync)
}

const PROFILES = [
  {
    package_key: 'bali/bromo-ijen-3d2n',
    title: '3 Day Bromo & Ijen Volcano Discovery from Bali',
    destination_tokens: ['bromo', 'ijen'],
    public_url: '/tours/from-bali/bromo-ijen-3d2n',
    origin: 'Bali',
    day_count: 3,
  },
]

const PRICE_TIERS = [
  {
    package_key: 'bali/bromo-ijen-3d2n',
    pax_tiers: [
      { min_pax: 2, max_pax: 3, idr_per_person: 3_150_000 },
      { min_pax: 4, max_pax: 6, idr_per_person: 2_450_000 },
    ],
  },
]

const COMPONENTS = [
  { package_key: 'bali/bromo-ijen-3d2n', included: ['Private AC vehicle', 'Ijen entrance ticket'] },
]

const MODULE_COMPATIBILITY = {
  destination_to_packages: {
    destination_bromo: ['bali/bromo-ijen-3d2n'],
    destination_ijen: ['bali/bromo-ijen-3d2n'],
  },
  module_applicability: {},
}

const GENERAL_MODULES = [
  {
    module_id: 'policy_ijen_health',
    category: 'policy',
    scope: 'ijen_scoped',
    title: 'Ijen Health Screening',
    short_answer: 'Setiap tamu wajib membawa surat sehat dan memakai masker gas di kawah.',
    detail_summary: 'Masker gas disediakan pemandu di titik pendakian.',
    customer_visible: true,
    approval_status: 'approved',
  },
  {
    module_id: 'policy_anti_fraud',
    category: 'policy',
    scope: 'global',
    title: 'Booking Safety & Anti-Fraud',
    short_answer: 'JVTO tidak pernah meminta OTP atau CVV.',
    customer_visible: true,
    approval_status: 'approved',
  },
]

const LINKS = { base_url: 'https://javavolcano-touroperator.com' }

function catalogFiles(overrides: Record<string, unknown> = {}) {
  return {
    'package-profiles.json': PROFILES,
    'standard-price-tiers.json': PRICE_TIERS,
    'component-matrices.json': COMPONENTS,
    'module-compatibility.json': MODULE_COMPATIBILITY,
    'general-modules.json': GENERAL_MODULES,
    'customer-link-registry.json': LINKS,
    'meta.json': { syncedAt: '2026-08-07T00:00:00.000Z' },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetCatalogCacheForTests()
})

afterEach(() => {
  __resetCatalogCacheForTests()
})

describe('Knowledge Explorer reads the catalog from disk, not from the database', () => {
  it('renders every package and every general module in catalog/ as searchable entries', () => {
    mockCatalogFiles(catalogFiles())

    const { entries, syncedAt } = loadCatalogEntries()

    expect(syncedAt).toBe('2026-08-07T00:00:00.000Z')
    expect(entries.map((e) => e.title)).toEqual(
      expect.arrayContaining([
        '3 Day Bromo & Ijen Volcano Discovery from Bali',
        'Ijen Health Screening',
        'Booking Safety & Anti-Fraud',
      ])
    )

    const pkg = entries.find((e) => e.topic === 'paket')!
    expect(pkg.sourceFile).toBe('package-profiles.json')
    expect(pkg.body).toContain('Destinasi: bromo, ijen')
    expect(pkg.body).toContain('Termasuk: Private AC vehicle, Ijen entrance ticket')
    expect(pkg.prices).toEqual([3_150_000, 2_450_000])
    expect(pkg.links).toEqual(['https://javavolcano-touroperator.com/tours/from-bali/bromo-ijen-3d2n'])
  })

  it('never opens a database connection to do it', async () => {
    // The structural half of the same promise. The indexer this replaced was the ONLY code that
    // wrote KnowledgeSource rows it had not authored; a `prisma` import creeping back into the
    // catalog path is how that would return. src/lib/bot/knowledge.ts passes this same check,
    // which is the evidence the mirror was never the bot's read path either.
    const source = await fs.promises.readFile(
      path.join(process.cwd(), 'src/lib/bot-control/catalog-explorer.ts'),
      'utf-8'
    )
    expect(source).not.toMatch(/from '@\/lib\/db'/)
    expect(source).not.toMatch(/\bprisma\./)
  })

  it('surfaces the global policies loadCatalog deliberately keeps out of the package join', () => {
    // catalog.ts drops `global`-scope policies from policyNotes on purpose (a note attached to
    // all 16 packages is not a per-package disclosure). They are still real catalog content an
    // operator searches for, so the explorer reads general-modules.json directly.
    mockCatalogFiles(catalogFiles())

    const found = searchCatalogEntries({ q: 'OTP', page: 1, limit: 50, skip: 0 })
    expect(found.total).toBe(1)
    expect(found.items[0].title).toBe('Booking Safety & Anti-Fraud')
  })

  it('counts the whole filtered set before paging, so page 2 is reachable', () => {
    mockCatalogFiles(catalogFiles())
    const firstPage = searchCatalogEntries({ page: 1, limit: 1, skip: 0 })
    expect(firstPage.items).toHaveLength(1)
    expect(firstPage.total).toBe(3)
  })

  it('searches body and tags, not just titles', () => {
    mockCatalogFiles(catalogFiles())
    // "masker" appears only in a module's short_answer; "ijen" only as a package tag.
    expect(searchCatalogEntries({ q: 'masker', page: 1, limit: 50, skip: 0 }).total).toBe(1)
    expect(searchCatalogEntries({ q: 'IJEN', page: 1, limit: 50, skip: 0 }).total).toBe(2)
  })

  it('lists the topics actually present on disk for the filter control', () => {
    mockCatalogFiles(catalogFiles())
    expect(catalogTopics()).toEqual(['paket', 'policy'])
    expect(searchCatalogEntries({ topic: 'paket', page: 1, limit: 50, skip: 0 }).total).toBe(1)
  })

  it('degrades to the packages it can read instead of throwing on a malformed file', () => {
    // Same contract as the bot's own reader: a broken file costs its own contribution and
    // nothing else. Rendering an explorer that 500s would hide the 21 files that are fine.
    mockCatalogFiles(catalogFiles({ 'general-modules.json': '{ not json' }))
    const { entries } = loadCatalogEntries()
    expect(entries.map((e) => e.topic)).toEqual(['paket'])
  })
})

describe('an edited catalog file is visible with no sync step', () => {
  it('picks up a changed file on the next read, without any manual re-index', () => {
    // The whole reason the database mirror was removed. Nobody presses anything here: the only
    // thing standing between the file and the screen is loadCatalog's mtime fingerprint, which
    // is why the file edited below is one loadCatalog caches (package-profiles.json) rather
    // than one the explorer re-reads on every call.
    mockCatalogFiles(catalogFiles(), { 'package-profiles.json': 1_000 })

    expect(searchCatalogEntries({ q: 'Volcano Discovery', page: 1, limit: 50, skip: 0 }).total).toBe(1)
    expect(searchCatalogEntries({ q: 'Sunrise Special', page: 1, limit: 50, skip: 0 }).total).toBe(0)

    const edited = [{ ...PROFILES[0], title: '3 Day Bromo & Ijen Sunrise Special from Bali' }]
    mockCatalogFiles(catalogFiles({ 'package-profiles.json': edited }), { 'package-profiles.json': 2_000 })

    // No __resetCatalogCacheForTests() between the two reads, deliberately: that would test the
    // test helper rather than the invalidation an operator actually relies on.
    expect(searchCatalogEntries({ q: 'Sunrise Special', page: 1, limit: 50, skip: 0 }).total).toBe(1)
    expect(searchCatalogEntries({ q: 'Volcano Discovery', page: 1, limit: 50, skip: 0 }).total).toBe(0)
  })
})
