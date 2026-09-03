/**
 * General-knowledge module resolver -- TypeScript port of chatbot-web's `agentResolver.js`
 * (see /Users/macbook/Code/chatbot-web/src/agentResolver.js), which is itself the piece of
 * jvto-agent-runtime's `module_resolver.py` that catalog.ts's header explicitly says was NOT
 * ported here: `resolve_modules` (module_resolver.py:106-194), which answers module-resolver.ts's
 * full 14 real topics from `general-modules.json` -- data wa-inbox already syncs (byte-identical
 * to chatbot-web's copy, verified 2026-08-04) but never read past the four package-scoped fields
 * catalog.ts's `CatalogPackage` carries.
 *
 * `customer-link-registry.json` itself was live-checked 2026-08-04 and found to have 18 broken
 * (404) URLs across its "existing"-status entries -- a stale scrape against an old site
 * structure. Corrected by copying chatbot-web's own already-fixed copy of the same file (its
 * `src/agent-catalog/customer-link-registry.json`, re-verified live 2026-08-04 against
 * https://javavolcano-touroperator.com/sitemap.xml -- all 31 non-checkout URLs return 200) over
 * both this repo's `catalog/` copy and the upstream sync source in the sibling
 * jvto-whatsapp-agent-runtime repo, so `npm run sync:knowledge` won't reintroduce the breakage.
 *
 * Unlike catalog.ts's package-centric adapter, this file is topic-centric and NOT package-scoped
 * (matching agentResolver.js: module selection is `TOPIC_MODULES[topic]`, independent of which
 * specific package the customer is asking about) -- the same tradeoff chatbot-web already ships
 * with successfully. orchestrator.ts feeds the resolved facts/disclosures into callLLM as
 * grounding, instead of composeResponse's retired deterministic string-concatenation.
 */
import { readCatalogFile } from './catalog'
import type { ResolverTopic } from './module-resolver'

const GENERAL_MODULES_FILE = 'general-modules.json'
const LINK_REGISTRY_FILE = 'customer-link-registry.json'

export type KnowledgeModule = {
  module_id: string
  short_answer?: string
  detail_summary?: string
  customer_visible?: boolean
  approval_status?: string
  link_key?: string
  // Which single destination token (e.g. "ijen", "bromo") this module's content applies to --
  // set only on module_resolver.py's "conditional_variation" inclusion modules (gas mask,
  // health screening, private jeep), never on the destination-scoped modules already handled
  // by resolveKnowledgeForTopic's own `destination_${...}` lookup. See its use below.
  variation_trigger?: string
}

/**
 * General JVTO facts, always available in the system prompt regardless of topic -- ported
 * verbatim (content, not wording style) from chatbot-web's own `src/faqData.js` FAQ_BASE
 * ("=== JVTO FACTS ===" section). chatbot-web's own `buildFaqPrompt` (src/faqPrompt.js) falls
 * back to this exact block whenever its topic-specific module resolution comes up empty, and
 * chatbot-web's ONLY handoff trigger anywhere in its codebase is an explicit human-escalation
 * keyword regex (src/chatbot.js) -- it never hands off on a knowledge gap, because this
 * fallback means there almost never IS one. Reported 2026-08-04: wa-inbox's Mode 1/2 was
 * handing off "genuinely unsupported" topics that this exact fallback text already answers
 * (deposit percentage, Ijen gas mask/health screening, packing list, difficulty per
 * destination, etc.) -- orchestrator.ts's "nothing to answer with" handoff branch is removed
 * entirely now that this is always present; the persona's own "defer to the team" guidance
 * covers whatever residual gap remains.
 */
