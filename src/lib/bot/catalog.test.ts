import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import { loadCatalog } from './catalog'

// NOTE: bare `vi.mock('fs')` (per the task brief) does not automock the
// built-in `fs` module's methods in this environment (Vitest 4.1.10 /
// Node 25.2.1) — `fs.existsSync` etc. remain the real implementations
// instead of `vi.fn()`s. This is a known Vitest limitation for built-in
// modules (see https://vitest.dev/guide/mocking/file-system.html), so we
// use an explicit factory to force real mock functions while keeping the
// test's behavior and assertions identical to the brief.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
      readdirSync: vi.fn(),
      readFileSync: vi.fn(),
    },
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
  }
})

/**
 * Serves a fake `catalog/` directory from an in-memory `{ filename: json }` map.
 * A filename absent from the map is reported as missing, exactly like a partial
 * sync would look on disk — which is the degradation path most of these tests
 * exercise.
 */
function mockCatalogFiles(files: Record<string, unknown>) {
  vi.mocked(fs.existsSync).mockImplementation((p) => {
    const name = String(p).split('/').pop()!
    return name === 'catalog' || Object.prototype.hasOwnProperty.call(files, name)
  })
  vi.mocked(fs.readFileSync).mockImplementation((p) => {
    const name = String(p).split('/').pop()!
    const contents = files[name]
    return typeof contents === 'string' ? contents : JSON.stringify(contents)
  })
}

// Realistic shapes, trimmed to the fields the adapter reads. Field names and
// nesting match the real synced release (catalog/*.json, release
// customer-sales-release-20260628-001) exactly.
const PROFILES = [
  {
    package_key: 'bali/bromo-ijen-3d2n',
    slug: 'bromo-ijen-3d2n',
    title: '3 Day Bromo & Ijen Volcano Discovery from Bali',
    destination_tokens: ['bromo', 'ijen'],
    public_url: '/tours/from-bali/bromo-ijen-3d2n',
  },
  {
    package_key: 'bromo-1d1n',
    slug: 'bromo-1d1n',
    title: '1 Day Bromo Midnight Experience from Surabaya',
    destination_tokens: ['bromo'],
    public_url: '/tours/from-surabaya/bromo-1d1n',
  },
]

const PRICE_TIERS = [
  {
    package_key: 'bali/bromo-ijen-3d2n',
    price_type: 'published_standard',
    currency: 'IDR',
    pax_tiers: [
      { min_pax: 2, max_pax: 2, idr_per_person: 4050000 },
      { min_pax: 3, max_pax: 3, idr_per_person: 3800000 },
      { min_pax: 11, max_pax: null, idr_per_person: 2850000 },
    ],
  },
  // NOTE: no entry for `bromo-1d1n` — the "unpriced package" case.
]

const COMPONENTS = [
  {
    package_key: 'bali/bromo-ijen-3d2n',
    included: ['private transport (dedicated vehicle)', 'ferry crossing (East Java – Bali)'],
    excluded: ['international/domestic flights', 'visas', 'tips'],
  },
]

const MODULE_COMPATIBILITY = {
  destination_to_packages: {
    destination_bromo: ['bali/bromo-ijen-3d2n', 'bromo-1d1n'],
    // The real file repeats package keys within a list; the adapter must dedupe.
    destination_ijen: ['bali/bromo-ijen-3d2n', 'bali/bromo-ijen-3d2n'],
  },
  module_applicability: {
    policy_booking_paths: ['bali/bromo-ijen-3d2n', 'bromo-1d1n'],
    policy_ijen_health_screening: ['bali/bromo-ijen-3d2n'],
    policy_isic_student: ['bali/bromo-ijen-3d2n', 'bromo-1d1n'],
    staging_bromo_area_sunrise: ['bali/bromo-ijen-3d2n', 'bali/bromo-ijen-3d2n'],
  },
}

const GENERAL_MODULES = [
  {
    module_id: 'policy_booking_paths',
    category: 'policy',
    scope: 'global',
    title: 'How to Book',
    short_answer: 'JVTO accepts bookings only through the official website.',
    customer_visible: true,
    approval_status: 'approved',
  },
  {
    module_id: 'policy_ijen_health_screening',
    category: 'policy',
    scope: 'ijen_scoped',
    title: 'Ijen Health Screening',
    short_answer: 'A health certificate is mandatory for every guest before crater entry.',
    customer_visible: true,
    approval_status: 'approved',
  },
  {
    module_id: 'policy_isic_student',
    category: 'policy',
    scope: 'conditional_eligible',
    title: 'ISIC Student Pricing',
    short_answer: 'Student pricing is available to verified ISIC cardholders.',
    customer_visible: true,
    approval_status: 'approved',
  },
  {
    module_id: 'staging_bromo_area_sunrise',
    category: 'staging',
    scope: 'route_scoped',
    title: 'Why We Stage Near Bromo',
    short_answer: 'Early jeep pickup; takeaway breakfast possible.',
    customer_visible: true,
    approval_status: 'approved',
  },
]

