/**
 * Resolves a customer message to a catalog destination + package -- a stateless,
 * one-shot replacement for the destination-matching half of the removed
 * chatbot-web-style funnel (formerly funnel.ts, a TypeScript port of a DIFFERENT
 * sibling repo's `orderFlow.js`, not the jvto-agent-runtime this bot is otherwise
 * built from). The matching algorithm itself is unchanged from that removed file:
 * the earliest-mentioned destination token wins (mirrors `orderFlow.js`'s own
 * `detectOriginAndEnd` disambiguation by string index), since that part was never
 * about running a multi-turn qualification dialogue -- it is simply "which package
 * is this message about," needed by any caller, stateful or not.
 *
 * `parseTripPreferences`/`pickPackage`'s duration+origin narrowing (added 2026-08-04) is
 * new: a destination alone is ambiguous among this catalog's packages -- e.g. "ijen" alone
 * matches 5 packages differing only by day count and starting city. package-profiles.json
 * already carries `origin`/`day_count` per package (CatalogPackage exposes them as
 * `origin`/`dayCount`, see types.ts); this was simply never read before, so "3 day trip
 * from Surabaya" always got whichever priced Ijen package happened to be listed first.
 */
import type { Catalog, CatalogPackage } from './types'

// Every distinct destination token in the catalog, lowercased and deduped.
function allDestinationTokens(catalog: Catalog): string[] {
  return [...new Set(catalog.packages.flatMap((p) => p.destinationTokens.map((t) => t.toLowerCase())))]
}

// Same set, title-cased for display in a customer-facing message (orchestrator.ts's
// clarifying question) -- "tumpak sewu" -> "Tumpak Sewu".
export function listDestinations(catalog: Catalog): string[] {
  return allDestinationTokens(catalog).map((t) => t.replace(/\b\w/g, (c) => c.toUpperCase()))
}

/**
 * Finds every package covering the single destination mentioned earliest in the
 * message. A package matches on ANY of its `destinationTokens`, so a combined
 * Bromo+Ijen tour is offered to a customer who asked about either. Returns `null`
 * when no known destination is mentioned at all -- the caller (orchestrator.ts)
 * treats that the same way route-gate.ts's own "no destination" branch already
 * does: hand off, rather than run a clarifying-question dialogue of its own.
 */
export function matchDestination(message: string, catalog: Catalog): { destination: string; matches: CatalogPackage[] } | null {
  const lower = message.toLowerCase()
  let bestDestination: string | null = null
  let bestIndex = Infinity
  for (const token of allDestinationTokens(catalog)) {
    const index = lower.indexOf(token)
    if (index !== -1 && index < bestIndex) {
      bestIndex = index
      bestDestination = token
    }
  }
  if (bestDestination === null) return null
  const destination = bestDestination
  const matches = catalog.packages.filter((p) => p.destinationTokens.some((t) => t.toLowerCase() === destination))
  return matches.length > 0 ? { destination, matches } : null
}

/**
 * Every package matching a known destination (used when the destination came from
 * `tripBrief` rather than a fresh match this turn, so there is no `matches` array
 * already in hand).
 */
export function packagesForDestination(destination: string, catalog: Catalog): CatalogPackage[] {
  const wanted = destination.toLowerCase()
  return catalog.packages.filter((p) => p.destinationTokens.some((t) => t.toLowerCase() === wanted))
}

// EVERY destination token the customer's message mentions, unlike `matchDestination`'s single
// earliest-mentioned anchor -- used by `narrowPackagePool` (see its own header) to tell "this
// package covers the customer's full requested route" apart from "this package only covers
// one of the destinations they named". Order doesn't matter here (route ORDER isn't modeled
// anywhere in the catalog -- packages only expose an unordered destination set), only which
// destinations were named at all.
export function mentionedDestinationTokens(message: string, catalog: Catalog): string[] {
  const low = message.toLowerCase()
  return allDestinationTokens(catalog).filter((token) => low.includes(token))
}

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

