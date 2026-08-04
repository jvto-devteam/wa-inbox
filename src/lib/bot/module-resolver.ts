/**
 * Topic classification -- TypeScript port of jvto-agent-runtime's `module_resolver.py`
 * (see .../src/jvto_agent_runtime/module_resolver.py), scoped to `classify_topic` (lines
 * 98-103) + its supporting tables (`TOPICS` lines 26-30, `_TOPIC_KEYWORDS` lines 51-65,
 * `_JOB_DEFAULT_TOPIC` lines 68-76). This is a DIRECT, faithful port: the keyword table,
 * match order (first hit wins), and job-fallback are copied verbatim -- nothing here is
 * wa-inbox's own invention.
 *
 * `resolve_modules` (the rest of the real file, lines 106-194) is NOT ported here -- that
 * piece now lives in knowledge.ts, which resolves real facts for all 14 topics `classifyTopic`
 * can return (see that file's header for why it lives separately from topic classification).
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
