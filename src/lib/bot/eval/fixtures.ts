// Golden-set fixtures for the evaluation harness (run-eval.ts). Every case here is a REAL
// customer message that already caused a documented bug -- not a synthetic example -- so a
// failing case can be argued about against something that actually happened. `source` cites
// the file/comment (and date, where the original report carried one) that documents it.
//
// Do not invent new cases here and do not soften an assertion to make a case "safer": a case
// that cannot fail proves nothing. See fixtures.test.ts for the shape rules this file must
// satisfy.

export type EvalCase = {
  id: string
  /** Each turn is one inbound message, replayed in order against one conversation. */
  turns: string[]
  /** Lowercased substrings that MUST all appear in the final reply. */
  mustContain: string[]
  /** Lowercased substrings that must NOT appear. */
  mustNotContain: string[]
  /** Where this case came from, so a failure can be argued about against a real message. */
  source: string
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'deposit-amount',
    turns: ['how much is the deposit and when do I pay?'],
    mustContain: ['20%'],
    mustNotContain: ["don't have", 'not sure'],
    source: 'module-resolver.ts, live-tested 2026-08-04 (classified as price, whose modules have no deposit content)',
  },
  {
    id: 'dietary-no-beef',
    turns: ["please make sure her meals don't contain beef"],
    mustContain: ['noted'],
    mustNotContain: ['where would you like to go'],
    source: 'knowledge.ts KEYWORD_TRIGGERED_MODULES, reported 2026-08-05 (stonewalled with a destination question)',
  },
  {
    id: 'finish-in-bali',
    turns: ['3 day trip from Bali to Ijen', 'can we finish the trip in Bali?'],
    mustContain: [],
    mustNotContain: ['yes, all of them', 'every package'],
    source: 'types.ts CatalogPackage.finishCities, 2026-08-05 (answered from origin instead of dropoff options)',
  },
  {
    id: 'solo-traveller-price',
    turns: ['what is the price for the 3 day bromo ijen tour from bali for 1 person?'],
    mustContain: ['7.500.000'],
    mustNotContain: ['4.050.000'],
    source: 'types.ts CatalogPackage.priceTiers, 2026-08-05 (11+ pax tier quoted to a solo traveller)',
  },
  {
    id: 'gas-mask-included',
    turns: ['is a gas mask included for ijen?'],
    mustContain: ['included'],
    mustNotContain: ['let me check'],
    source: 'knowledge.ts resolveKnowledgeForTopic, reported 2026-08-04',
  },
  {
    id: 'blue-fire-guarantee',
    turns: ['blue fire is why we are coming, can you guarantee it 100%?'],
    mustContain: ['cannot be guaranteed'],
    mustNotContain: ['yes, guaranteed', 'we guarantee'],
    source: 'knowledge.ts GUARDRAIL_INSTRUCTION + ATTRACTION_TRIGGER_PHRASES (the "blue fire is why" phrase found drifted/missing 2026-08-07)',
  },
  {
    id: 'yogyakarta-pickup',
    turns: ['Start / Pick-up: Yogyakarta. What is the price for 2 people?'],
    mustContain: ['surabaya'],
    mustNotContain: [],
    source: 'orchestrator.ts mentionedUnsupportedOriginCity, reported 2026-08-06',
  },
  {
    id: 'cancellation-options',
    turns: ['What are my options if I have to cancel due to a flight delay?'],
    mustContain: [],
    mustNotContain: ['could you share a few details', 'number of day'],
    source: 'orchestrator.ts DESTINATION_INDEPENDENT_TOPICS, audit 2026-08-07 (bare "options" derailed it into the funnel)',
  },
  {
    id: 'insurance-advice',
    turns: ['would you recommend that we buy our own travel insurance?'],
    mustContain: [],
    mustNotContain: ['could you share a few details'],
    source: 'orchestrator.ts RECOMMENDATION_VERB_PATTERN, reported 2026-08-05',
  },
  {
    id: 'travel-time-surabaya-bromo',
    turns: ['how many hours from surabaya to bromo?'],
    mustContain: ['hour'],
    mustNotContain: ['let me check'],
    source: 'knowledge.ts resolveRouteLegFacts, message audit 2026-08-06',
  },
  {
    id: 'hotel-names',
    turns: ['which hotel do we stay at on the 3 day bromo ijen tour from bali?'],
    mustContain: ['joglo kecombrang'],
    mustNotContain: ['check the package page'],
    source: 'Task 8 of this plan -- accommodation-rules.json was never read',
  },
  {
    id: 'ijen-monthly-closure',
    turns: ['is ijen open on the first friday of the month?'],
    mustContain: ['closed'],
    mustNotContain: ['yes, open every day'],
    source: 'Task 7 of this plan -- policy_ijen_monthly_closure was unreachable',
  },
]