export const GENERAL_FAQ_FALLBACK = `GENERAL:
- All tours are 100% PRIVATE -- your group only, no strangers ever.
- Guides: certified, English-speaking local guides.
- Tours depart from Surabaya or Bali.

BLUE FIRE (Api Biru) at Ijen:
- A rare natural phenomenon caused by ignited sulfuric gas -- one of Earth's most unique sights.
- NOT guaranteed -- visibility depends on weather, volcanic activity, and local authority clearance.
- Best chance: dry season (April-October), typically between 2am-4am before sunrise.
- Even without blue fire, the sunrise and turquoise crater lake are spectacular.

MEDICAL SCREENING (Ijen hike):
- Required for ALL participants before the Ijen hike.
- Conducted by our licensed doctor on-site before departure.
- Basic fitness check -- anyone with heart, respiratory, or mobility conditions should consult their doctor beforehand.
- The screening takes about 10-15 minutes.

INCLUSIONS (all packages):
- Private transport & dedicated driver throughout the tour.
- Hotel accommodation as per the package duration.
- All entrance tickets to attractions visited.
- Certified English-speaking local guide.
- 4WD Jeep for Bromo (where applicable).
- Gas mask for Ijen hike (where applicable).
- Medical health screening for Ijen hike (where applicable).

EXCLUSIONS (not included):
- International & domestic flights.
- Personal travel insurance.
- Personal expenses, tips, souvenirs.
- Meals unless stated in the specific package itinerary.

PAYMENT:
- Deposit: 20% of total to confirm booking.
- Balance due 3 days before Day 1 via Bank Transfer / Wise / Revolut.
- Cash on Arrival is available for some packages, subject to approval.
- Last-minute bookings (under 6 days before Day 1): 100% full payment via Bank Transfer required.
- Within 14 days of Day 1: JVTO may require full payment instead of the standard deposit.

WHAT TO BRING / PACKING:
- Warm layers / jacket -- Bromo and Ijen are cold at night (5-15°C).
- Sturdy closed-toe walking shoes.
- Headlamp or flashlight (for early morning hikes).
- Sunscreen and sunglasses for daytime.
- Small backpack, water bottle, light snacks.
- Camera or fully charged phone.
- Passport / ID for entrance tickets.

BEST TIME TO VISIT:
- Dry season (April-October): best visibility, highest chance of Blue Fire at Ijen.
- Wet season (November-March): possible rain and fog; Bromo can still be beautiful; Ijen hikes still possible but blue fire less likely.

PHYSICAL DIFFICULTY:
- Bromo: Moderate -- short 15-20 min walk to crater rim across volcanic sand (or horse ride available).
- Ijen: Moderate-Challenging -- 3km hike each way, about 1.5-2 hours, steep in sections; requires good physical fitness.
- Tumpak Sewu: Moderate -- 30-45 min steep descent and ascent; very rewarding.
- Not recommended for guests with serious heart, lung, or severe mobility conditions.

DESTINATIONS:
- Mount Bromo: iconic active volcano, sunrise viewpoints, Sea of Sand, 4WD Jeep ride.
- Ijen Crater: blue fire phenomenon, turquoise sulfuric crater lake, sunrise, sulfur miners.
- Tumpak Sewu: Java's most spectacular multi-tiered waterfall.
- Madakaripura: sacred hidden canyon waterfall, tallest in Java.
- Papuma Beach: pristine hidden beach in Jember, great for sunsets.
- Malang / Batu City: Rainbow Village, apple farms, Batu Night Spectacular.
- Taman Safari Prigen: family-friendly safari park near Bromo (open-air safari).

FERRY / TRANSPORT:
- Java-Bali crossing: done via Ketapang-Gilimanuk ferry, included in overland packages.
- All transport is private and handled by JVTO -- no public buses or shared vans.`

type LinkRecord = { link_key: string; url: string | null; status: string }

// Real: TOPIC_GENERAL_MODULES (module_resolver.py, per catalog.ts's header) -- verbatim from
// chatbot-web's already-working `TOPIC_MODULES` (agentResolver.js:64-79), the same mapping this
// app's own general-modules.json module_ids resolve against (identical file, confirmed byte-for-
// byte equal to chatbot-web's copy).
const TOPIC_MODULES: Record<ResolverTopic, string[]> = {
  // The seven `inclusion_component` modules and `policy_inclusions_exclusions`
  // are `scope: "global"`, and catalog.ts's buildNoteIndex deliberately skips
  // global scope (a global fact is not a per-package policy note). Nothing else
  // ever picked them up either, so the facts that apply to EVERY package were
  // the only ones with no route into a reply at all -- listed explicitly here,
  // which is the path built for exactly this.
  inclusions: [
    'inclusion_all_inclusive_baseline',
    'exclusion_standard',
    'policy_inclusions_exclusions',
    'inclusion_private_transport',
    'inclusion_dedicated_crew',
    'inclusion_entrance_permits',
    'inclusion_drinking_water',
    'inclusion_stated_meals',
    'inclusion_pickup_dropoff_assistance',
  ],
  price: ['inclusion_all_inclusive_baseline', 'service_private_tour_standard', 'service_vehicle_by_pax'],
  private_tour: ['service_private_tour_standard', 'service_crew_language_standard'],
  vehicle: ['service_vehicle_by_pax'],
  rooming: ['service_standard_rooming'],
  hotel: ['service_standard_rooming'],
  route_endpoint: [],
  destination_readiness: [],
  booking: ['policy_booking_paths', 'policy_anti_fraud'],
  payment: ['policy_payment_deposit', 'policy_anti_fraud', 'policy_cancellation_package_credit'],
  cancellation: ['policy_cancellation_package_credit'],
  // 'policy_ijen_crater_access_status' added 2026-08-05, operator-confirmed: official access
  // down into the crater for close-up blue fire is currently closed, but the summit
  // sunrise-viewpoint hike, blue crater-lake view, and surrounding mountain scenery are still
  // open -- current, time-sensitive operational status, not the evergreen "can't guarantee
  // weather" policy or the fixed monthly Rijik closure, so kept as its own module.
  blue_fire: ['policy_natural_phenomena', 'policy_ijen_crater_access_status', 'destination_ijen'],
  greeting: [],
  general: ['inclusion_all_inclusive_baseline', 'service_private_tour_standard'],
}

