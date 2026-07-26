/**
 * Sales-need classifier -- TypeScript port of jvto-agent-runtime's `sales_intelligence.py`
 * decision layer (see .../src/jvto_agent_runtime/sales_intelligence.py), driven by
 * config/customer-sales/routing-and-clarification.yaml and guardrails-and-state.yaml, and
 * documented in docs/customer-sales-decision-layer.md.
 *
 * SCOPE NOTE: the task also names `customer_sales_executor.py`. That file is NOT a
 * classifier -- it's a downstream *executor* that resolves catalog/price facts from a
 * published release (`package-profiles.json`, `standard-price-tiers.json`, keyed by an
 * already-selected `package_key`). It needs release data wa-inbox has no equivalent of, and
 * nothing in Task 20's `TripBrief`/`SalesClassification` types models a catalog release or
 * package key. There is no classification logic in it to port -- it's pure lookup/pricing,
 * which conceptually belongs with Task 21's catalog sync, not this step. This file therefore
 * ports only the parts of `sales_intelligence.py` that actually produce
 * job / missingInfo / needsLiveData.
 *
 * --- What the real Python does ---
 *
 * `sales_intelligence.py` is a pure planner: DecisionEnvelope (an already-classified
 * `intent` string) + TripBrief -> ResponsePlan. Three pieces map onto `classifySalesNeed`:
 *
 * 1. `derive_default_customer_job` (lines 55-66) maps `intent` to one of five job labels via
 *    `routing.default_job_by_intent`, then `job_overrides` (routing YAML lines 20-35) shift
 *    it based on keyword hits in the raw query text or conversation stage:
 *      J1_package_discovery     - find a suitable standard package
 *                                  (query_package_details, query_destination_details, query_policy*)
 *      J2_price_and_value       - price, inclusions, value (check_price; policy w/ payment words)
 *      J3_route_and_timing      - route, endpoint, connection validation
 *                                  (plan_itinerary; package query w/ connection words)
 *      J4_live_confirmation     - availability / current operational status
 *                                  (check_availability, query_operational_notice)
 *      J5_exception_and_handoff - booking/payment status, complaints, refunds, explicit
 *                                  human-handoff (get_booking_status, get_payment_status,
 *                                  complaint_or_refund, human_handoff_request; policy w/
 *                                  cancel/refund words)
 *    (docs/customer-sales-decision-layer.md's job table, lines 34-39, matches exactly.)
 *
 * 2. `derive_requirement_profile` (lines 76-87) + `requirement_profiles` (routing YAML
 *    lines 66-97) + `_missing_required_fields` (lines 133-135) is the ACTUAL missing-info
 *    driver, and it is PER-JOB/PER-PROFILE -- not a fixed "always check destination + dates
 *    + pax" rule, as the task brief's placeholder assumed:
 *      package_recommendation (~J1): required = destinations, pickup.location, dropoff.location
 *                                     (travel_dates.start, pax.confirmed are OPTIONAL)
 *      standard_price (~J2):         required = selected_package_key, pax.confirmed
 *                                     (travel_dates.start OPTIONAL)
 *      route_validation (~J3):       required = travel_dates.start, pax.confirmed,
 *                                     pickup.location, dropoff.location, destinations
 *      availability_check (~J4):     required = selected_package_key, travel_dates.start,
 *                                     pax.confirmed
 *      general_information (~J5, greeting, policy_explanation): required = [] -- J5 is
 *                                     complaint/handoff territory, not a data-gathering job.
 *    `_EMPTY = (None, "", [], {})` (line 27) is the "missing" sentinel: absent AND
 *    present-but-empty both count, but `0`/`False` do NOT count as missing.
 *
 * 3. `needsLiveData` is not its own flag in the real system -- it's a `live_check`
 *    `required_actions` entry, added when (`derive_response_plan`, lines 208-243):
 *      (a) profile == availability_check (J4's own default_actions, routing YAML line 96);
 *      (b) an "attraction hard dependency" phrase is hit (guardrails YAML lines 6-24,
 *          e.g. "main reason", "must see") -- independent of job;
 *      (c) an "operational status query" phrase is hit (guardrails YAML lines 34-44,
 *          e.g. "will it reopen", "is it open") -- independent of job, never a handoff;
 *      (d) a guarantee is demanded (guardrails YAML lines 15-19, e.g. "guarantee", "100%").
 *
 * --- Mapping to wa-inbox's simpler inputs (judgment calls) ---
 *
 * wa-inbox has no upstream intent classifier -- `classifySalesNeed` only receives raw
 * `{ message, tripBrief }`. JUDGMENT CALL (medium confidence): job is inferred directly
 * from keyword groups drawn from the real `job_overrides` / `default_job_by_intent` keyword
 * lists and the `handoff_rules` / `attraction_hard_dependency` / `operational_status_query`
 * phrases, applied to the raw message text, in priority order J5 > J4 (availability
 * keywords only) > J3 > J2 > default J1. The real system never needs an explicit priority
 * order (one intent maps to one default job before overrides are even considered); ordering
 * handoff/complaint signals highest and defaulting to J1 is a reasoned choice: fail-safe-ish
 * (a stray price word must never swallow a refund complaint) and lowest-risk default (J1 is
 * genuinely the fallback "no override matched" job in the real YAML too, e.g.
 * general_greeting resolves with no override list at all).
 *
 * `general_greeting` resolves to a `"greeting"` job and an unmatched `query_policy` can
 * resolve to `"unsupported"` in the real system -- neither exists in Task 20's
 * `SalesClassification.job` union (fixed to J1-J5). JUDGMENT CALL (high confidence, forced
 * by the type contract): greeting-only / no-signal messages fall back to J1, since an
 * opening message on a sales WhatsApp line is, in spirit, the start of package discovery.
 *
 * Per-profile required fields reference TripBrief paths wa-inbox's flat `TripBrief`
 * (`destination?`, `dateRange?`, `pax?`, `notes?`) has no equivalent for at all:
 * `selected_package_key`, `pickup.location`, `dropoff.location`. JUDGMENT CALL, per field:
 *   - `pickup.location` / `dropoff.location` (required by J1's package_recommendation and
 *     J3's route_validation): DROPPED. No proxy field exists anywhere in wa-inbox's data
 *     model (Task 20 confirmed this); inventing a fake requirement here would be pure
 *     invention, not simplification -- same reasoning Task 22 used to drop
 *     `effective_instant_book_eligible`. Confidence: high (nothing to port against).
 *   - `selected_package_key` (required by J2's standard_price and J4's availability_check):
 *     mapped to wa-inbox's `destination`. Confidence: medium. wa-inbox's TripBrief has no
 *     package-selection concept, so `destination` -- the one field identifying "what is the
 *     customer asking about" -- is the closest available stand-in for "we know which
 *     product to price/check." It is coarser than a real package key (a destination may
 *     have several packages) but is the least-invented option, mirroring Task 22's
 *     `priceIdr`-as-gap-proxy pattern.
 *   - `travel_dates.start` -> `dateRange`, `pax.confirmed` -> `pax`, `destinations` ->
 *     `destination`: direct 1:1 renames, same field semantics just flatter. Confidence: high.
 *
 * `needsLiveData` depends only on job (J4) and message keywords, never on TripBrief
 * completeness, so it ports independently of the TripBrief-shape questions above.
 * Confidence: high.
 */