const LINK_REGISTRY = { base_url: 'https://javavolcano-touroperator.com', links: [] }

const FULL_CATALOG = {
  'package-profiles.json': PROFILES,
  'standard-price-tiers.json': PRICE_TIERS,
  'component-matrices.json': COMPONENTS,
  'module-compatibility.json': MODULE_COMPATIBILITY,
  'general-modules.json': GENERAL_MODULES,
  'customer-link-registry.json': LINK_REGISTRY,
  'meta.json': { syncedAt: '2026-07-26T03:00:21.157Z' },
}

describe('loadCatalog', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => warn.mockRestore())

  it('joins package profiles, price tiers, and component matrices on package_key', () => {
    mockCatalogFiles(FULL_CATALOG)

    const catalog = loadCatalog()

    expect(catalog.packages).toHaveLength(2)
    expect(catalog.syncedAt).toBe('2026-07-26T03:00:21.157Z')

    const combined = catalog.packages.find((p) => p.packageKey === 'bali/bromo-ijen-3d2n')!
    expect(combined.title).toBe('3 Day Bromo & Ijen Volcano Discovery from Bali')
    expect(combined.inclusions).toEqual([
      'private transport (dedicated vehicle)',
      'ferry crossing (East Java – Bali)',
    ])
    // `excluded` must never leak into `inclusions`.
    expect(combined.inclusions).not.toContain('visas')
  })

  it('takes the LOWEST pax tier as the "starting from" priceIdr', () => {
    mockCatalogFiles(FULL_CATALOG)
    const combined = loadCatalog().packages.find((p) => p.packageKey === 'bali/bromo-ijen-3d2n')!
    expect(combined.priceIdr).toBe(2850000)
  })

  it('leaves priceIdr null (rather than crashing) for a package with no price-tier entry', () => {
    mockCatalogFiles(FULL_CATALOG)
    const unpriced = loadCatalog().packages.find((p) => p.packageKey === 'bromo-1d1n')!
    expect(unpriced.priceIdr).toBeNull()
    // ...and it is still a usable package otherwise — route-gate.ts is what decides
    // that a null price means "hand off", not the loader.
    expect(unpriced.title).toBe('1 Day Bromo Midnight Experience from Surabaya')
  })

  it('leaves priceIdr null when a price entry exists but carries no usable tier value', () => {
    mockCatalogFiles({
      ...FULL_CATALOG,
      'standard-price-tiers.json': [
        { package_key: 'bromo-1d1n', pax_tiers: [{ min_pax: 2, idr_per_person: null }, { min_pax: 4 }] },
      ],
    })
    const unpriced = loadCatalog().packages.find((p) => p.packageKey === 'bromo-1d1n')!
    expect(unpriced.priceIdr).toBeNull()
  })

  it('takes destination tokens from the curated destination_to_packages taxonomy, deduped', () => {
    mockCatalogFiles(FULL_CATALOG)
    const packages = loadCatalog().packages
    expect(packages.find((p) => p.packageKey === 'bali/bromo-ijen-3d2n')!.destinationTokens).toEqual(['bromo', 'ijen'])
    expect(packages.find((p) => p.packageKey === 'bromo-1d1n')!.destinationTokens).toEqual(['bromo'])
  })

  it('converts snake_cased destination node ids into the spaced form a customer types', () => {
    mockCatalogFiles({
      ...FULL_CATALOG,
      'module-compatibility.json': {
        ...MODULE_COMPATIBILITY,
        destination_to_packages: { destination_tumpak_sewu: ['bromo-1d1n'] },
      },
    })
    const pkg = loadCatalog().packages.find((p) => p.packageKey === 'bromo-1d1n')!
    expect(pkg.destinationTokens).toEqual(['tumpak sewu'])
  })

  it("falls back to the profile's own destination_tokens when module-compatibility.json is missing", () => {
    const withoutCompatibility = { ...FULL_CATALOG }
    delete (withoutCompatibility as Partial<typeof FULL_CATALOG>)['module-compatibility.json']
    mockCatalogFiles(withoutCompatibility)

    const combined = loadCatalog().packages.find((p) => p.packageKey === 'bali/bromo-ijen-3d2n')!
    expect(combined.destinationTokens).toEqual(['bromo', 'ijen'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('module-compatibility.json is missing'))
  })

  // The load-bearing policy filter: `policyNotes.length > 0` is what route-gate.ts
  // reads as `needs_review`, so including the company-wide policies (which apply to
  // all 16 packages) would make that gate constant-true and dump ~8 boilerplate
  // paragraphs into every funnel reply.
  it('includes only package-scoped policy modules in policyNotes, not global or conditional ones', () => {
    mockCatalogFiles(FULL_CATALOG)
    const packages = loadCatalog().packages

    expect(packages.find((p) => p.packageKey === 'bali/bromo-ijen-3d2n')!.policyNotes).toEqual([
      'Ijen Health Screening: A health certificate is mandatory for every guest before crater entry.',
    ])
    // Only global + conditional policies apply to this one, so it stays `clear`.
    expect(packages.find((p) => p.packageKey === 'bromo-1d1n')!.policyNotes).toEqual([])
  })

  // Reported 2026-08-05: 6 real, approved, customer_visible `category: "staging"` modules
  // (which hotel/staging area is used before an activity) existed in general-modules.json and
  // were joined via the exact same module_applicability mechanism as policyNotes, but were
  // completely unreachable because the join only ever looked at `category: "policy"`.
  it('includes staging modules in stagingNotes via the same module_applicability join as policyNotes, deduped', () => {
    mockCatalogFiles(FULL_CATALOG)
    const packages = loadCatalog().packages

    expect(packages.find((p) => p.packageKey === 'bali/bromo-ijen-3d2n')!.stagingNotes).toEqual([
      'Why We Stage Near Bromo: Early jeep pickup; takeaway breakfast possible.',
    ])
    expect(packages.find((p) => p.packageKey === 'bromo-1d1n')!.stagingNotes).toEqual([])
  })

  it('excludes policy modules that are not customer-visible or not approved', () => {
    mockCatalogFiles({
      ...FULL_CATALOG,
      'general-modules.json': [
        { ...GENERAL_MODULES[1], module_id: 'policy_hidden', customer_visible: false },
        { ...GENERAL_MODULES[1], module_id: 'policy_draft', approval_status: 'draft' },
      ],
      'module-compatibility.json': {
        ...MODULE_COMPATIBILITY,
        module_applicability: {
          policy_hidden: ['bali/bromo-ijen-3d2n'],
          policy_draft: ['bali/bromo-ijen-3d2n'],
        },
      },
    })
    expect(loadCatalog().packages.find((p) => p.packageKey === 'bali/bromo-ijen-3d2n')!.policyNotes).toEqual([])
  })

  it('builds the details link from the registry base_url and the profile public_url', () => {
    mockCatalogFiles(FULL_CATALOG)
    const combined = loadCatalog().packages.find((p) => p.packageKey === 'bali/bromo-ijen-3d2n')!
    expect(combined.links).toEqual({
      details: 'https://javavolcano-touroperator.com/tours/from-bali/bromo-ijen-3d2n',
    })
    // The registry's `booking_start` links are `prefill_unverified`, so no booking link.
    expect(combined.links.booking).toBeUndefined()
  })

  it('skips a malformed package with a warning instead of crashing or including it', () => {
    mockCatalogFiles({
      ...FULL_CATALOG,
      'package-profiles.json': [
        PROFILES[0],
        { package_key: 'no-title-1d', destination_tokens: ['bromo'] },
        { title: 'Untitled but keyless', destination_tokens: ['bromo'] },
        { package_key: '   ', title: '   ' },
        'not even an object',
      ],
    })

    const packages = loadCatalog().packages

    expect(packages.map((p) => p.packageKey)).toEqual(['bali/bromo-ijen-3d2n'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('skipping malformed package'))
  })

  it('skips a duplicate package_key rather than listing the same tour twice', () => {
    mockCatalogFiles({ ...FULL_CATALOG, 'package-profiles.json': [PROFILES[0], PROFILES[0]] })

    expect(loadCatalog().packages).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('duplicate package_key'))
  })

  it('degrades to an empty catalog (with a warning) when a source file is not valid JSON', () => {
    mockCatalogFiles({ ...FULL_CATALOG, 'package-profiles.json': '{ this is not json' })

    expect(loadCatalog().packages).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'), expect.anything())
  })

  it('warns and loads no packages when package-profiles.json is not an array', () => {
    mockCatalogFiles({ ...FULL_CATALOG, 'package-profiles.json': { packages: [] } })

    expect(loadCatalog().packages).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('to be an array'))
  })

  it('still loads packages when only the profile spine is present (fully partial sync)', () => {
    mockCatalogFiles({ 'package-profiles.json': PROFILES })

    const packages = loadCatalog().packages

    expect(packages).toHaveLength(2)
    expect(packages[0].priceIdr).toBeNull()
    expect(packages[0].inclusions).toEqual([])
    expect(packages[0].policyNotes).toEqual([])
    // No link registry -> no base_url -> no half-formed relative link is emitted.
    expect(packages[0].links).toEqual({})
    // Profile tokens are still available as the fallback taxonomy.
    expect(packages[0].destinationTokens).toEqual(['bromo', 'ijen'])
  })

  it('warns about a package that has no destination tokens at all, since it can never match', () => {
    mockCatalogFiles({
      ...FULL_CATALOG,
      'package-profiles.json': [{ package_key: 'orphan-1d', title: 'Orphan Tour' }],
      'module-compatibility.json': { destination_to_packages: {}, module_applicability: {} },
    })

    expect(loadCatalog().packages[0].destinationTokens).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no destination tokens'))
  })

  it('returns an empty catalog when catalog/ has not been synced yet', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const catalog = loadCatalog()
    expect(catalog.packages).toEqual([])
    expect(catalog.syncedAt).toBeNull()
  })
})