// Content that applies only under a customer-STATED condition (being a student, traveling in
// a large group, a Bali-linked route needing the ferry crossing) -- no topic or destination
// context can ever detect these, only the customer's own words can, so they're checked
// independent of (and in addition to) TOPIC_MODULES/destination-variation lookup. Added
// 2026-08-05: general-modules.json carries `scope: "conditional_eligible"` (ISIC student
// pricing) and `conditional_large_group"` (police escort) modules specifically BECAUSE
// catalog.ts's own policyNotes join deliberately excludes conditional scopes (a condition the
// catalog itself cannot evaluate, see that file's header) -- but nothing else ever picked them
// up either, so "do you have student pricing?" had zero real facts to answer from despite the
// content existing, approved and customer-visible, all along. `inclusion_east_java_bali_ferry`
// is the 4th `conditional_variation` module never reached by the destination-variation lookup
// either (its trigger is "ferry", not one of the 5 real destination tokens).
// 'service_dietary_preference_noted' added 2026-08-05: reported, a customer's dietary
// accommodation request ("please make sure her meals don't contain beef") had no real module
// to answer from at all -- no topic keyword bucket recognized it (falls to classifyTopic's
// 'general' job-default) and no catalog content addressed dietary restrictions. Confirmed
// directly with the operator: this is a per-customer preference to note for their trip, not a
// specific accommodation guarantee to fabricate -- so the fact is an honest "noted", not an
// invented capability claim.
// 'policy_official_invoice'/'policy_emergency_and_support' added 2026-08-05: reported, a real
// customer asked "will you send an official booking confirmation or invoice under PT Java
// Volcano Rendezvous?" and "do you have a replacement arrangement and an emergency contact we
// can reach at any time?" -- the bot deferred both to "let me check with our team" even though
// genuine, live, customer-facing content answers them (javavolcano-touroperator.com's own
// booking-payment-cancellation, safety-on-tours, and contact pages, cross-checked against
// jvto-web's real source 2026-08-05). Neither maps cleanly to an existing topic bucket
// ("invoice" isn't the same as 'payment'/deposit; "emergency"/"replacement driver" isn't
// 'vehicle', which is about pax-based vehicle sizing), hence keyword-triggered like the others.
// `description` (added 2026-08-07) is the plain-English gloss of each trigger, used by
// topic-classifier.ts's sibling -- keyword-module-classifier.ts's LLM-primary resolver -- as
// the ONLY source of truth for what each module is about; `keywords` remains the regex fallback
// for when that LLM call fails technically. Single array, single source, deliberately: this file
// already carries one documented instance of two hand-maintained copies of "the same" list
// silently drifting (see ATTRACTION_TRIGGER_PHRASES's own comment) -- a second `description`
// array next to this one would risk exactly that again.
export const KEYWORD_TRIGGERED_MODULES: Array<{ moduleId: string; description: string; keywords: string[] }> = [
  { moduleId: 'policy_isic_student', description: 'Asks about ISIC/student ID discount pricing.', keywords: ['isic', 'student'] },
  { moduleId: 'policy_police_escort', description: 'Asks about a police escort for a large group.', keywords: ['police escort', 'escort'] },
  {
    moduleId: 'inclusion_east_java_bali_ferry',
    description: 'Asks whether the Ketapang-Gilimanuk ferry crossing to/from Bali is included.',
    keywords: ['ferry', 'ketapang', 'gilimanuk'],
  },
  {
    moduleId: 'service_dietary_preference_noted',
    description: 'States a dietary restriction, allergy, or food preference (halal, vegetarian, vegan, no beef/pork, gluten-free, etc.).',
    keywords: ['beef', 'pork', 'halal', 'vegetarian', 'vegan', 'allerg', 'gluten', 'dietary', 'no meat'],
  },
  {
    moduleId: 'policy_official_invoice',
    description: 'Asks for an official invoice, e-voucher, or booking confirmation under a company/organization name.',
    keywords: ['invoice', 'e-voucher', 'evoucher', 'official confirmation', 'official booking confirmation', 'pt java volcano'],
  },
  {
    moduleId: 'policy_emergency_and_support',
    description: 'Asks about an emergency contact, a driver/vehicle breaking down, a backup vehicle/driver, or 24/7 support during the tour.',
    // Reported live 2026-08-05: "If the driver or vehicle breaks down during the tour, is
    // there a backup unit ready?" matched none of the original literal phrases ('vehicle
    // breakdown', 'backup vehicle') -- a customer's own wording ("breaks down", "backup unit")
    // doesn't reliably match the noun form the module was originally titled after. Broadened
    // to the underlying words/fragments themselves rather than exact multi-word phrases.
    keywords: [
      'emergency contact', 'emergency', 'replacement driver', 'replacement vehicle', 'replacement arrangement',
      'vehicle breakdown', 'break down', 'breaks down', 'broke down', 'broken down',
      'driver unavailable', 'vehicle unavailable', 'backup vehicle', 'backup driver', 'backup unit',
      'spare vehicle', 'spare driver', 'reachable at any time', 'reach you any time', '24/7', '24 hours',
    ],
  },
  {
    moduleId: 'policy_cancellation_package_credit',
    description: 'Asks about cancellation, refund, reschedule, or travel credit terms.',
    // Reported live 2026-08-06: a real customer's itemized quotation request included
    // "cancellation and refund terms" as one of several bundled asks. The primary topic
    // classified as 'price' (not 'cancellation'/'payment', TOPIC_MODULES' own gate for this
    // module), so the LLM had no real facts for that bullet and defaulted to "let me check with
    // our team" even though the full 48h-cutoff/Lifetime-Package-Credit policy (and its live
    // link) already exists. Kept independent of topic classification so a cancellation/refund
    // mention buried inside a message about something else still surfaces the real policy.
    keywords: ['cancellation', 'cancel', 'refund', 'reschedule terms', 'travel credit'],
  },
  {
    moduleId: 'policy_ijen_crater_access_status',
    description: 'Asks about the current access status for the Ijen Blue Fire crater itself (going down into the crater, not just the summit/sunrise hike).',
    // Kept independent of topic classification (not just TOPIC_MODULES.blue_fire) so a "blue
    // fire" mention buried inside a message that classifies to an earlier-checked topic (e.g.
    // 'payment' via a bare "pay" match) still surfaces this current access status.
    // 'blue flames'/'blue flame' added 2026-08-06 -- see module-resolver.ts's blue_fire topic
    // for the real customer conversation that used this exact phrasing throughout.
    keywords: ['blue fire', 'blue-fire', 'bluefire', 'blue flames', 'blue flame', 'crater access', 'kawah ijen'],
  },
  // 'service_drone_usage' added 2026-08-05, refined 2026-08-06: researched jvto-web,
  // jvto-itinerary-core, jvto-whatsapp-agent-runtime, chatbot-web, and the live site for a
  // per-destination drone policy -- only one general fact existed in any of those sources
  // (jvto-web's src/data.ts "special-services" FAQ entry). The operator then confirmed the
  // real per-destination rules directly: Bromo requires a Rp2.000.000 permit, arranged
  // directly with the national park authority (not something JVTO arranges); Ijen currently
  // does not allow drones at all. No specific rule is published for Madakaripura/Papuma/
  // Tumpak Sewu, so none is fabricated for them either. Reported 2026-08-07: the underlying
  // fact text (catalog/general-modules.json) used to name the park's own booking site
  // (bromotenggersemeru.id) directly -- dropped per the operator's policy of never mentioning
  // any link other than JVTO's own, while keeping the real price/arrangement facts.
  {
    moduleId: 'service_drone_usage',
    description: 'Asks about bringing or using a drone during the tour.',
    keywords: ['drone', 'uav', 'aerial photography', 'aerial footage', 'aerial video'],
  },
  // 'policy_bromo_seasonal_closures'/'service_jacket_rental'/'service_shoe_rental'/
  // 'service_ijen_trolley'/'service_custom_destination_addon' added 2026-08-06, all
  // operator-confirmed real facts: Bromo has no fixed monthly closure like Ijen, but the
  // annual Yadnya Kasada ceremony (dates shift yearly) makes the area extremely crowded and
  // triggers JVTO's Plan-B framework; jacket rental (~Rp35,000, both Bromo and Ijen), shoe
  // rental (Ijen only), and the Ijen crater trolley/ojek (~Rp1.5-2M) are all real on-site
  // services previously reported as gaps in the 2026-08-06 message audit.
  {
    moduleId: 'policy_bromo_seasonal_closures',
    description: 'Asks whether Bromo is open/closed, or about the Yadnya Kasada ceremony.',
    keywords: ['yadnya kasada', 'kasada', 'is bromo open', 'bromo closed', 'bromo closure', 'bromo open'],
  },
  {
    moduleId: 'service_jacket_rental',
    description: 'Asks about renting a jacket on-site.',
    keywords: ['rent a jacket', 'rent jacket', 'jacket rental', 'sewa jaket', 'rental jaket'],
  },
  {
    moduleId: 'service_shoe_rental',
    description: 'Asks about renting shoes on-site for the Ijen hike.',
    keywords: ['rent shoes', 'rental shoes', 'shoe rental', 'sewa sepatu', 'rental sepatu'],
  },
  {
    moduleId: 'service_ijen_trolley',
    description: 'Asks about the trolley/ojek transport option up the Ijen crater.',
    keywords: ['trolley', 'ojek ijen', 'gondola'],
  },
  // Destinations genuinely outside the 5-destination catalog, reported in the 2026-08-06
  // audit -- real customer requests to extend a tour to these got no real fact to answer
  // from. Deliberately excludes bare 'yogyakarta'/'jogja' -- package-match.ts's
  // mentionedUnsupportedOriginCity already handles a Yogyakarta PICKUP request with its own,
  // more specific note; this module is about wanting to VISIT a place outside the catalog
  // (Borobudur/Prambanan specifically, not "Yogyakarta" as a bare city name, which is too
  // often just the pickup-point case already covered elsewhere).
  {
    moduleId: 'service_custom_destination_addon',
    description:
      "Asks about visiting a destination outside JVTO's standard 5 (Bromo, Ijen, Tumpak Sewu, Madakaripura, Papuma) -- e.g. Borobudur, Prambanan, Baluran, Tangkuban Perahu.",
    keywords: ['borobudur', 'prambanan', 'baluran', 'tangkuban perahu', 'de djawatan', 'kawah wurung', 'blawan'],
  },
]

