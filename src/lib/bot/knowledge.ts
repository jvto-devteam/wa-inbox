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
- Balance due 3 days before Day 1 via Bank Transfer / Wise.
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
  inclusions: ['inclusion_all_inclusive_baseline', 'exclusion_standard'],
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
  blue_fire: ['policy_natural_phenomena', 'destination_ijen'],
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
const KEYWORD_TRIGGERED_MODULES: Array<{ moduleId: string; keywords: string[] }> = [
  { moduleId: 'policy_isic_student', keywords: ['isic', 'student'] },
  { moduleId: 'policy_police_escort', keywords: ['police escort', 'escort'] },
  { moduleId: 'inclusion_east_java_bali_ferry', keywords: ['ferry', 'ketapang', 'gilimanuk'] },
]

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
  availabilityNotConfirmed: 'Availability is not yet confirmed for the requested date.',
  noGuaranteeAccess:
    'Attraction access such as Blue Fire, along with weather and sunrise, cannot be guaranteed; it depends on current conditions and the authorities.',
}

const GUARANTEE_PHRASES = ['guarantee', 'guaranteed', '100%', 'certain', 'definitely be open']
const ATTRACTION_TRIGGER_PHRASES = [
  'main reason',
  'must see',
  'definitely want',
  'otherwise we go elsewhere',
  'otherwise we will go elsewhere',
  'blue lava is why',
  'why we are coming',
]

// Injected into the LLM system prompt verbatim -- same wording as agentResolver.js's
// GUARDRAIL_INSTRUCTION, since these are policy statements, not code logic to "port" per se.
export const GUARDRAIL_INSTRUCTION = `=== STRICT GUARDRAILS -- NEVER VIOLATE ===
- NEVER guarantee Blue Fire visibility, sunrise, or crater access -- always say "cannot be guaranteed"
- NEVER state prices as final -- add "subject to availability and confirmation"
- NEVER predict weather for specific dates
- NEVER confirm exact availability without noting it needs live verification
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
  if (topic === 'rooming' || topic === 'hotel') out.push('Exact rooming and upgrades are subject to confirmation.')
  return out
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
 */
export function resolveKnowledgeForTopic(topic: ResolverTopic, message: string, destination?: string): ResolvedKnowledge {
  const modules = loadModules()
  const low = (message ?? '').toLowerCase()

  const moduleIds = [...new Set(TOPIC_MODULES[topic] ?? [])]
  if (topic === 'destination_readiness' && destination) {
    moduleIds.push(`destination_${destination.toLowerCase().replace(/\s+/g, '_')}`)
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
  for (const { moduleId, keywords } of KEYWORD_TRIGGERED_MODULES) {
    if (keywords.some((k) => low.includes(k))) moduleIds.push(moduleId)
  }
  const resolvedModules = moduleIds
    .map((id) => modules[id])
    .filter((m): m is KnowledgeModule => Boolean(m))
    .filter((m) => !m.approval_status || m.approval_status.startsWith('approved'))
    .filter((m) => m.customer_visible !== false)

  const factualLines = resolvedModules.map((m) => m.short_answer).filter((v): v is string => Boolean(v))
  const detailLines = resolvedModules.map((m) => m.detail_summary).filter((v): v is string => Boolean(v))

  let primaryLink: string | null = null
  for (const m of resolvedModules) {
    const url = resolveLink(m.link_key)
    if (url) {
      primaryLink = url
      break
    }
  }

  const hasIjen = low.includes('ijen')
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
