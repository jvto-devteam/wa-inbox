/**
 * General-knowledge module resolver -- TypeScript port of chatbot-web's `agentResolver.js`
 * (see /Users/macbook/Code/chatbot-web/src/agentResolver.js), which is itself the piece of
 * jvto-agent-runtime's `module_resolver.py` that catalog.ts's header explicitly says was NOT
 * ported here: `resolve_modules` (module_resolver.py:106-194), which answers module-resolver.ts's
 * full 14 real topics from `general-modules.json` -- data wa-inbox already syncs (byte-identical
 * to chatbot-web's copy, verified 2026-08-04) but never read past the four package-scoped fields
 * catalog.ts's `CatalogPackage` carries.
 *
 * Deliberately does NOT resolve links from `customer-link-registry.json`, unlike agentResolver.js
 * -- live-checked 2026-08-04, 16 of the registry's 35 `status: "existing"` URLs (every
 * /travel-guide/* entry, most /destinations/* ones) actually 404 on the real site. The sync's own
 * status flag cannot be trusted, so orchestrator.ts uses ONLY `CatalogPackage.links.details`
 * (catalog.ts's own package-page join, 100% live in the same check) for any link surfaced to a
 * customer. Revisit once the registry data itself is fixed upstream.
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

export type KnowledgeModule = {
  module_id: string
  short_answer?: string
  detail_summary?: string
  customer_visible?: boolean
  approval_status?: string
}

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

let _modules: Record<string, KnowledgeModule> | null = null

/** Test-only: clears the lazy cache so a test's own catalog fixtures aren't shadowed by a real one. */
export function __resetKnowledgeCacheForTests(): void {
  _modules = null
}

function loadModules(): Record<string, KnowledgeModule> {
  if (_modules) return _modules
  const raw = readCatalogFile(GENERAL_MODULES_FILE)
  const list = Array.isArray(raw) ? (raw as KnowledgeModule[]) : []
  _modules = Object.fromEntries(list.filter((m) => m && typeof m.module_id === 'string').map((m) => [m.module_id, m]))
  return _modules
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
  disclosures: string[]
  /** True only when a guarantee was demanded about attraction access -- escalate, never promise. */
  handoffRequired: boolean
}

/**
 * Resolves customer-facing facts for one classified topic (module-resolver.ts's `classifyTopic`,
 * already a faithful full-14-topic port) -- the module-selection + disclosure-assembly step
 * catalog.ts's header names as the thing that was never ported. Not package-scoped: module
 * selection is topic-only, matching agentResolver.js's own FAQ-time behavior.
 */
export function resolveKnowledgeForTopic(topic: ResolverTopic, message: string): ResolvedKnowledge {
  const modules = loadModules()
  const low = (message ?? '').toLowerCase()

  const moduleIds = [...new Set(TOPIC_MODULES[topic] ?? [])]
  const resolvedModules = moduleIds
    .map((id) => modules[id])
    .filter((m): m is KnowledgeModule => Boolean(m))
    .filter((m) => !m.approval_status || m.approval_status.startsWith('approved'))
    .filter((m) => m.customer_visible !== false)

  const factualLines = resolvedModules.map((m) => m.short_answer).filter((v): v is string => Boolean(v))
  const detailLines = resolvedModules.map((m) => m.detail_summary).filter((v): v is string => Boolean(v))

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
    disclosures,
    handoffRequired: attractionTrigger && guaranteeDemanded,
  }
}