// Whether `message` matches a KEYWORD_TRIGGERED_MODULES keyword, independent of topic
// classification entirely (these modules fire "regardless of topic" inside
// resolveKnowledgeForTopic below). Used by orchestrator.ts's pre-destination branch: a topic
// like 'general' always has non-empty baseline facts (TOPIC_MODULES.general), so checking
// "does resolveKnowledgeForTopic return anything" alone can't distinguish a genuine keyword
// hit (dietary/ISIC/escort/ferry) from an ordinary unclassified message -- this lets that
// branch ask specifically "did a keyword actually match" instead.
export function hasKeywordTriggeredModule(message: string): boolean {
  const low = (message ?? '').toLowerCase()
  return KEYWORD_TRIGGERED_MODULES.some(({ keywords }) => keywords.some((k) => low.includes(k)))
}

// Reported 2026-08-06: the start/finish/day-count funnel gate (orchestrator.ts) returns a
// static template BEFORE ever reaching resolveKnowledgeForTopic's system-prompt composition
// -- so a message like "How much to rent a jacket, and is there a trolley up Ijen crater?"
// (which also happens to classify as topic 'price', triggering the funnel) got its actual,
// answerable questions silently dropped, re-asking for start/finish/duration as if nothing
// had been asked. Isolated from resolveKnowledgeForTopic's own factualLines (which always
// includes non-keyword-triggered baseline facts like TOPIC_MODULES.general's) so the funnel
// reply only gets genuinely keyword-matched facts, not generic filler on every message.
export function resolveKeywordTriggeredFacts(message: string): string[] {
  const low = (message ?? '').toLowerCase()
  const modules = loadModules()
  const facts: string[] = []
  for (const { moduleId, keywords } of KEYWORD_TRIGGERED_MODULES) {
    if (!keywords.some((k) => low.includes(k))) continue
    const m = modules[moduleId]
    if (!m || (m.approval_status && !m.approval_status.startsWith('approved'))) continue
    if (m.customer_visible === false || !m.short_answer) continue
    facts.push(m.short_answer)
  }
  return facts
}

