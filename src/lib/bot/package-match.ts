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
export type TripPreferences = { origin: string | null; dayCount: number | null; finishCity: string | null }

const NO_PREFERENCES: TripPreferences = { origin: null, dayCount: null, finishCity: null }

/**
 * "3 day(s)"/"3 hari" or "3d2n" -> 3. A date range like "10-12 June" implies a 3-day trip
 * (inclusive of both ends) -- capped at 10 days so a garbled or unrelated number pair
 * (e.g. two prices) can't be misread as a multi-week trip.
 */
function parseDayCount(low: string): number | null {
  const explicit = low.match(/(\d{1,2})\s*(?:d\s*\d{1,2}\s*n\b|days?\b|hari\b)/)
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
const FROM_CITY_PATTERN = /\bfrom\s+(bali|surabaya)\b|\bstart(?:ing)?\s+(?:in|from)\s+(bali|surabaya)\b/

// Every token this file/catalog.ts's finish-city matching can produce ("bali", "surabaya",
// "malang", "ketapang") is already a single, simple word -- capitalizing the first letter is
// sufficient and correct for all of them, unlike `parseOrigin`'s own two-city special case.
export function titleCaseCity(city: string): string {
  return city.charAt(0).toUpperCase() + city.slice(1)
}

function parseOrigin(low: string): string | null {
  const fromMatch = low.match(FROM_CITY_PATTERN)
  if (fromMatch) return titleCaseCity(fromMatch[1] ?? fromMatch[2])
  if (FINISH_CONTEXT_PHRASES.some((p) => low.includes(p))) return null
  if (low.includes('surabaya')) return 'Surabaya'
  if (low.includes('bali')) return 'Bali'
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
  return { origin: parseOrigin(low), dayCount: parseDayCount(low), finishCity: parseFinishCity(low) }
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