import type { TripBrief, SalesClassification } from './types'

type Job = SalesClassification['job']

// handoff_rules.mandatory_intents (complaint_or_refund, human_handoff_request) + query_policy
// job_overrides' cancel/refund words (routing YAML lines 27-32) + booking/payment-status
// intents (get_booking_status, get_payment_status -> J5 directly per default_job_by_intent).
const HANDOFF_KEYWORDS = [
  'refund',
  'komplain',
  'keluhan',
  'complaint',
  'cancel',
  'batal',
  'reschedule',
  'ganti jadwal',
  'ubah jadwal',
  'amend',
  'change my booking',
  'human',
  'agent manusia',
  'customer service',
  ' cs ',
  'operator',
  'bicara dengan orang',
  'talk to a human',
  'status pesanan',
  'status booking',
  'status pembayaran',
  'sudah bayar',
  'sudah transfer',
]

// check_availability / query_operational_notice's own keywords (routing YAML default job
// mapping) -- a direct availability question drives the job itself to J4, not just
// needsLiveData, unlike the hard-dependency/guarantee phrases below.
const AVAILABILITY_KEYWORDS = [
  'slot',
  'kosong',
  'tersedia',
  'ketersediaan',
  'available',
  'availability',
  'stok',
  'reopen',
  'buka lagi',
  'is it open',
  'will it reopen',
  'current status',
  'status terkini',
]