/**
 * Resolves real facts for an already-known set of module IDs (from
 * keyword-module-classifier.ts's LLM-primary resolver, which validates its own output against
 * `KEYWORD_TRIGGERED_MODULES`' real module_id set before ever calling this) -- same
 * approved/customer_visible/short_answer filtering as resolveKeywordTriggeredFacts above, just
 * driven by a caller-supplied ID list instead of re-scanning the message's own keywords.
 */
export function factsForModuleIds(moduleIds: string[]): string[] {
  const modules = loadModules()
  const facts: string[] = []
  for (const moduleId of moduleIds) {
    const m = modules[moduleId]
    if (!m || (m.approval_status && !m.approval_status.startsWith('approved'))) continue
    if (m.customer_visible === false || !m.short_answer) continue
    facts.push(m.short_answer)
  }
  return facts
}

let _modules: Record<string, KnowledgeModule> | null = null
let _linkIndex: Map<string, LinkRecord[]> | null = null

/** Test-only: clears the lazy cache so a test's own catalog fixtures aren't shadowed by a real one. */
export function __resetKnowledgeCacheForTests(): void {
  _modules = null
  _linkIndex = null
}

function loadModules(): Record<string, KnowledgeModule> {
  if (_modules) return _modules
  const raw = readCatalogFile(GENERAL_MODULES_FILE)
  const list = Array.isArray(raw) ? (raw as KnowledgeModule[]) : []
  _modules = Object.fromEntries(list.filter((m) => m && typeof m.module_id === 'string').map((m) => [m.module_id, m]))
  return _modules
}

function loadLinkIndex(): Map<string, LinkRecord[]> {
  if (_linkIndex) return _linkIndex
  const raw = readCatalogFile(LINK_REGISTRY_FILE) as { links?: LinkRecord[] } | null
  const records = Array.isArray(raw?.links) ? raw.links : []
  const index = new Map<string, LinkRecord[]>()
  for (const r of records) {
    if (!r || typeof r.link_key !== 'string') continue
    const bucket = index.get(r.link_key) ?? []
    bucket.push(r)
    index.set(r.link_key, bucket)
  }
  _linkIndex = index
  return index
}

/**
 * Resolves one module's `link_key` to a single live URL -- never guesses when a key maps to
 * more than one URL (ambiguous) or when the registry hasn't confirmed the page exists yet.
 */
function resolveLink(linkKey: string | undefined): string | null {
  if (!linkKey) return null
  const records = loadLinkIndex().get(linkKey)
  if (!records || records.length !== 1) return null
  const record = records[0]
  if (record.status !== 'existing' || !record.url) return null
  return record.url
}

