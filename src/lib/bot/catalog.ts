/**
 * Catalog adapter -- turns the *synced release data* under `catalog/` (written by
 * `scripts/sync-agent-catalog.ts` from jvto-whatsapp-agent-runtime's
 * `catalog/agent-catalog/` + `catalog/customer-sales/`) into the flat
 * `CatalogPackage[]` shape the bot brain (funnel.ts, route-gate.ts,
 * response-composer.ts) actually consumes.
 *
 * --- Why this file is an explicit adapter and not a generic loader ---
 *
 * The previous implementation walked `catalog/`, `JSON.parse`d every `*.json`
 * file, and spread any top-level array straight into `packages`. Nothing in the
 * synced release is shaped like a `CatalogPackage`: the release is a *normalized,
 * multi-file* dataset joined on `package_key` (16 packages x ~10 per-package
 * files + several registry/manifest objects). So the old loader produced ~190
 * objects with none of the fields the bot reads (`packageKey`, `title`,
 * `priceIdr`, ...) -- every one of them `undefined` -- which made
 * `p.destination.toLowerCase()` in route-gate.ts throw and took the whole
 * orchestrator down its fail-safe handoff path on every Mode 1/2 message. Modes
 * 1/2 were therefore dead in production despite being individually built and
 * tested. This adapter is the join the data always needed.
 *
 * --- The join (all sources are real files in `catalog/`, verified 2026-07-27) ---
 *
 *   package-profiles.json      (array, 16) -- the spine: `package_key`, `title`,
 *                                 `public_url`, `slug`, `destination_tokens`.
 *   standard-price-tiers.json  (array, 16) -- `pax_tiers[] {min_pax, max_pax,
 *                                 idr_per_person}`, joined on `package_key`.
 *   component-matrices.json    (array, 16) -- `included[]` / `excluded[]`,
 *                                 joined on `package_key`.
 *   module-compatibility.json  (object)    -- `destination_to_packages`
 *                                 (destination -> package_key[]) and
 *                                 `module_applicability` (module_id ->
 *                                 package_key[]).
 *   general-modules.json       (array, 67) -- the module texts referenced by
 *                                 `module_applicability`, incl. the policy cards
 *                                 with `short_answer` / `scope` / `approval_status`.
 *   customer-link-registry.json (object)   -- `base_url` for the public site.
 *   endpoint-chains.json       (array, 16) -- `standard_dropoff_options`, joined on
 *                                 `package_key` into `finishCities` (added 2026-08-05: "can
 *                                 we finish in Bali?" was being answered from `origin` alone,
 *                                 which cannot tell "starts in Bali" from "ends in Bali" --
 *                                 they're a real, different set of cities per package).
 *   accommodation-rules.json   (array, 16) -- `overnights[]` / `rooming_assumption`, joined on
 *                                 `package_key`.
 *   vehicle-and-luggage-rules.json (array, 16) -- `vehicle_category` / `luggage_rule`, joined on
 *                                 `package_key`.
 *   guide-support-rules.json   (array, 16) -- `crew_roles` / `language_note`, joined on
 *                                 `package_key`. (Added together 2026-09-03: three release files
 *                                 that shipped with the catalog and that nothing in `src/` ever
 *                                 opened -- "which hotel do we stay at?" was being deferred to
 *                                 the package page by a disclosure in knowledge.ts even though
 *                                 the real names were sitting in accommodation-rules.json the
 *                                 whole time.)
 *
 * `meta.json` (`syncedAt`) is read exactly as before. `deployment-gate.json` is
 * not read here at all (deployment-gate.ts owns it). Every other file in
 * `catalog/` carries operational detail that `CatalogPackage` has no field for and is
 * deliberately ignored rather than half-mapped.
 *
 * --- Field-by-field judgment calls ---
 *
 * `priceIdr` <- the LOWEST `idr_per_person` across the package's `pax_tiers`.
 *   The catalog's published price is a per-pax tier ladder (larger group => lower
 *   per-person price), but `CatalogPackage.priceIdr` is a single number. The
 *   lowest tier is the "starting from" price, which is exactly how the only
 *   consumer renders it (funnel.ts: `from Rp ${priceIdr}/person`). A package with
 *   no price entry, or an entry with no usable tier, gets `null` -- route-gate.ts
 *   already treats a null price as "not yet route-clean" and hands off, which is
 *   the correct fail-safe for a package we cannot quote.
 *
 * `priceTiers` <- `pax_tiers[]` verbatim (min/max pax + price), see that field's own header in
 *   types.ts. Added 2026-08-05 alongside `priceIdr`, not instead of it -- orchestrator.ts picks
 *   the correct tier once a customer's group size is known, falling back to `priceIdr`'s
 *   "starting from" framing when it isn't.
 *
 * `inclusions` <- `component-matrices.json`'s `included[]` verbatim. `excluded[]`
 *   and `conditional[]` have no `CatalogPackage` field and are dropped rather
 *   than merged into `inclusions` (merging them would let response-composer.ts
 *   emit "Termasuk: ... visas, tips" -- the exact opposite of the truth).
 *
 * `destinationTokens` <- the keys of `module-compatibility.json`'s
 *   `destination_to_packages` (`destination_bromo` -> `bromo`,
 *   `destination_tumpak_sewu` -> `tumpak sewu`), i.e. the release's own curated
 *   destination taxonomy (5 destinations; the same 5 that destination-guidance.json
 *   documents and that location-aliases.json assigns aliases to). Deliberately NOT
 *   `package-profiles.json`'s own `destination_tokens`, which is slug-derived and
 *   noisy: it splits "Tumpak Sewu" into `["tumpak","sewu"]` and "Taman Safari
 *   Prigen" into `["taman","safari","prigen"]`, none of which is a destination a
 *   customer would name. The profile tokens are used only as a fallback if
 *   module-compatibility.json is missing or malformed, so a partial sync degrades
 *   to fuzzy matching rather than to no matching at all.
 *
 *   Aliases (location-aliases.json) are intentionally NOT expanded into the token
 *   list: every alias there is a superset string of the canonical token ("Mount
 *   Bromo", "Ijen Crater", "Tumpak Sewu Waterfall"), and funnel.ts matches tokens
 *   as substrings of the customer's message, so the canonical token already
 *   matches every alias -- including Indonesian phrasings the alias list does not
 *   even carry ("gunung bromo", "kawah ijen").
 *
 * `policyNotes` <- the package-scoped, customer-visible, approved `policy` modules
 *   that `module_applicability` links to this package, rendered as
 *   "`title`: `short_answer`".
 *
 *   This is a *filtered* view of the policy layer, and the filter is the load-bearing
 *   judgment call. `general-modules.json` carries 10 policy modules with a declared
 *   `scope`: 6 `global`, 2 `ijen_scoped`, 1 `conditional_eligible` (ISIC student
 *   pricing), 1 `conditional_large_group` (police escort). `module_applicability`
 *   attaches all 6 global ones plus both conditional ones to all 16 packages.
 *   Including them would make `policyNotes` non-empty for every package, and
 *   `policyNotes.length > 0` is precisely the signal route-gate.ts reads to decide
 *   `needs_review` -- a gate condition that is true for every package is not a gate.
 *   It would also append ~8 boilerplate paragraphs to every funnel reply.
 *
 *   So only package-scoped policies are included (`scope` is neither `global` nor
 *   `conditional_*`): for the current release that is Ijen health screening and the
 *   Ijen monthly closure, on the 13 packages that visit Ijen. Those are genuine
 *   per-package disclosures ("a health certificate is mandatory for every guest"),
 *   which is exactly what route-gate.ts's `needs_review` and funnel.ts's disclosure
 *   block are for. `conditional_*` policies are excluded on top of that because they
 *   apply only under a customer-side condition (being a student, being a large
 *   group) that the catalog cannot evaluate -- stating them unconditionally would
 *   assert something that may not apply. The global policies are not lost: they are
 *   company-wide FAQ material (Mode 2), not per-package route disclosures.
 *
 * `stagingNotes` <- the exact same join as `policyNotes`, just for `category: "staging"`
 *   instead of `"policy"` (added 2026-08-05, `buildNoteIndex`). No scope-driven exclusion
 *   applies -- unlike the policy layer, all 6 staging modules already carry `scope:
 *   "route_scoped"` (never `global`/`conditional_*`), so every one of them is genuinely
 *   package-specific and safe to surface. Unlike `policyNotes`, these are informational
 *   ("which hotel is used before this activity"), not disclosures/caveats, so orchestrator.ts
 *   surfaces them unconditionally as ordinary facts rather than gating them on
 *   route-gate.ts's `needs_review` status.
 *
 * `links` <- `{ details: <customer-link-registry base_url> + <profile public_url> }`.
 *   The registry's `links[]` entries are keyed by `link_key` and their `used_by`
 *   points at *module ids*, not package keys; the 16 `package_page` entries have
 *   `used_by: null` and their `link_key` is slug-derived, which COLLIDES for the
 *   from-Bali and from-Surabaya variants of the same slug (e.g.
 *   `package_ijen_papuma_tumpak_sewu_bromo_4d3n` appears twice with different URLs).
 *   `public_url` on the profile is unambiguous and reconstructs the same URL, so it
 *   is the join used. The 16 `booking_start` entries are deliberately NOT surfaced:
 *   they carry `status: "prefill_unverified"` and the registry's own notes say the
 *   `?package=` param "is not yet wired" -- sending a customer a link that does not
 *   preselect their package is worse than sending none. (response-composer.ts reads
 *   `links.booking` for its how-to-book line; that key stays absent until the
 *   prefill is verified, and the composer already handles its absence.)
 */
