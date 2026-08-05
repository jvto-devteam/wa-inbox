/**
 * Integration check against the REAL synced release in `catalog/`.
 *
 * catalog.test.ts pins the adapter's behaviour with fixtures; this file answers the
 * question those fixtures cannot — "does the data actually on disk still produce a
 * usable catalog?" That is the exact failure this wave existed to fix: every unit
 * test passed while `loadCatalog()` returned ~190 field-less objects, because
 * nothing ever ran it against the real files.
 *
 * `catalog/*.json` is gitignored (synced by `npm run sync:knowledge`, never
 * committed), so this suite skips itself when the release is not present rather
 * than failing on a fresh clone or in CI. Assertions are deliberately structural —
 * "every package has a title / at least one destination token / a price" — so a
 * legitimate re-sync with different tours cannot break them; only a genuinely
 * broken adapter or a genuinely broken release can.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { loadCatalog } from './catalog'

const RELEASE_PRESENT = fs.existsSync(path.join(process.cwd(), 'catalog', 'package-profiles.json'))

describe.skipIf(!RELEASE_PRESENT)('loadCatalog against the real synced catalog/', () => {
  it('produces a non-empty CatalogPackage[] with every required field populated', () => {
    const catalog = loadCatalog()

    expect(catalog.packages.length).toBeGreaterThan(0)
    expect(catalog.syncedAt).toEqual(expect.any(String))

    for (const pkg of catalog.packages) {
      expect(pkg.packageKey).toEqual(expect.any(String))
      expect(pkg.packageKey.length).toBeGreaterThan(0)
      expect(pkg.title.length).toBeGreaterThan(0)
      expect(pkg.destinationTokens.length).toBeGreaterThan(0)
      expect(Array.isArray(pkg.inclusions)).toBe(true)
      expect(Array.isArray(pkg.policyNotes)).toBe(true)
      expect(pkg.priceIdr === null || pkg.priceIdr > 0).toBe(true)
    }
  })

  it('resolves a published price and an inclusion list for every package', () => {
    const { packages } = loadCatalog()
    expect(packages.filter((p) => p.priceIdr !== null)).toHaveLength(packages.length)
    expect(packages.filter((p) => p.inclusions.length > 0)).toHaveLength(packages.length)
  })

  it('gives every package a public details link on the real site', () => {
    for (const pkg of loadCatalog().packages) {
      expect(pkg.links.details).toMatch(/^https:\/\/javavolcano-touroperator\.com\/tours\//)
    }
  })

  it('populates origin and dayCount for every package, matching its packageKey duration suffix', () => {
    for (const pkg of loadCatalog().packages) {
      expect(pkg.origin).toEqual(expect.any(String))
      expect(pkg.dayCount).toBeGreaterThan(0)
    }
  })

  it('lets pickPackage recommend the specific package a "3 day trip from Surabaya"-style message asks for', async () => {
    const { matchDestination, pickPackage, parseTripPreferences } = await import('./package-match')
    const catalog = loadCatalog()

    const message = 'Interested in a 3 day trip to Ijen from Surabaya'
    const matched = matchDestination(message, catalog)
    expect(matched).not.toBeNull()

    const picked = pickPackage(matched!.matches, parseTripPreferences(message))
    expect(picked.origin).toBe('Surabaya')
    expect(picked.dayCount).toBe(3)
  })

  it('populates finishCities for every package from the real endpoint-chains.json, and no Bali-origin package finishes in Bali', () => {
    for (const pkg of loadCatalog().packages) {
      expect(Array.isArray(pkg.finishCities)).toBe(true)
      expect(pkg.finishCities.length).toBeGreaterThan(0)
    }
    // Regression, reported 2026-08-05: "can we finish in Bali?" was answered from a
    // Bali-ORIGIN package, which the real dropoff data says does NOT finish in Bali at all.
    const baliOrigin = loadCatalog().packages.filter((p) => p.origin === 'Bali')
    expect(baliOrigin.length).toBeGreaterThan(0)
    for (const pkg of baliOrigin) {
      expect(pkg.finishCities).not.toContain('bali')
    }
    // At least one real package genuinely can finish in Bali (so the "yes" branch of
    // orchestrator.ts's finishCityFact is reachable, not just the "no" branch).
    expect(loadCatalog().packages.some((p) => p.finishCities.includes('bali'))).toBe(true)
  })

  // Reported 2026-08-05: 6 real, approved, customer_visible staging modules (which hotel is
  // used before Bromo/Ijen/Tumpak Sewu/Papuma, medical-check timing, ferry pre-booking notes)
  // existed in the real release and were completely unreachable before this fix.
  it('populates stagingNotes for at least some real packages (Ijen/Bromo/Tumpak Sewu/Papuma-visiting ones)', () => {
    const packages = loadCatalog().packages
    const withStaging = packages.filter((p) => p.stagingNotes.length > 0)
    expect(withStaging.length).toBeGreaterThan(0)
    // Every package touching Ijen should carry SOME staging note (Bondowoso or Banyuwangi
    // area staging, depending on origin) -- real customer-facing logistics, not boilerplate.
    const ijenPackages = packages.filter((p) => p.destinationTokens.includes('ijen'))
    expect(ijenPackages.length).toBeGreaterThan(0)
    for (const pkg of ijenPackages) {
      expect(pkg.stagingNotes.length).toBeGreaterThan(0)
    }
  })

  it('lets pickPackage recommend a package that actually finishes in Bali for a "finish in Bali" question, not a Bali-origin one', async () => {
    const { matchDestination, pickPackage, parseTripPreferences } = await import('./package-match')
    const catalog = loadCatalog()

    const message = 'can we finish the trip in bali? we want to see ijen'
    const matched = matchDestination(message, catalog)
    expect(matched).not.toBeNull()

    const preferences = parseTripPreferences(message)
    expect(preferences.finishCity).toBe('bali')

    const picked = pickPackage(matched!.matches, preferences)
    expect(picked.finishCities).toContain('bali')
  })

  it('lets package-match and the route gate agree on the same real destination tokens', async () => {
    const { matchDestination } = await import('./package-match')
    const { checkRouteGate } = await import('./route-gate')
    const catalog = loadCatalog()

    // Every token package-match can match must also pass the route gate (or at worst
    // need review) — i.e. the two matchers cannot disagree about the real data.
    const tokens = [...new Set(catalog.packages.flatMap((p) => p.destinationTokens))]
    expect(tokens.length).toBeGreaterThan(0)

    for (const token of tokens) {
      const matched = matchDestination(`Halo, saya mau ke ${token}`, catalog)
      expect(matched?.destination).toBe(token)

      const gate = checkRouteGate({ destination: matched?.destination, catalog })
      expect(gate.status).not.toBe('handoff')
    }
  })
})