// Real: DISCLOSURES + _disclosures_for (module_resolver.py), verbatim from agentResolver.js's
// canonical strings (guardrails-and-state.yaml's required_disclosures).
const DISCLOSURES = {
  // Reworded 2026-08-05, confirmed with the operator: tours are nearly always available (only
  // rarely closed), and the real availability check for a specific date already happens
  // automatically at checkout -- the old wording ("not yet confirmed") was making the LLM ask
  // the customer for their travel dates "to verify" before recommending they book at all,
  // which is friction for something checkout already handles. Say so plainly instead.
  availabilityNotConfirmed:
    'Nearly always available -- exact availability for a specific date is confirmed automatically at checkout, so encourage the customer to go ahead and book rather than asking for their dates first "to verify".',
  noGuaranteeAccess:
    'Attraction access such as Blue Fire, along with weather and sunrise, cannot be guaranteed; it depends on current conditions and the authorities.',
}

const GUARANTEE_PHRASES = ['guarantee', 'guaranteed', '100%', 'certain', 'definitely be open']
// Meant to mirror sales-classifier.ts's HARD_DEPENDENCY_TRIGGER_KEYWORDS exactly (same
// real-system concept, guardrails-and-state.yaml's attraction_hard_dependency.trigger_phrases)
// -- found drifted 2026-08-07 during an audit of manual-matching surfaces: 'blue fire is why'
// was present in that file's copy but missing from this one, silently under-covering this list
// for as long as the two existed independently. Kept in sync manually; a genuine hazard of two
// hand-maintained copies of the same list, flagged for the operator alongside the audit that
// found it.
const ATTRACTION_TRIGGER_PHRASES = [
  'main reason',
  'must see',
  'definitely want',
  'otherwise we go elsewhere',
  'otherwise we will go elsewhere',
  'blue fire is why',
  'blue lava is why',
  'why we are coming',
]

// Injected into the LLM system prompt verbatim -- same wording as agentResolver.js's
// GUARDRAIL_INSTRUCTION, since these are policy statements, not code logic to "port" per se.
export const GUARDRAIL_INSTRUCTION = `=== STRICT GUARDRAILS -- NEVER VIOLATE ===
- NEVER guarantee Blue Fire visibility, sunrise, or crater access -- always say "cannot be guaranteed"
- NEVER state prices as final -- add "subject to availability and confirmation"
- NEVER predict weather for specific dates
- Tours are private and nearly always available (only rarely closed) -- exact availability for a specific date is confirmed automatically at checkout, not something the customer needs to give you their dates for first. NEVER ask "please let us know your travel dates so we can verify" or similar -- state the price/details and encourage them to go ahead and book; checkout confirms their exact date.
- NEVER make up tour inclusions, URLs, or prices not present in the knowledge above`

function getTopicDisclosures(topic: ResolverTopic, hasIjen: boolean): string[] {
  const out: string[] = []
  if (topic === 'price') out.push(DISCLOSURES.availabilityNotConfirmed)
  if ((topic === 'blue_fire' || topic === 'destination_readiness') && hasIjen) {
    out.push(DISCLOSURES.noGuaranteeAccess)
    if (topic === 'destination_readiness') {
      out.push(
        'Ijen access depends on authority/safety conditions, and a mandatory health screening (certificate required for every guest) applies before crater entry.'
      )
    }
  }
  if (topic === 'vehicle') out.push('Oversized or special luggage needs a live check before it is confirmed.')
  if (topic === 'rooming' || topic === 'hotel') {
    out.push('Exact rooming and upgrades are subject to confirmation.')
    // Operator-confirmed 2026-08-06: for a specific hotel NAME, point to this package's own
    // detail page (not a generic policy page) -- that's where it's actually listed, rather
    // than deferring vaguely to "our team will confirm."
    out.push("For the specific hotel name, point the customer to this package's own detail page (link below) -- that's where it's listed.")
  }
  return out
}