// A customer-stated duration/origin/finish-city, parsed from free text -- used to narrow
// pickPackage's choice among a destination's several packages (they differ mainly by
// day count, starting city, and which cities they can end in; see catalog/package-profiles.json's
// `origin`/`day_count` and endpoint-chains.json's `finishCities`, both exposed on
// CatalogPackage). Never guesses: an unrecognized or absent signal leaves the corresponding
// field `null`, so pickPackage falls back to its previous (price-only) behavior rather than
// mismatching a package.
export type TripPreferences = { origin: string | null; dayCount: number | null; finishCity: string | null; pax: number | null }

const NO_PREFERENCES: TripPreferences = { origin: null, dayCount: null, finishCity: null, pax: null }

// "2 people"/"4 pax"/"group of 15"/"a party of 6"/"3 of us" -> that number. "solo"/"just
// me"/"myself"/"alone" -> 1. Added 2026-08-05: CatalogPackage.priceTiers (see that field's own
// header) makes the real per-group-size price ladder available, but nothing had ever parsed the
// customer's own stated group size to look a price up by -- the bot was quoting the cheapest
// (11+ pax) tier to every customer regardless of their actual party size. Capped at 200 for the
// same reason parseDayCount caps at 10: a garbled or unrelated number shouldn't be misread as a
// group size (a genuine JVTO group has never approached that scale).
function parsePax(low: string): number | null {
  if (/\b(solo|just me|myself|alone|by myself)\b/.test(low)) return 1
  const explicit = low.match(/\b(\d{1,3})\s*(?:people|persons?|pax|travell?ers?|guests?|adults?)\b/)
  if (explicit) {
    const n = Number(explicit[1])
    if (n > 0 && n <= 200) return n
  }
  const groupOf = low.match(/\b(?:party|group) of (\d{1,3})\b/)
  if (groupOf) {
    const n = Number(groupOf[1])
    if (n > 0 && n <= 200) return n
  }
  const ofUs = low.match(/\b(\d{1,3})\s*of us\b/)
  if (ofUs) {
    const n = Number(ofUs[1])
    if (n > 0 && n <= 200) return n
  }
  return null
}

/**
 * Resolves the correct per-person price for `pkg` given a customer's actual (or unknown) group
 * size -- CatalogPackage.priceTiers holds the real ladder; `priceIdr` alone is only ever the
 * cheapest (11+ pax) "starting from" figure. `isExactMatch: true` means this price is genuinely
 * theirs for the stated pax; `false` means it fell back to the "starting from" price because
 * pax is unknown, or a package genuinely has no tier covering that pax count (e.g. a solo
 * traveler asking about a package whose real minimum group size is 2).
 */
export function priceForPax(pkg: CatalogPackage, pax: number | null): { priceIdr: number | null; isExactMatch: boolean } {
  if (pax !== null) {
    const tier = pkg.priceTiers.find((t) => pax >= t.minPax && (t.maxPax === null || pax <= t.maxPax))
    if (tier) return { priceIdr: tier.priceIdr, isExactMatch: true }
  }
  return { priceIdr: pkg.priceIdr, isExactMatch: false }
}

/**
 * "3 day(s)"/"3 hari" or "3d2n" -> 3. A date range like "10-12 June" implies a 3-day trip
 * (inclusive of both ends) -- capped at 10 days so a garbled or unrelated number pair
 * (e.g. two prices) can't be misread as a multi-week trip. `[\s-]*` (not just `\s*`) between
 * the number and the unit -- reported 2026-08-05: "a 3-day, 2-night tour" (hyphenated, no
 * space before "day") didn't match a bare `\s*`, so a real, explicitly stated duration was
 * silently lost and the recommendation list fell back to showing every duration.
 */
function parseDayCount(low: string): number | null {
  const explicit = low.match(/(\d{1,2})[\s-]*(?:d[\s-]*\d{1,2}[\s-]*n\b|days?\b|hari\b)/)
  if (explicit) {
    const n = Number(explicit[1])
    if (n > 0 && n <= 10) return n
  }
  const monthPattern = MONTH_NAMES.join('|')
  const dateRange = low.match(new RegExp(`(\\d{1,2})\\s*(?:-|to|–)\\s*(\\d{1,2})\\s+(?:${monthPattern})`))
  if (dateRange) {
    const span = Number(dateRange[2]) - Number(dateRange[1]) + 1
    if (span > 0 && span <= 10) return span
  }
  return null
}

