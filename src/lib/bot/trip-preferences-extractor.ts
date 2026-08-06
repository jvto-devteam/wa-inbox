/**
 * LLM-primary replacement for `parseTripPreferences`'s role as the trip-preference parser.
 * Confirmed with the operator 2026-08-07: `package-match.ts`'s regex/keyword-list extraction
 * (origin/finishCity/dayCount/pax) kept causing real, live bugs -- most recently a customer's
 * "Day 1"..."Day 4" itinerary headers and "we will continue our trip independently to Bali"
 * matched none of the existing patterns, so the bot asked the customer to restate info they'd
 * already clearly given. Regex can only match literal phrasings someone already anticipated; it
 * cannot generalize to new wording that conveys the same meaning. The two smaller regex fixes
 * for that exact message (Day-header counting, implicit "continue...to <city>" phrasing) already
 * shipped -- this is the systemic fix so a NEW phrasing of the same kind of implicit signal
 * doesn't require another one-off patch.
 *
 * The LLM call is PRIMARY here, not gated behind "regex found nothing first" -- that ordering
 * wouldn't have fixed the actual recurring failure, which is regex confidently returning a
 * wrong/partial answer, not returning nothing (a wrong-but-non-null regex result would never
 * trigger a "try the LLM instead" fallback). All LLM output is validated against known-good
 * values before being trusted (see validateOrigin/validateFinishCity/validateDayCount/
 * validatePax below); anything else is discarded exactly like a genuine "not stated" -- there's
 * no behavioral difference between a hallucination and an honest null, so no need to distinguish
 * them. The existing regex `parseTripPreferences` is kept, unchanged, as a fallback used ONLY
 * when the LLM call fails technically (timeout, error, unparseable output) -- mirrors
 * `evaluatePickupScenario`'s (orchestrator.ts) own "catch, log, safe default" shape for an
 * optional enrichment step that must never break the main reply.
 */
import { callLLM } from './llm'
import { parseTripPreferences, titleCaseCity, type TripPreferences } from './package-match'

export type TripPreferencesExtraction = {
  preferences: TripPreferences
  /** For tracing/observability only -- callers do not need to branch on this. */
  source: 'llm' | 'regex_fallback'
}

const VALID_ORIGIN_CITIES = new Set(['bali', 'surabaya'])
const VALID_FINISH_CITIES = new Set(['bali', 'surabaya', 'malang', 'ketapang'])

