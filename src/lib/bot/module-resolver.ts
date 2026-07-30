/**
 * Topic classification -- TypeScript port of jvto-agent-runtime's `module_resolver.py`
 * (see .../src/jvto_agent_runtime/module_resolver.py), scoped to `classify_topic` (lines
 * 98-103) + its supporting tables (`TOPICS` lines 26-30, `_TOPIC_KEYWORDS` lines 51-65,
 * `_JOB_DEFAULT_TOPIC` lines 68-76). This is a DIRECT, faithful port: the keyword table,
 * match order (first hit wins), and job-fallback are copied verbatim -- nothing here is
 * wa-inbox's own invention, unlike the topic-narrowing mapping at the bottom of this file.
 *
 * `resolve_modules` (the rest of the real file, lines 106-194) is NOT ported: it selects
 * general-module/package-variation ids from a `general-modules.json` / `package-variations.json`
 * / `module-compatibility.json` layer that carries vehicle rules, rooming rules, staging/
 * endpoint chains, and per-destination readiness copy -- none of which `CatalogPackage`
 * (Task 20) has a field for. wa-inbox's own `response-composer.ts` (a scoped port of
 * `response_composer.py`) only ever answers 4 topics (inclusions/how_to_book/policy/price),
 * against the 14 the real system resolves modules for. See `toComposableTopic` below for how
 * the gap between the two is handled -- honestly, not silently.
 */

// Real: TOPICS (module_resolver.py:26-30), verbatim.
export type ResolverTopic =
  | 'inclusions'
  | 'price'
  | 'private_tour'
  | 'vehicle'
  | 'rooming'
  | 'hotel'
  | 'route_endpoint'
  | 'destination_readiness'
  | 'booking'
  | 'payment'
  | 'cancellation'
  | 'blue_fire'
  | 'greeting'
  | 'general'

// Real: _TOPIC_KEYWORDS (module_resolver.py:51-65). Order matters -- first match wins,
// scanned top to bottom, exactly as the real source does.
const TOPIC_KEYWORDS: Array<[ResolverTopic, string[]]> = [
  ['price', ['how much', 'price', 'cost', 'rate', 'per person', 'per pax', 'budget']],
  ['blue_fire', ['blue fire', 'blue-fire', 'bluefire']],
  ['vehicle', ['vehicle', 'car', 'mpv', 'hiace', 'luggage', 'suitcase', 'transport']],
  ['rooming', ['room', 'twin', 'double', 'single', 'rooming', 'bed']],
  ['hotel', ['hotel', 'accommodation', 'stay', 'overnight', 'homestay']],
  ['private_tour', ['private', 'shared', 'join', 'group tour', 'guide', 'driver']],
  ['inclusions', ['include', 'included', 'inclusion', 'what do we get', 'all inclusive', 'all-inclusive']],
  ['route_endpoint', ['finish', 'end in', 'drop', 'dropoff', 'drop-off', 'ketapang', 'ferry', 'bali', 'airport']],
  ['destination_readiness', ['ijen', 'bromo', 'tumpak', 'madakaripura', 'papuma', 'difficult', 'readiness', 'prepare', 'hike', 'trek']],
  ['payment', ['deposit', 'pay', 'payment', 'transfer', 'installment']],
  ['cancellation', ['cancel', 'refund', 'reschedule', 'travel credit']],
  ['booking', ['book', 'booking', 'reserve', 'how do i book', 'instant']],
  ['greeting', ['hello', 'hi ', 'halo', 'good morning', 'good evening']],
]

// Real: _JOB_DEFAULT_TOPIC (module_resolver.py:68-76), keyed on wa-inbox's own J1-J5
// shorthand (sales-classifier.ts's own already-disclosed rename of the real system's
// verbose job labels -- see that file's header) instead of the real
// J1_package_discovery/.../J5_exception_and_handoff strings. Same assignments, same
// meaning, just wa-inbox's existing job vocabulary. The real table's extra `greeting`/
// `unsupported` job entries have no counterpart here: sales-classifier.ts's job union is
// fixed to J1-J5 (see that file's header, "JUDGMENT CALL, forced by the type contract").
const JOB_DEFAULT_TOPIC: Record<string, ResolverTopic> = {
  J1: 'general',
  J2: 'price',
  J3: 'route_endpoint',
  J4: 'booking',
  J5: 'general',
}

/**
 * Real: `classify_topic` (module_resolver.py:98-103), verbatim algorithm: scan
 * `_TOPIC_KEYWORDS` in order against the lowercased query, first match wins; with no
 * match, fall back to the customer job's default topic (or 'general' with no job at all).
 */
export function classifyTopic(job: string | null | undefined, query: string): ResolverTopic {
  const low = (query ?? '').toLowerCase()
  for (const [topic, needles] of TOPIC_KEYWORDS) {
    if (needles.some((needle) => low.includes(needle))) return topic
  }
  return JOB_DEFAULT_TOPIC[job ?? ''] ?? 'general'
}

// NOT a port -- module_resolver.py's real 14 topics are each answered from real module
// data (vehicle rules, rooming rules, staging/endpoint chains, per-destination readiness
// copy) that `CatalogPackage` has no field for at all (Task 20 confirmed this gap; see
// catalog.ts's header on which release files are deliberately left unsynced). Rather than
// silently narrowing every unsupported topic to the nearest-sounding one (which would
// answer a vehicle/rooming/payment question with invented or misleading content),
// unsupported topics map to `null` and the orchestrator hands off -- the same
// fail-safe-toward-human philosophy this whole bot brain already applies to every other
// data gap (route-gate.ts's `priceIdr === null` -> handoff, sales-classifier.ts's
// `needsLiveData` -> handoff).
//
// The three real topics that DO map onto wa-inbox's 4 composable ones:
//   - 'price'   -> 'price' (direct)
//   - 'booking' -> 'how_to_book' (response-composer.ts's own already-documented analog)
//   - 'inclusions'/'general' -> 'inclusions' ('general' reuses TOPIC_GENERAL_MODULES's own
//     inclusions-flavored default content -- module_resolver.py:47's `general` bucket is
//     `inclusion_all_inclusive_baseline, service_private_tour_standard`)
//   - 'destination_readiness'/'blue_fire' -> 'policy': these two real topics are answered
//     in the real system by exactly the Ijen disclosures (`policy_ijen_health_screening`,
//     `policy_ijen_monthly_closure`, `policy_natural_phenomena`) that catalog.ts's
//     `policyNotes` already carries (see catalog.ts's header on the Ijen policy-scope
//     filter) -- the one real topic-to-catalog-data mapping outside price/booking/inclusions
//     that wa-inbox's data actually supports.
export function toComposableTopic(topic: ResolverTopic): 'inclusions' | 'how_to_book' | 'policy' | 'price' | null {
  switch (topic) {
    case 'price':
      return 'price'
    case 'booking':
      return 'how_to_book'
    case 'inclusions':
    case 'general':
      return 'inclusions'
    case 'destination_readiness':
    case 'blue_fire':
      return 'policy'
    default:
      return null
  }
}