// Phrasing that means the mentioned city is where the trip ENDS, not where it starts --
// checked before the bare city-name fallback below. Reported 2026-08-05: "can we finish the
// trip in Bali?" was parsed as origin='Bali' (the bare "bali" match), which then biased
// pickPackage toward a Bali-ORIGIN package -- one that, per endpoint-chains.json's real
// dropoff data, does NOT finish in Bali at all (Bali-origin packages all end in the
// Surabaya/Malang area). An explicit "from <city>" always wins even when finish-context
// phrasing is ALSO present ("3 day trip from Surabaya, finishing in Bali" -- origin is still
// unambiguous), so that check runs first. 'back in' added 2026-08-05 alongside the existing
// 'back to': a customer confirming "we'll be back in Bali on the 16th" was missed by this list
// (only 'back to' matched), so parseOrigin fell through to the bare "bali" fallback and
// silently overwrote an already-confirmed Surabaya origin with 'Bali'.
const FINISH_CONTEXT_PHRASES = ['finish', 'end in', 'ending in', 'drop off', 'dropoff', 'drop-off', 'back to', 'back in']
// "picked up in Bali"/"pickup at Surabaya" is as strong and unambiguous an origin signal as
// "from <city>" -- added 2026-08-05: "I would like to be picked up in Bali... I have a flight
// from Surabaya Airport" was parsed as origin='Surabaya', because the bare fallback below
// checks 'surabaya' before 'bali' with no regard for which city was actually the customer's
// stated PICKUP point vs. one mentioned only incidentally (their departure airport). Checked
// with the same priority as FROM_CITY_PATTERN so it wins before the bare fallback ever runs.
const FROM_CITY_PATTERN =
  /\bfrom\s+(bali|surabaya)\b|\bstart(?:ing)?\s+(?:in|from)\s+(bali|surabaya)\b|\bpick(?:ed)?[\s-]?up\s+(?:in|at|from)\s+(bali|surabaya)\b/

// Every token this file/catalog.ts's finish-city matching can produce ("bali", "surabaya",
// "malang", "ketapang") is already a single, simple word -- capitalizing the first letter is
// sufficient and correct for all of them, unlike `parseOrigin`'s own two-city special case.
export function titleCaseCity(city: string): string {
  return city.charAt(0).toUpperCase() + city.slice(1)
}

// How many characters around a bare city mention to scan for nearby finish-context phrasing.
// Reported 2026-08-05: rapid-fire customer messages get concatenated into one string before
// parsing (see inbound.ts's burst-batching), so a real customer message read "...we will be
// arriving at Surabaya the 14th... So we can be back in Bali the 16th right?" as ONE combined
// string. The OLD check ("does ANY finish-context phrase appear ANYWHERE in the whole
// message?") saw "back in" and suppressed origin detection for the ENTIRE message -- silently
// discarding "arriving at Surabaya" even though it sits in a completely different sentence,
// nowhere near "back in Bali". Scoped to a small window around each city's own mention instead,
// so a finish-context phrase only suppresses the city it's actually adjacent to. 30 chars
// comfortably covers "back in Bali the 16th" (~20 chars) while not reaching into an unrelated
// earlier/later sentence.
const FINISH_CONTEXT_WINDOW = 30
function hasNearbyFinishContext(low: string, cityIndex: number, cityLength: number): boolean {
  const start = Math.max(0, cityIndex - FINISH_CONTEXT_WINDOW)
  const end = Math.min(low.length, cityIndex + cityLength + FINISH_CONTEXT_WINDOW)
  const window = low.slice(start, end)
  return FINISH_CONTEXT_PHRASES.some((p) => window.includes(p))
}

function parseOrigin(low: string): string | null {
  const fromMatch = low.match(FROM_CITY_PATTERN)
  if (fromMatch) return titleCaseCity(fromMatch[1] ?? fromMatch[2] ?? fromMatch[3])
  const surabayaIndex = low.indexOf('surabaya')
  if (surabayaIndex !== -1 && !hasNearbyFinishContext(low, surabayaIndex, 'surabaya'.length)) return 'Surabaya'
  const baliIndex = low.indexOf('bali')
  if (baliIndex !== -1 && !hasNearbyFinishContext(low, baliIndex, 'bali'.length)) return 'Bali'
  return null
}