// Reported in the 2026-08-06 message audit: general-modules.json's 16 route_leg_* modules
// carry real, operator-sourced travel-time estimates (duration_text, e.g. "Surabaya Airport
// to Bromo Area: ±3.5-4.5 hours") but were never customer_visible and had no short_answer at
// all -- customers asking "how many hours from X to Y" or asking about every leg of a
// multi-day itinerary got nothing. Kept OUT of TOPIC_MODULES/KEYWORD_TRIGGERED_MODULES
// deliberately: there are 16 of them, one per specific leg, so dumping all 16 into every
// route question would bury the one the customer actually asked about -- looked up directly
// by which place-names the message actually mentions instead.
const ROUTE_NODE_NAMES = [
  'surabaya', 'bali', 'bromo', 'ijen', 'madakaripura', 'malang',
  'tumpak sewu', 'ketapang', 'banyuwangi', 'bondowoso', 'gilimanuk',
]
// A pair can legitimately have MORE THAN ONE real leg: a Surabaya hotel pickup
// and a Surabaya airport pickup are different drives with different published
// durations, and a single-id map silently kept only whichever was written
// first. Returning both, in listed order, is more accurate than picking one --
// the customer knows which of the two applies to them, and the model is told
// both rather than asserting the wrong one.
// Symmetric by construction (see resolveRouteLegFacts below, which checks both orderings) --
// only one direction needs to be listed per pair.
const ROUTE_LEG_MODULE_BY_PAIR: Record<string, string[]> = {
  'surabaya:bromo': ['route_leg_surabaya_airport_to_bromo_area', 'route_leg_surabaya_hotel_to_bromo_area'],
  'bromo:madakaripura': ['route_leg_bromo_area_to_madakaripura'],
  'bromo:ijen': ['route_leg_bromo_area_to_bondowoso_ijen_area'],
  'bromo:bondowoso': ['route_leg_bromo_area_to_bondowoso_ijen_area'],
  'bondowoso:ijen': ['route_leg_bondowoso_ijen_area_to_ijen_crater', 'route_leg_bondowoso_to_ijen_base'],
  'ijen:ketapang': ['route_leg_ijen_area_to_ketapang_harbor', 'route_leg_ijen_base_to_ketapang_harbor'],
  'surabaya:ijen': ['route_leg_surabaya_to_bondowoso_ijen_area'],
  'surabaya:tumpak sewu': ['route_leg_surabaya_to_tumpak_sewu'],
  'tumpak sewu:bromo': ['route_leg_tumpak_sewu_to_bromo_area'],
  'banyuwangi:ijen': ['route_leg_banyuwangi_to_ijen_base'],
  'ketapang:gilimanuk': ['route_leg_ketapang_harbor_to_gilimanuk_bali_side'],
  'bali:ijen': ['route_leg_bali_hotel_area_to_banyuwangi_ijen_area'],
  'bali:banyuwangi': ['route_leg_bali_hotel_area_to_banyuwangi_ijen_area'],
  'bromo:malang': ['route_leg_bromo_area_to_malang'],
  'malang:surabaya': ['route_leg_malang_to_surabaya'],
}
const TRAVEL_TIME_QUESTION_PATTERN =
  /\b(how (many |long )?hours?|how long|travel time|drive time|driving time|jam perjalanan|berapa jam|lama perjalanan)\b/

/**
 * Real drive-time facts for whichever specific leg(s) the message actually asks about --
 * `null`/skipped when the message doesn't look like a travel-time question at all, so this
 * never fires on an unrelated mention of two place names in the same message.
 */
export function resolveRouteLegFacts(message: string): string[] {
  const low = (message ?? '').toLowerCase()
  if (!TRAVEL_TIME_QUESTION_PATTERN.test(low)) return []
  const nodes = ROUTE_NODE_NAMES.filter((n) => low.includes(n))
  const modules = loadModules()
  const seen = new Set<string>()
  const facts: string[] = []
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const moduleIds =
        ROUTE_LEG_MODULE_BY_PAIR[`${nodes[i]}:${nodes[j]}`] ?? ROUTE_LEG_MODULE_BY_PAIR[`${nodes[j]}:${nodes[i]}`] ?? []
      for (const moduleId of moduleIds) {
        if (seen.has(moduleId)) continue
        const m = modules[moduleId]
        if (!m || m.customer_visible === false || !m.short_answer) continue
        seen.add(moduleId)
        facts.push(m.short_answer)
      }
    }
  }
  return facts
}

export type ResolvedKnowledge = {
  factualLines: string[]
  detailLines: string[]
  primaryLink: string | null
  disclosures: string[]
  /** True only when a guarantee was demanded about attraction access -- escalate, never promise. */
  handoffRequired: boolean
}

/**
 * Resolves customer-facing facts for one classified topic (module-resolver.ts's `classifyTopic`,
 * already a faithful full-14-topic port) -- the module-selection + link-resolution +
 * disclosure-assembly step catalog.ts's header names as the thing that was never ported. Not
 * package-scoped: mirrors agentResolver.js's own FAQ-time behavior of resolving links without a
 * package_key (ambiguous keys resolve to no link rather than guessing).
 *
 * `destination` is the one deliberate divergence from chatbot-web's `agentResolver.js`: that repo
 * runs FAQ-time with no package/destination context at all, so it leaves `destination_readiness`
 * (a topic covering all 5 destinations) with an empty module list rather than guess which one.
 * orchestrator.ts, unlike chatbot-web, has ALREADY matched a specific destination by this point
 * (matchDestination/tripBrief) -- passing it through lets a destination_readiness question (e.g.
 * "is ijen safe?") resolve the matching single `destination_<token>` module (and its link, e.g.
 * the Ijen destination guide) instead of falling all the way back to the generic package page.
 *
 * `keywordTriggeredModuleIds` (added 2026-08-07): when the caller has already resolved
 * KEYWORD_TRIGGERED_MODULES hits via keyword-module-classifier.ts's LLM-primary path (validated
 * against the real module_id set there), pass them here directly instead of letting this
 * function re-scan `message`'s own keywords -- keeps the LLM-primary result as the single source
 * of truth used everywhere it matters, not just wherever happened to call the new classifier.
 * Omitted (the default) falls back to the original keyword scan unchanged, so every existing
 * caller/test that doesn't know about the new classifier keeps its current behavior exactly.
 */