import fs from 'fs'
import path from 'path'
import type { Catalog, CatalogPackage } from './types'

export const CATALOG_DIR = path.join(process.cwd(), 'catalog')

const PROFILES_FILE = 'package-profiles.json'
const PRICE_TIERS_FILE = 'standard-price-tiers.json'
const COMPONENTS_FILE = 'component-matrices.json'
const MODULE_COMPATIBILITY_FILE = 'module-compatibility.json'
const GENERAL_MODULES_FILE = 'general-modules.json'
const LINK_REGISTRY_FILE = 'customer-link-registry.json'
const ENDPOINT_CHAINS_FILE = 'endpoint-chains.json'
const META_FILE = 'meta.json'
const ACCOMMODATION_FILE = 'accommodation-rules.json'
const VEHICLE_FILE = 'vehicle-and-luggage-rules.json'
const GUIDE_FILE = 'guide-support-rules.json'

const DESTINATION_KEY_PREFIX = 'destination_'
const FINISH_CITY_TOKENS = ['bali', 'surabaya', 'malang', 'ketapang']

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : []
}

function asPositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

/**
 * Reads one file from `catalog/`. A missing or malformed file is a *degradation*,
 * never a crash: the bot loses whatever that file contributed (a price, an
 * inclusion list) and keeps serving the rest, with a `console.warn` for the
 * operator. Throwing here would take out the orchestrator's entire Mode 1/2 path.
 */
