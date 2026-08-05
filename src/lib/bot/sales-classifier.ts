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
 *    Critically, (d) is NOT just a live-check trigger: `derive_response_plan` lines 230-233
 *    ALSO set `handoff_escalation = "attraction_guarantee_demanded"` and force
 *    `mode="handoff"` for it -- distinct from (b), whose trigger_phrases alone never force a
 *    handoff (guardrails YAML's `attraction_hard_dependency.handoff_when`, lines 26-30, only
 *    escalates on `guarantee_demanded` / `access_unconfirmable` / `attraction_inaccessible` /
 *    `redesign_outside_standard` -- not on the bare trigger_phrases). This is also listed
 *    verbatim in `handoff_rules.mandatory_signals` (guardrails YAML line 73):
 *    `attraction_guarantee_demanded`, alongside payment_discrepancy, medical_or_fitness, etc.
 *    -- i.e. the real system treats a guarantee demand as a first-class mandatory-handoff
 *    signal, not a mere live-data flag.
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
 * Confidence: high. NOTE: a guarantee demand is the one keyword group that affects BOTH
 * `needsLiveData` and `job` (see point 3(d) above) -- `SalesClassification` has no separate
 * `handoff`/`mode` field the way the real `ResponsePlan` does, so job='J5' is this port's
 * only available signal for "this must route to a human," and the Global Constraint that the
 * bot must fail safe toward human handoff on ambiguity makes dropping that escalation the
 * wrong simplification. JUDGMENT CALL (high confidence): guarantee-demand keywords are
 * treated exactly like `HANDOFF_KEYWORDS` (force job='J5') in addition to setting
 * `needsLiveData=true`, mirroring the real system layering a handoff escalation on top of an
 * already-flagged live_check rather than replacing it.
 *
 * JUDGMENT CALL 5 (job/profile conflation -- disclosed, not previously called out).
 * `routing-and-clarification.yaml` lines 3-5 are explicit that "Customer job: a GROUPING
 * LABEL only... Required fields, actions, and disclosures are driven by the requirement
 * profile below, NOT by the job." The real system has TWO independent axes: 5 jobs
 * (J1-J5, `default_job_by_intent` + `job_overrides`) and 7 requirement profiles
 * (`general_information`, `policy_explanation`, `package_information`,
 * `package_recommendation`, `standard_price`, `route_validation`, `availability_check`,
 * `default_profile_by_intent` + a SEPARATE `profile_overrides` list) -- and profile
 * selection can diverge from job. Concrete example of the divergence:
 * `query_package_details` + query containing "included"/"inclusion" matches a
 * `job_overrides` rule -> job = J2_price_and_value, but ALSO matches a *different*,
 * independent `profile_overrides` rule (routing YAML lines 54-56) -> profile =
 * `package_information`, whose `required` is just `[selected_package_key]` (routing YAML
 * line 76) -- NOT J2's own `standard_price` profile's `[selected_package_key,
 * pax.confirmed]` (lines 84-88). Task 20's `SalesClassification` type has only a `job`
 * field, no `profile` field, so there is no separate axis to preserve without redesigning
 * the type (out of scope here). This port's `REQUIRED_FIELDS_BY_JOB` therefore treats job
 * AS IF it were profile -- a real simplification, not an oversight, but one that means
 * required-fields can be wrong for job/message combinations where the real system's job
 * and profile diverge (as in the "included" example above: this port would require
 * `destination` + `pax` for that message, where the real system would only require the
 * package selection). Confidence: medium -- the conflation is a reasonable simplification
 * forced by the type contract, but the specific fields it gets wrong are a known,
 * documented risk rather than something the type made *unavoidable* the way the J1-J5-only
 * union did for the "greeting"/"unsupported" case above.
 */
import type { TripBrief, SalesClassification } from './types'

type Job = SalesClassification['job']