// guardrails-and-state.yaml's attraction_hard_dependency.trigger_phrases (lines 8-13) and
// .guarantee_phrases (lines 16-20): these force a live_check action (needsLiveData) but do
// NOT by themselves change the resolved job -- they can co-occur with any job.
const LIVE_DATA_ONLY_KEYWORDS = [
  'main reason',
  'must see',
  'definitely want',
  'otherwise we go elsewhere',
  'otherwise we will go elsewhere',
  'blue fire is why',
  'blue lava is why',
  'why we are coming',
  'guarantee',
  'guaranteed',
  '100%',
  'certain',
  'definitely be open',
]

// plan_itinerary's default job + query_package_details' connection-word override (routing
// YAML lines 24-26) + guardrails' connection_keywords (guardrails YAML line 58).
const ROUTE_KEYWORDS = [
  'finish',
  'drop',
  'endpoint',
  'flight',
  'ferry',
  'train',
  'airport',
  'start in',
  'pickup',
  'jadwal',
  'pesawat',
  'kereta',
  'feri',
  'dijemput',
  'penjemputan',
  'jemput',
  'harbour',
  'harbor',
  'station',
  'depart',
  'catch',
]

// check_price's default job + query_package_details' price-word override (routing YAML
// lines 21-23) + query_policy's payment-word override (lines 33-35).
const PRICE_KEYWORDS = [
  'price',
  'cost',
  'how much',
  'included',
  'inclusion',
  'include',
  'harga',
  'berapa',
  'termasuk',
  'biaya',
  'deposit',
  'tax',
  'pajak',
  'fee',
]

// Per-job required TripBrief fields, ported from requirement_profiles (routing YAML lines
// 66-97) with pickup.location/dropoff.location/selected_package_key mapped or dropped as
// documented in the file header.
const REQUIRED_FIELDS_BY_JOB: Record<Job, Array<keyof TripBrief>> = {
  J1: ['destination'],
  J2: ['destination', 'pax'],
  J3: ['destination', 'dateRange', 'pax'],
  J4: ['destination', 'dateRange', 'pax'],
  J5: [],
}

function includesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle))
}

// Ports sales_intelligence.py's `_EMPTY = (None, "", [], {})` (line 27): absent or
// present-but-empty-string both count as missing. Deliberately does NOT treat `0` as
// missing (0 is not in the real _EMPTY tuple either) -- pax=0 is a corner case the real
// source itself doesn't special-case here (it's `customer_sales_executor.py`'s pricing
// lookup, a different file, that separately rejects `pax < 1`).
function isMissing(value: string | number | undefined): boolean {
  return value === undefined || value === null || value === ''
}

export function classifySalesNeed(input: { message: string; tripBrief: TripBrief }): SalesClassification {
  const { message, tripBrief } = input
  const text = message.toLowerCase()

  let job: Job
  if (includesAny(text, HANDOFF_KEYWORDS)) {
    job = 'J5'
  } else if (includesAny(text, AVAILABILITY_KEYWORDS)) {
    job = 'J4'
  } else if (includesAny(text, ROUTE_KEYWORDS)) {
    job = 'J3'
  } else if (includesAny(text, PRICE_KEYWORDS)) {
    job = 'J2'
  } else {
    job = 'J1'
  }

  const missingInfo = REQUIRED_FIELDS_BY_JOB[job].filter((field) => isMissing(tripBrief[field]))

  const needsLiveData = job === 'J4' || includesAny(text, LIVE_DATA_ONLY_KEYWORDS)

  return { job, missingInfo, needsLiveData }
}