// "can we finish in Bali?" / "does it end in Surabaya?" / "drop off in Malang" -- the city a
// customer wants the trip to END in, normalized to the same lowercase tokens
// CatalogPackage.finishCities uses ("bali", "surabaya", "malang", "ketapang").
const FINISH_CITY_TOKENS = ['bali', 'surabaya', 'malang', 'ketapang']

function parseFinishCity(low: string): string | null {
  if (!FINISH_CONTEXT_PHRASES.some((p) => low.includes(p))) return null
  for (const city of FINISH_CITY_TOKENS) {
    if (low.includes(city)) return city
  }
  return null
}

/** Extracts whatever duration/origin/finish-city signal a customer message actually states. */
export function parseTripPreferences(message: string): TripPreferences {
  const low = message.toLowerCase()
  return { origin: parseOrigin(low), dayCount: parseDayCount(low), finishCity: parseFinishCity(low), pax: parsePax(low) }
}

/**
 * Among a destination's matching packages, the one orchestrator.ts should answer about.
 * Prefers a priced package -- matching route-gate.ts's own "no priced match -> handoff"
 * rule, so the package chosen here is always one route-gate would actually let through.
 *
 * When the customer stated a finish city, duration, and/or origin (parseTripPreferences),
 * progressively narrows the candidate pool by each in turn (finish city first -- it's the
 * most specific/rare signal, matching only 2 of 16 packages -- then origin, then day count),
 * skipping any filter that would leave nothing so an earlier, looser match still wins over no
 * match at all. "3 day trip from Surabaya" recommends the specific 3D2N-from-Surabaya package
 * instead of whichever priced package for that destination happens to be first.
 */
export function pickPackage(matches: CatalogPackage[], preferences: TripPreferences = NO_PREFERENCES): CatalogPackage {
  const priced = (pkgs: CatalogPackage[]) => pkgs.find((p) => p.priceIdr !== null) ?? null
  const { origin, dayCount, finishCity } = preferences

  let pool = matches
  if (finishCity) {
    const filtered = pool.filter((p) => p.finishCities.includes(finishCity))
    if (filtered.length > 0) pool = filtered
  }
  if (origin) {
    const filtered = pool.filter((p) => p.origin === origin)
    if (filtered.length > 0) pool = filtered
  }
  if (dayCount) {
    const filtered = pool.filter((p) => p.dayCount === dayCount)
    if (filtered.length > 0) pool = filtered
  }
  return priced(pool) ?? matches[0]
}

// Confirmed with the operator 2026-08-05 as JVTO's best/flagship packages -- whenever any of
// these appear in a recommendation list, they lead it, ahead of any other match. Order within
// this list IS the priority order (first = highest). Real packageKeys, cross-checked against
// the synced catalog 2026-08-05 (titles below are the operator's own shorthand for each):
//   "3D2N Surabaya bromo ijen bali"            -> bromo-madakaripura-ijen-3d2n
//   "3d2n surabaya ijen bromo mada"            -> ijen-bromo-madakaripura-3d2n
//   "4d3n surabaya tumpak sewu Bromo ijen bali" -> tumpak-sewu-bromo-ijen-4d3n
//   "4d3n surabaya ijen papuma tumpak sewu Bromo" -> ijen-papuma-tumpak-sewu-bromo-4d3n
const BEST_PACKAGE_KEYS = [
  'bromo-madakaripura-ijen-3d2n',
  'ijen-bromo-madakaripura-3d2n',
  'tumpak-sewu-bromo-ijen-4d3n',
  'ijen-papuma-tumpak-sewu-bromo-4d3n',
]