export function resolveKnowledgeForTopic(
  topic: ResolverTopic,
  message: string,
  destination?: string,
  keywordTriggeredModuleIds?: string[]
): ResolvedKnowledge {
  const modules = loadModules()
  const low = (message ?? '').toLowerCase()

  // Reported live 2026-08-07: checking only the CURRENT message's raw text missed a real
  // follow-up like "is the hike difficult?" after Ijen was already established as the resolved
  // `destination` in an earlier turn -- 'destination_readiness' matches via 'difficult'/'hike'
  // keywords with no literal "ijen" needed, so the real access/health-screening disclosure was
  // silently dropped even though the customer is unambiguously still asking about Ijen. Checked
  // additively against the resolved, cross-turn `destination` too, never removing the existing
  // raw-text check. Moved above the module-id assembly (2026-09-03) so it can also gate the
  // Ijen-scoped policy modules below, not just getTopicDisclosures.
  const hasIjen = low.includes('ijen') || destination?.toLowerCase() === 'ijen'

  const moduleIds = [...new Set(TOPIC_MODULES[topic] ?? [])]
  if (topic === 'destination_readiness' && destination) {
    moduleIds.push(`destination_${destination.toLowerCase().replace(/\s+/g, '_')}`)
  }
  // Ijen's mandatory health screening and its monthly Rijik closure (the crater
  // shuts to ALL visitors on the first Friday of each month) previously reached
  // a prompt only through pkg.policyNotes -- which is merged only when the route
  // gate happens to return `needs_review`, and only for the single anchor
  // package. A customer could therefore be encouraged to book a date the
  // mountain is closed. Gated on Ijen specifically so a Bromo question never
  // picks them up.
  if (hasIjen && (topic === 'destination_readiness' || topic === 'blue_fire' || topic === 'inclusions')) {
    moduleIds.push('policy_ijen_health_screening', 'policy_ijen_monthly_closure')
  }
  // Destination-conditional inclusions (Ijen's gas mask + health-screening coordination,
  // Bromo's private jeep) live as separate "conditional_variation" modules, never listed in
  // TOPIC_MODULES.inclusions itself since they only apply to some destinations, not all --
  // reported 2026-08-04: "is a gas mask included?" (topic 'inclusions') never surfaced this
  // fact even though it exists in general-modules.json, because nothing ever looked it up.
  if (topic === 'inclusions' && destination) {
    const dest = destination.toLowerCase()
    for (const m of Object.values(modules)) {
      if (m.variation_trigger?.toLowerCase() === dest) moduleIds.push(m.module_id)
    }
  }
  // Checked regardless of topic -- see KEYWORD_TRIGGERED_MODULES' own comment.
  const keywordTriggeredIds = new Set<string>()
  if (keywordTriggeredModuleIds) {
    for (const moduleId of keywordTriggeredModuleIds) {
      moduleIds.push(moduleId)
      keywordTriggeredIds.add(moduleId)
    }
  } else {
    for (const { moduleId, keywords } of KEYWORD_TRIGGERED_MODULES) {
      if (keywords.some((k) => low.includes(k))) {
        moduleIds.push(moduleId)
        keywordTriggeredIds.add(moduleId)
      }
    }
  }
  const resolvedModules = moduleIds
    .map((id) => modules[id])
    .filter((m): m is KnowledgeModule => Boolean(m))
    .filter((m) => !m.approval_status || m.approval_status.startsWith('approved'))
    .filter((m) => m.customer_visible !== false)

  const factualLines = resolvedModules.map((m) => m.short_answer).filter((v): v is string => Boolean(v))
  const detailLines = resolvedModules.map((m) => m.detail_summary).filter((v): v is string => Boolean(v))

  // A keyword-triggered module's own link wins over a topic-general module's -- the customer
  // asked specifically about student pricing/escort/ferry, so ISIC's own page is more useful
  // than whatever generic inclusions/policy link the topic would otherwise resolve first.
  let primaryLink: string | null = null
  for (const m of resolvedModules) {
    if (!keywordTriggeredIds.has(m.module_id)) continue
    const url = resolveLink(m.link_key)
    if (url) {
      primaryLink = url
      break
    }
  }
  if (!primaryLink) {
    for (const m of resolvedModules) {
      const url = resolveLink(m.link_key)
      if (url) {
        primaryLink = url
        break
      }
    }
  }

  const disclosures = getTopicDisclosures(topic, hasIjen)
  if (GUARANTEE_PHRASES.some((p) => low.includes(p))) {
    if (!disclosures.includes(DISCLOSURES.noGuaranteeAccess)) disclosures.push(DISCLOSURES.noGuaranteeAccess)
  }

  const attractionTrigger = ATTRACTION_TRIGGER_PHRASES.some((p) => low.includes(p))
  const guaranteeDemanded = GUARANTEE_PHRASES.some((p) => low.includes(p))

  return {
    factualLines,
    detailLines,
    primaryLink,
    disclosures,
    handoffRequired: attractionTrigger && guaranteeDemanded,
  }
}