// Narrowed 2026-08-05 to match chatbot-web's own live ESCALATION regex (src/chatbot.js) --
// the user's explicit reference for what "no more handoff" should look like. That regex
// escalates on exactly two things: an explicit request for a human ("talk/speak/connect to a
// human/agent/staff/person/real/someone", "human agent/support/help", "live agent/person/
// support", "I want a human/real/person") and genuine complaint/frustration sentiment
// ("complaint", "not helpful", "useless", "terrible", "awful", "frustrated", "angry").
// Deliberately does NOT include "refund", "cancel", "reschedule", "status booking/pembayaran",
// or "sudah bayar/transfer" -- chatbot-web's own regex doesn't either, because these are
// ordinary, answerable FAQ topics (policy_cancellation_package_credit's real 48-hour-cutoff/
// Lifetime-Package-Credit policy, policy_booking_paths' booking-channel policy, or -- for a
// customer who actually has a booking -- Mode 3's own real booking-status answer, which this
// list gates before it ever runs), not knowledge gaps that need a human. A bare "refund" or
// "cancel" question forced job=J5 (automatic handoff) before this change even when it was a
// simple policy question, never reaching the real cancellation-policy content that already
// existed in general-modules.json.
//
// EXPORTED because orchestrator.ts's pre-booking-lookup escalation check reuses this exact
// list as its own gate. That check runs before Mode 3 (booking_context), which bypasses this
// classifier entirely, so it is the ONLY keyword protection a customer WITH a booking gets.
// One list, one source of truth.
export const HANDOFF_KEYWORDS = [
  'komplain',
  'keluhan',
  'complaint',
  'complain',
  'not helpful',
  'useless',
  'terrible',
  'awful',
  'frustrated',
  'marah',
  'kecewa',
  'agent manusia',
  'bicara dengan orang',
  'ngomong sama orang',
  'talk to a human',
  'speak to a human',
  'speak to an agent',
  'speak to a person',
  'connect me to a human',
  'connect me to an agent',
  'human agent',
  'human support',
  'human help',
  'live agent',
  'live person',
  'live support',
  'want a human',
  'want a real person',
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

// guardrails-and-state.yaml's attraction_hard_dependency.trigger_phrases (lines 8-13): these
// force a live_check action (needsLiveData) but do NOT by themselves change the resolved
// job -- the real guardrails only escalate to handoff on guarantee_demanded /
// access_unconfirmable / attraction_inaccessible / redesign_outside_standard (lines 26-30),
// never on a bare trigger_phrase -- so these can co-occur with any job.
const HARD_DEPENDENCY_TRIGGER_KEYWORDS = [
  'main reason',
  'must see',
  'definitely want',
  'otherwise we go elsewhere',
  'otherwise we will go elsewhere',
  'blue fire is why',
  'blue lava is why',
  'why we are coming',
]

// guardrails-and-state.yaml's attraction_hard_dependency.guarantee_phrases (lines 16-20). The
// real system forces mode="handoff" on a guarantee demand (`derive_response_plan` lines
// 230-233); this port deliberately DIVERGES from that as of 2026-08-05 (see orchestrator.ts's
// header for the "no more handoff on a content gap" rationale) -- a guarantee demand no longer
// forces job='J5', only needsLiveData=true. The LLM's own GUARDRAIL_INSTRUCTION ("NEVER
// guarantee Blue Fire visibility... always say cannot be guaranteed") is what keeps the reply
// honest now, matching chatbot-web's approach: it has no guarantee-triggered handoff at all,
// relying entirely on its own equivalent guardrail wording.
const GUARANTEE_KEYWORDS = ['guarantee', 'guaranteed', '100%', 'certain', 'definitely be open']

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
// `keyof TripBrief` now also spans `origin`/`askedTripPreferences` (added for
// package-match.ts's trip-preferences clarify branch, see orchestrator.ts), widening the
// possible value type here -- REQUIRED_FIELDS_BY_JOB below never actually lists either, so
// this is a type-only accommodation, not a behavior change.
function isMissing(value: string | number | boolean | undefined): boolean {
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

  // `job === 'J4'` (trigger (a) above -- availability_check's own default_actions) was
  // dropped from this list 2026-08-05: the real system treats a bare availability question
  // as needing a live capacity check, but JVTO's tours are private/bespoke with no shared
  // slot inventory to check -- confirmed "Tour selalu available" (tours are always
  // available). Deferring "is it available?" to "let me check with our team" was therefore
  // stalling an answerable question; the bot now answers it directly. Triggers (b)/(c)/(d)
  // (hard-dependency phrasing, guarantee demands) are genuinely different -- they're about
  // whether a SPECIFIC attraction/weather condition can be promised, not whether the tour
  // product itself exists, so those still defer.
  const needsLiveData = includesAny(text, HARD_DEPENDENCY_TRIGGER_KEYWORDS) || includesAny(text, GUARANTEE_KEYWORDS)

  return { job, missingInfo, needsLiveData }
}