const EXTRACTION_SYSTEM_PROMPT = `You extract 4 trip-planning fields from a customer's WhatsApp message to a private tour operator (JVTO) in East Java, Indonesia. Read the whole message for meaning -- customers phrase the same information in many different ways, so look for what they actually mean, not just literal keywords.

Fields:
- "origin": the customer's pickup/starting city. JVTO tours only ever depart from Bali or Surabaya. If the customer names some other city as their start point (Yogyakarta, Jakarta, Malang, etc.), leave this null -- a separate part of the system already handles telling them that city isn't supported; do not guess Bali or Surabaya instead. Recognize both explicit phrasing ("from Surabaya", "starting in Bali", "picked up in Bali") and simple statements about where they'll be collected (e.g. "we land at Surabaya Airport" as their pickup point).
- "dayCount": the total trip length in days. Recognize an explicit "N days"/"N hari"/"NDMN" count, a date range that implies a duration, OR -- if the message lays out an itinerary using "Day 1", "Day 2", etc. as section headers -- the highest day number used (itineraries are always numbered sequentially starting from 1, so the max heading number IS the trip length, even if the word "days" never appears anywhere).
- "finishCity": one of Bali, Surabaya, Malang, or Ketapang -- the city the trip with JVTO ends in. Recognize explicit phrasing ("finish in", "end in", "drop off at", "back to") AND implicit continuation phrasing, where the customer describes going onward to a place on their own AFTER the JVTO portion of the trip ends there (e.g. "we'll continue on to Bali afterwards", "then head to Surabaya independently", "carrying on to Malang on our own") -- the destination of that onward movement is the finish city.
- "pax": total number of travelers. Recognize explicit counts ("4 people", "party of 6", "2 pax") AND implicit signals: "solo"/"just me"/"myself" means 1; a description of who is traveling together (e.g. "my girlfriend and I", "my wife and I") means count the people named; "family of 4" means 4.

Never guess -- if a field genuinely isn't stated or implied anywhere in the message, output null for it. A wrong guess is worse than an honest null.

Reply with ONLY valid JSON, no markdown, no explanation, exactly this shape:
{"origin": "Bali" | "Surabaya" | null, "dayCount": <integer> | null, "finishCity": "bali" | "surabaya" | "malang" | "ketapang" | null, "pax": <integer> | null}

Examples:

Message: "Day 1: Airport pickup and transfer to hotel. Day 2: Bromo sunrise tour. Day 3: Ijen blue fire trek. Day 4: after Ijen we will continue our trip independently to Bali."
Output: {"origin": null, "dayCount": 4, "finishCity": "bali", "pax": null}

Message: "Hi, we're a group of 2 (my girlfriend and I), looking for a 3D2N tour from Surabaya."
Output: {"origin": "Surabaya", "dayCount": 3, "finishCity": null, "pax": 2}

Message: "Just me traveling solo, want to finish the trip in Bali."
Output: {"origin": null, "dayCount": null, "finishCity": "bali", "pax": 1}

Message: "We'll be picked up in Bali, then head to Malang afterwards. There will be 4 people total."
Output: {"origin": "Bali", "dayCount": null, "finishCity": "malang", "pax": 4}`

// The model sometimes wraps JSON in a ```json fence despite instructions not to -- stripping it
// before parsing recovers an otherwise-valid response instead of failing outright on it. Mirrors
// template-suggester.ts's own stripCodeFence (duplicated rather than shared -- both are small,
// single-file-scoped helpers, matching this codebase's existing per-file-helper convention).
function stripCodeFence(raw: string): string {
  return raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '')
}

function validateOrigin(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const low = v.toLowerCase()
  return VALID_ORIGIN_CITIES.has(low) ? titleCaseCity(low) : null
}

function validateFinishCity(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const low = v.toLowerCase()
  return VALID_FINISH_CITIES.has(low) ? low : null
}

// Same 1-30 cap as parseDayCount's own explicit-match tier -- see package-match.ts's header for
// why (a garbled or unrelated number shouldn't be misread as a multi-week trip).
function validateDayCount(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 30 ? v : null
}

// Same 1-200 cap as parsePax's own contract -- a genuine JVTO group has never approached that
// scale, so anything beyond it reads as a hallucination rather than a real group size.
function validatePax(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 200 ? v : null
}

// `null` return means the response itself was unusable (bad JSON, wrong shape) -- distinct from
// a well-shaped `TripPreferences` where individual fields are null/invalid, which IS trusted and
// returned normally (see validateX above).
function parseAndValidate(raw: string): TripPreferences | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFence(raw))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>
  const hasAllKeys = ['origin', 'dayCount', 'finishCity', 'pax'].every((k) => k in obj)
  if (!hasAllKeys) return null
  return {
    origin: validateOrigin(obj.origin),
    dayCount: validateDayCount(obj.dayCount),
    finishCity: validateFinishCity(obj.finishCity),
    pax: validatePax(obj.pax),
  }
}

export async function extractTripPreferences(message: string, model?: string): Promise<TripPreferencesExtraction> {
  try {
    const raw = await callLLM(message, { system: EXTRACTION_SYSTEM_PROMPT, model })
    const validated = parseAndValidate(raw)
    if (validated) return { preferences: validated, source: 'llm' }
  } catch (err) {
    console.error('trip preference extraction failed', { error: err })
  }
  return { preferences: parseTripPreferences(message), source: 'regex_fallback' }
}