export function readCatalogFile(fileName: string): unknown {
  const filePath = path.join(CATALOG_DIR, fileName)
  if (!fs.existsSync(filePath)) {
    console.warn(`loadCatalog: catalog/${fileName} is missing — continuing without it`)
    return null
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch (error) {
    console.warn(`loadCatalog: catalog/${fileName} is not valid JSON — skipped`, error)
    return null
  }
}

/** Indexes an array of `{ package_key, ... }` release objects by `package_key`. */
function indexByPackageKey(parsed: unknown, fileName: string): Map<string, Json> {
  const index = new Map<string, Json>()
  if (parsed === null) return index
  if (!Array.isArray(parsed)) {
    console.warn(`loadCatalog: expected catalog/${fileName} to be an array — ignored`)
    return index
  }
  for (const entry of parsed) {
    if (!isObject(entry)) continue
    const key = asString(entry.package_key)
    if (key) index.set(key, entry)
  }
  return index
}

/**
 * Lowest published per-person price across the tier ladder ("starting from").
 * Non-numeric, non-finite and non-positive tier values are ignored rather than
 * trusted, so a partially-synced tier cannot produce a `Rp 0/person` quote.
 */
function lowestTierPriceIdr(entry: Json | undefined): number | null {
  if (!entry) return null
  const tiers = Array.isArray(entry.pax_tiers) ? entry.pax_tiers : []
  const prices = tiers
    .map((tier) => (isObject(tier) ? tier.idr_per_person : null))
    .filter((price): price is number => typeof price === 'number' && Number.isFinite(price) && price > 0)
  return prices.length > 0 ? Math.min(...prices) : null
}

/**
 * The full per-group-size price ladder (CatalogPackage.priceTiers -- see that field's own
 * header for why this exists alongside `priceIdr`), sorted ascending by `min_pax`. Same
 * validation as `lowestTierPriceIdr`: a tier with a non-numeric/non-finite/non-positive price,
 * or a non-positive `min_pax`, is dropped rather than trusted.
 */
function parsePriceTiers(entry: Json | undefined): Array<{ minPax: number; maxPax: number | null; priceIdr: number }> {
  if (!entry) return []
  const tiers = Array.isArray(entry.pax_tiers) ? entry.pax_tiers : []
  const parsed: Array<{ minPax: number; maxPax: number | null; priceIdr: number }> = []
  for (const tier of tiers) {
    if (!isObject(tier)) continue
    const minPax = tier.min_pax
    const priceIdr = tier.idr_per_person
    if (typeof minPax !== 'number' || !Number.isFinite(minPax) || minPax <= 0) continue
    if (typeof priceIdr !== 'number' || !Number.isFinite(priceIdr) || priceIdr <= 0) continue
    const maxPax = typeof tier.max_pax === 'number' && Number.isFinite(tier.max_pax) ? tier.max_pax : null
    parsed.push({ minPax, maxPax, priceIdr })
  }
  return parsed.sort((a, b) => a.minPax - b.minPax)
}

/** `destination_to_packages` -> `package_key` -> canonical destination tokens. */
function buildDestinationIndex(moduleCompatibility: unknown): Map<string, string[]> {
  const index = new Map<string, string[]>()
  if (!isObject(moduleCompatibility)) return index
  const byDestination = moduleCompatibility.destination_to_packages
  if (!isObject(byDestination)) return index

  for (const [destinationKey, packageKeys] of Object.entries(byDestination)) {
    if (!destinationKey.startsWith(DESTINATION_KEY_PREFIX)) continue
    // `destination_tumpak_sewu` -> `tumpak sewu`: the node id is snake_cased, but
    // customers type it with a space, and funnel.ts matches tokens as substrings.
    const token = destinationKey.slice(DESTINATION_KEY_PREFIX.length).replace(/_/g, ' ').trim()
    if (!token) continue
    for (const packageKey of asStringArray(packageKeys)) {
      const tokens = index.get(packageKey) ?? []
      if (!tokens.includes(token)) tokens.push(token)
      index.set(packageKey, tokens)
    }
  }
  return index
}

/**
 * `module_applicability` x `general-modules.json` -> `package_key` -> customer-facing note
 * lines, for one module `category` at a time. Originally policy-only (`buildPolicyNoteIndex`);
 * generalized 2026-08-05 after finding this exact join already exists for `category: "staging"`
 * modules too (6 real,
 * approved, customer_visible modules -- which hotel/staging area is used before Bromo/Ijen/
 * Tumpak Sewu/Papuma, medical-check timing, ferry pre-booking notes) but the hardcoded
 * `category !== 'policy'` filter silently dropped every one of them: same class of bug as the
 * Ijen gas-mask gap (knowledge.ts), real approved content nothing ever read.
 *
 * `scope` filtering only applies to policy (global/conditional_* policies are meant to surface
 * some other way, per the original policy-only header note); staging modules all carry
 * `scope: "route_scoped"`, which isn't global or conditional, so the same filter is harmless
 * to share.
 */
function buildNoteIndex(moduleCompatibility: unknown, generalModules: unknown, category: string): Map<string, string[]> {
  const index = new Map<string, string[]>()
  if (!isObject(moduleCompatibility) || !Array.isArray(generalModules)) return index
  const applicability = moduleCompatibility.module_applicability
  if (!isObject(applicability)) return index

  const noteByModuleId = new Map<string, string>()
  for (const generalModule of generalModules) {
    if (!isObject(generalModule)) continue
    if (generalModule.category !== category) continue
    if (generalModule.customer_visible !== true) continue
    if (generalModule.approval_status !== 'approved') continue
    const scope = asString(generalModule.scope)
    if (!scope || scope === 'global' || scope.startsWith('conditional')) continue
    const moduleId = asString(generalModule.module_id)
    const shortAnswer = asString(generalModule.short_answer)
    if (!moduleId || !shortAnswer) continue
    const title = asString(generalModule.title)
    noteByModuleId.set(moduleId, title ? `${title}: ${shortAnswer}` : shortAnswer)
  }

  for (const [moduleId, packageKeys] of Object.entries(applicability)) {
    const note = noteByModuleId.get(moduleId)
    if (!note) continue
    // The applicability lists contain duplicate package keys in the real release
    // (e.g. `destination_bromo` lists all 15 Bromo packages twice), so dedupe.
    for (const packageKey of new Set(asStringArray(packageKeys))) {
      const notes = index.get(packageKey) ?? []
      if (!notes.includes(note)) notes.push(note)
      index.set(packageKey, notes)
    }
  }
  return index
}

/**
 * `endpoint-chains.json`'s `standard_dropoff_options` -> `package_key` -> which cities this
 * package can actually END in, normalized to lowercase single-word tokens. A Bali-origin
 * package's own dropoff options are all Surabaya/Malang-area (verified 2026-08-05: none of the
 * 4 Bali-origin packages list "Bali" as a dropoff option at all) -- `origin` alone cannot
 * answer "can we finish in Bali?", only this can.
 */
function buildFinishCityIndex(endpointChains: unknown): Map<string, string[]> {
  const index = new Map<string, string[]>()
  if (!Array.isArray(endpointChains)) return index
  for (const entry of endpointChains) {
    if (!isObject(entry)) continue
    const packageKey = asString(entry.package_key)
    if (!packageKey) continue
    const cities = new Set<string>()
    for (const option of asStringArray(entry.standard_dropoff_options)) {
      const lower = option.toLowerCase()
      for (const city of FINISH_CITY_TOKENS) {
        if (lower.includes(city)) cities.add(city)
      }
    }
    if (cities.size > 0) index.set(packageKey, [...cities])
  }
  return index
}

/**
 * `accommodation-rules.json`'s `rooming_assumption` is boilerplate the release writer applied to
 * every row regardless of whether the package actually has an overnight -- `bromo-1d1n` (the
 * one same-day, zero-overnight package) carries the exact same "standard rooming... twin/double
 * or extra room on request" string as every multi-night package, even though it has no hotel
 * stay to room a customer into. The release itself flags this: `readiness.rooming` is
 * `"unavailable"` for that row (`"available"` everywhere else). Read that signal, not a proxy
 * like `overnights.length > 0` -- the two agree today only because the current release happens
 * to have exactly one zero-overnight package; `readiness` is the field the release actually
 * asserts, and a future sync could add a package with overnights but rooming genuinely still
 * not ready (or vice versa) without this staying in sync.
 */
function roomingAssumptionFor(entry: Json | undefined): string | null {
  if (!entry) return null
  const readiness = isObject(entry.readiness) ? entry.readiness : null
  if (asString(readiness?.rooming) !== 'available') return null
  return asString(entry.rooming_assumption)
}

function publicSiteBaseUrl(linkRegistry: unknown): string {
  if (!isObject(linkRegistry)) return ''
  return (asString(linkRegistry.base_url) ?? '').replace(/\/+$/, '')
}

function buildDetailsLink(baseUrl: string, publicUrl: string | null): Record<string, string> {
  if (!publicUrl) return {}
  if (/^https?:\/\//i.test(publicUrl)) return { details: publicUrl }
  if (!baseUrl) return {}
  return { details: `${baseUrl}${publicUrl.startsWith('/') ? '' : '/'}${publicUrl}` }
}

// The catalog is ~250KB across eight files, read and JSON.parsed synchronously
// on every single inbound message inside one always-on Node process. It only
// ever changes when an operator runs `npm run sync:knowledge` and redeploys,
// so it is cached and invalidated on the newest mtime across the files
// loadCatalog actually reads -- the same shape knowledge.ts's own module cache
// already uses. mtime (not a TTL) means a fresh deploy is picked up on the
// very next message with no restart and no stale window.
const CACHED_FILES = [
  PROFILES_FILE, PRICE_TIERS_FILE, COMPONENTS_FILE, MODULE_COMPATIBILITY_FILE,
  GENERAL_MODULES_FILE, LINK_REGISTRY_FILE, ENDPOINT_CHAINS_FILE, META_FILE,
  ACCOMMODATION_FILE, VEHICLE_FILE, GUIDE_FILE,
]

let cachedCatalog: Catalog | null = null
let cachedMtime = -1

function newestCatalogMtime(): number {
  let newest = -1
  for (const fileName of CACHED_FILES) {
    try {
      newest = Math.max(newest, fs.statSync(path.join(CATALOG_DIR, fileName)).mtimeMs)
    } catch {
      // A missing file is already handled (and warned about) by readCatalogFile;
      // it just doesn't contribute an mtime.
    }
  }
  return newest
}

export function __resetCatalogCacheForTests(): void {
  cachedCatalog = null
  cachedMtime = -1
}

function buildCatalog(): Catalog {
  if (!fs.existsSync(CATALOG_DIR)) return { packages: [], syncedAt: null }

  const profiles = readCatalogFile(PROFILES_FILE)
  const priceTiers = indexByPackageKey(readCatalogFile(PRICE_TIERS_FILE), PRICE_TIERS_FILE)
  const components = indexByPackageKey(readCatalogFile(COMPONENTS_FILE), COMPONENTS_FILE)
  const moduleCompatibility = readCatalogFile(MODULE_COMPATIBILITY_FILE)
  const destinationIndex = buildDestinationIndex(moduleCompatibility)
  const generalModulesData = readCatalogFile(GENERAL_MODULES_FILE)
  const policyNoteIndex = buildNoteIndex(moduleCompatibility, generalModulesData, 'policy')
  const stagingNoteIndex = buildNoteIndex(moduleCompatibility, generalModulesData, 'staging')
  const baseUrl = publicSiteBaseUrl(readCatalogFile(LINK_REGISTRY_FILE))
  const finishCityIndex = buildFinishCityIndex(readCatalogFile(ENDPOINT_CHAINS_FILE))
  const accommodation = indexByPackageKey(readCatalogFile(ACCOMMODATION_FILE), ACCOMMODATION_FILE)
  const vehicle = indexByPackageKey(readCatalogFile(VEHICLE_FILE), VEHICLE_FILE)
  const guide = indexByPackageKey(readCatalogFile(GUIDE_FILE), GUIDE_FILE)

  const packages: CatalogPackage[] = []
  const seen = new Set<string>()

  if (profiles !== null && !Array.isArray(profiles)) {
    console.warn(`loadCatalog: expected catalog/${PROFILES_FILE} to be an array — no packages loaded`)
  }

  for (const profile of Array.isArray(profiles) ? profiles : []) {
    if (!isObject(profile)) {
      console.warn(`loadCatalog: skipping a non-object entry in catalog/${PROFILES_FILE}`)
      continue
    }

    // Validation, not blind trust: a malformed entry is skipped with a warning so
    // the catalog degrades (one fewer package) instead of the bot serving a
    // package it cannot name or key.
    const packageKey = asString(profile.package_key)
    const title = asString(profile.title)
    if (!packageKey || !title) {
      console.warn(
        `loadCatalog: skipping malformed package in catalog/${PROFILES_FILE} ` +
          `(package_key=${JSON.stringify(profile.package_key)}, title=${JSON.stringify(profile.title)})`
      )
      continue
    }
    if (seen.has(packageKey)) {
      console.warn(`loadCatalog: skipping duplicate package_key "${packageKey}" in catalog/${PROFILES_FILE}`)
      continue
    }
    seen.add(packageKey)

    // Fallback to the profile's own slug-derived tokens only when the curated
    // taxonomy is unavailable (see the file header) -- fuzzy matching beats none.
    const destinationTokens = destinationIndex.get(packageKey) ?? asStringArray(profile.destination_tokens)
    if (destinationTokens.length === 0) {
      console.warn(`loadCatalog: package "${packageKey}" has no destination tokens — it will never match a customer message`)
    }

    const component = components.get(packageKey)

    packages.push({
      packageKey,
      title,
      destinationTokens,
      priceIdr: lowestTierPriceIdr(priceTiers.get(packageKey)),
      priceTiers: parsePriceTiers(priceTiers.get(packageKey)),
      inclusions: component ? asStringArray(component.included) : [],
      policyNotes: policyNoteIndex.get(packageKey) ?? [],
      stagingNotes: stagingNoteIndex.get(packageKey) ?? [],
      links: buildDetailsLink(baseUrl, asString(profile.public_url)),
      origin: asString(profile.origin),
      dayCount: asPositiveInt(profile.day_count),
      finishCities: finishCityIndex.get(packageKey) ?? [],
      overnights: asStringArray(accommodation.get(packageKey)?.overnights),
      roomingAssumption: roomingAssumptionFor(accommodation.get(packageKey)),
      vehicleCategory: asString(vehicle.get(packageKey)?.vehicle_category),
      luggageRule: asString(vehicle.get(packageKey)?.luggage_rule),
      crewRoles: asString(guide.get(packageKey)?.crew_roles),
      languageNote: asString(guide.get(packageKey)?.language_note),
    })
  }

  let syncedAt: string | null = null
  const metaPath = path.join(CATALOG_DIR, META_FILE)
  if (fs.existsSync(metaPath)) syncedAt = JSON.parse(fs.readFileSync(metaPath, 'utf-8')).syncedAt ?? null

  return { packages, syncedAt }
}

export function loadCatalog(): Catalog {
  const mtime = newestCatalogMtime()
  if (cachedCatalog && mtime === cachedMtime) return cachedCatalog
  cachedCatalog = buildCatalog()
  cachedMtime = mtime
  return cachedCatalog
}