/** Stable sort: any of BEST_PACKAGE_KEYS lead the list (in that priority order); everything else keeps its relative order after them. */
export function sortByBestPackagePriority(packages: CatalogPackage[]): CatalogPackage[] {
  const rank = (p: CatalogPackage) => {
    const i = BEST_PACKAGE_KEYS.indexOf(p.packageKey)
    return i === -1 ? BEST_PACKAGE_KEYS.length : i
  }
  return packages
    .map((p, i) => ({ p, i, r: rank(p) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(({ p }) => p)
}

export type PackageMatchTier = 'exact' | 'relaxed_route' | 'relaxed_start_end' | 'none'

/**
 * Confirmed with the operator 2026-08-05: before showing package options, try progressively
 * looser tiers, in this exact priority order, rather than pickPackage's old "quietly skip
 * whichever single filter would zero the pool" (which could silently drop the customer's
 * duration or finish city without ever trying to keep BOTH by relaxing something else first).
 *
 *   1. 'exact': every one of origin/finishCity/dayCount the customer actually stated matches,
 *      AND the package covers every destination they named (not just one) -- their exact
 *      request. E.g. "3 day Surabaya -> Bromo -> Ijen -> Surabaya".
 *   2. 'relaxed_route': same origin/finishCity/dayCount, but the package doesn't cover every
 *      named destination (a different route/order covers some of them) -- e.g. no package
 *      visits Bromo-then-Ijen in that order, but one visits Ijen-then-Bromo with the same
 *      start, end, and duration.
 *   3. 'relaxed_start_end': no package satisfies origin AND finishCity together for the
 *      stated duration (route order is no longer the issue -- the start/end COMBINATION
 *      itself doesn't exist), so origin or finishCity has to give. Tries keeping origin (drops
 *      finishCity), then keeping finishCity (drops origin), unioning whichever succeed, before
 *      relaxing both. E.g. "4 day Bali -> Bali" doesn't exist (no Bali-origin package finishes
 *      in Bali) -- offers "4 day Surabaya -> Bali" instead (same finish, different start).
 *   4. 'none': not even the stated duration has a match against this destination at all --
 *      nothing to offer even approximately; the caller should hand off to a human agent
 *      instead of presenting an unrelated list.
 *
 * `requestedTokens` should be `mentionedDestinationTokens(message, catalog)`, not just the
 * single anchor token `matches` was already filtered by.
 */
export function narrowPackagePool(
  matches: CatalogPackage[],
  preferences: TripPreferences,
  requestedTokens: string[]
): { pool: CatalogPackage[]; tier: PackageMatchTier } {
  const { origin, dayCount, finishCity } = preferences

  const coversAllRequested = (p: CatalogPackage) =>
    requestedTokens.every((t) => p.destinationTokens.some((pt) => pt.toLowerCase() === t))

  // Applies origin/finishCity/dayCount together (only the ones actually stated) -- null (not
  // []) means "this combination has zero matches", distinct from "matched, but empty on purpose".
  const applyStartEndDuration = (pool: CatalogPackage[]): CatalogPackage[] | null => {
    let out = pool
    if (finishCity) {
      out = out.filter((p) => p.finishCities.includes(finishCity))
      if (out.length === 0) return null
    }
    if (origin) {
      out = out.filter((p) => p.origin === origin)
      if (out.length === 0) return null
    }
    if (dayCount) {
      out = out.filter((p) => p.dayCount === dayCount)
      if (out.length === 0) return null
    }
    return out
  }

  if (requestedTokens.length > 0) {
    const exact = applyStartEndDuration(matches.filter(coversAllRequested))
    if (exact) return { pool: exact, tier: 'exact' }
  }

  const relaxedRoute = applyStartEndDuration(matches)
  if (relaxedRoute) return { pool: relaxedRoute, tier: requestedTokens.length > 0 ? 'relaxed_route' : 'exact' }

  // Start/end combination itself doesn't exist -- duration is the only dimension worth
  // holding onto absolutely (everything below is already a fallback for a genuinely
  // unavailable route, so silently dropping duration too would be a second, compounding guess).
  let durationPool = matches
  if (dayCount) {
    durationPool = durationPool.filter((p) => p.dayCount === dayCount)
    if (durationPool.length === 0) return { pool: [], tier: 'none' }
  }

  const keepOrigin = origin ? durationPool.filter((p) => p.origin === origin) : []
  const keepFinish = finishCity ? durationPool.filter((p) => p.finishCities.includes(finishCity)) : []
  if (keepOrigin.length > 0 || keepFinish.length > 0) {
    const merged = [...keepOrigin, ...keepFinish.filter((p) => !keepOrigin.includes(p))]
    return { pool: merged, tier: 'relaxed_start_end' }
  }

  return { pool: durationPool, tier: 'relaxed_start_end' }
}
