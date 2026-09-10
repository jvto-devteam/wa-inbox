/**
 * LLM-primary replacement for `classifyTopic`'s role as the topic classifier. Confirmed with
 * the operator 2026-08-07, part of the same systemic fix as trip-preferences-extractor.ts: an
 * audit of every manual regex/keyword matcher in the bot found `module-resolver.ts`'s
 * `TOPIC_KEYWORDS` (~90 literal phrases across 14 topics, first-match-wins) as one of the two
 * highest-blast-radius offenders -- every single inbound message runs through it, and its own
 * comments already document 2 real live misclassifications (a bare "how much" swallowing a
 * deposit/payment question; a bare "transfer" swallowing a rooming question) purely from
 * checking keyword lists in a fixed order rather than understanding what the message means.
 *
 * Same design as trip-preferences-extractor.ts: the LLM call is PRIMARY, not gated behind
 * "regex found nothing first" (a wrong-but-non-null keyword match would never trigger a
 * fallback under that ordering, and a wrong match is the actual documented failure mode here).
 * Output is validated against the real, fixed 14-topic enum before being trusted -- anything
 * else is discarded and treated as a technical failure. The existing regex `classifyTopic` is
 * kept, completely unchanged, as the fallback for a genuine technical failure (timeout, error,
 * unparseable/invalid output) -- mirrors evaluatePickupScenario's own "catch, log, safe
 * default" shape.
 *
 * Task 21 (Ruling R65): a message can genuinely ask about more than one topic at once
 * ("what's the deposit, and can you drop us off in Malang?"). Measurement (Fase 0, gerbang G1)
 * found 5 of 30 labelled messages had a legitimate second topic, and since Ruling R56's topic
 * gate (see runtime-integration.ts's managedFactsFor), the OTHER topic's managed facts were
 * silently dropped whenever the classifier picked the other one. Rather than a second
 * classifier call (double the latency, double the failure surface), the SAME call now also
 * asks for `also`: up to 2 OTHER topics the message clearly also asks about. `also` is
 * validated the same way `topic` always has been -- against the real 14-topic enum, deduped,
 * capped at 2, primary excluded -- but a bad/missing `also` must NEVER invalidate an
 * otherwise-good primary `topic`; it just becomes an empty list. The `regex_fallback` path (no
 * real understanding of the message, just keyword matching) always returns an empty
 * `alsoTopics` -- it was never able to see a second topic before this task either.
 */
import { callLLM } from './llm'
import { classifyTopic, RESOLVER_TOPICS, type ResolverTopic } from './module-resolver'

export type TopicClassification = {
  topic: ResolverTopic
  /**
   * Optional at the TYPE level even though `classifyTopicViaLLM` always populates it (see
   * below) -- required was confirmed (empirically, under `tsc --strict`) to break every one of
   * orchestrator.test.ts's ~50 pre-existing `classifyTopicViaLLM` mocks
   * (`mockResolvedValue({ topic, source })`, unrelated to this task) with a missing-required-
   * property error. Optional keeps those compiling untouched; every REAL caller still gets a
   * real array, never `undefined`, from `classifyTopicViaLLM` itself.
   */
  alsoTopics?: ResolverTopic[]
  source: 'llm' | 'regex_fallback'
}

const VALID_TOPICS = new Set<ResolverTopic>(RESOLVER_TOPICS)

const TOPIC_CLASSIFICATION_SYSTEM_PROMPT = `You classify a customer's WhatsApp message to a private tour operator (JVTO) in East Java, Indonesia into exactly ONE of these 14 topics, based on what the message actually means -- not just which literal words it contains.

- "inclusions": what is included/excluded in a package (general "what do we get" questions).
- "price": cost, pricing, budget, "how much" -- but NOT if it's specifically about the deposit or a payment method, which is "payment" instead.
- "private_tour": whether the tour is private vs. shared/group, or about the guide/driver arrangement itself.
- "vehicle": vehicle type, capacity, luggage space.
- "rooming": room configuration -- twin/double/single bed, room type.
- "hotel": accommodation/hotel standard, overnight stays.
- "route_endpoint": where the trip starts or finishes, drop-off points, the ferry crossing to/from Bali.
- "destination_readiness": safety, difficulty, or what to prepare for a SPECIFIC destination (Ijen, Bromo, Tumpak Sewu, Madakaripura, Papuma) -- hiking difficulty, what to bring, is it safe.
- "booking": how to book, the reservation process itself.
- "payment": deposit, payment methods, bank transfer, installments -- anything about HOW or WHEN money changes hands. A message mentioning "transfer" in a travel sense (an airport/inter-city transfer, not a money transfer) is NOT this topic.
- "cancellation": cancellation, refund, reschedule, travel credit policy.
- "blue_fire": specifically about the Blue Fire phenomenon at Ijen (including paraphrases like "blue flames").
- "greeting": a simple greeting with no real question yet (e.g. just "hi" or "hello").
- "general": anything that doesn't clearly fit one of the above.

Some messages also clearly ask about a SECOND topic from the list above (e.g. a deposit
question that also asks about a drop-off city). List those in "also" -- at most 2, empty array
if there are none. Never repeat the primary "topic" inside "also".

Reply with ONLY valid JSON, no markdown, no explanation, exactly this shape:
{"topic": "<one of the 14 topic names above, exactly as spelled>", "also": ["<0-2 OTHER topic names from the same list this message also clearly asks about>"]}

Examples:

Message: "how much is the deposit and when do I pay?"
Output: {"topic": "payment", "also": []}

Message: "...Mount Ijen and after transfer to Bali... are there guaranteed private double rooms?"
Output: {"topic": "rooming", "also": []}

Message: "Is it still accessible to see the blue flames right now?"
Output: {"topic": "blue_fire", "also": []}

Message: "多少钱一个人?"
Output: {"topic": "price", "also": []}

Message: "what's the deposit, and can you drop us off in Malang instead of Surabaya?"
Output: {"topic": "payment", "also": ["route_endpoint"]}`

function validateTopic(v: unknown): ResolverTopic | null {
  return typeof v === 'string' && VALID_TOPICS.has(v as ResolverTopic) ? (v as ResolverTopic) : null
}

/**
 * Validates the `also` field against the same real 14-topic enum `topic` itself uses --
 * anything else (wrong type, hallucinated topic name) is silently dropped rather than
 * invalidating the whole response, because `also` is an addition, never a requirement: a
 * message with no second topic, or a model that didn't produce one, is the overwhelmingly
 * common case. Drops the primary topic (never a real "also"), dedupes, and caps at 2 -- see
 * this function's own call site for why those exact limits.
 */
function validateAlsoTopics(v: unknown, primary: ResolverTopic): ResolverTopic[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<ResolverTopic>()
  for (const candidate of v) {
    if (seen.size >= 2) break
    const topic = validateTopic(candidate)
    if (topic === null || topic === primary) continue
    seen.add(topic)
  }
  return [...seen]
}

function stripCodeFence(raw: string): string {
  return raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '')
}

function parseAndValidate(raw: string): { topic: ResolverTopic; alsoTopics: ResolverTopic[] } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFence(raw))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  // The primary topic is validated exactly as it always has been -- `also` is derived only
  // AFTER `topic` is confirmed valid, and never feeds back into that decision, so a malformed
  // `also` next to a good `topic` can never turn a good classification into a failed one.
  const topic = validateTopic(record.topic)
  if (topic === null) return null
  return { topic, alsoTopics: validateAlsoTopics(record.also, topic) }
}

export async function classifyTopicViaLLM(job: string | null | undefined, message: string, model?: string): Promise<TopicClassification> {
  try {
    const raw = await callLLM(message, { system: TOPIC_CLASSIFICATION_SYSTEM_PROMPT, model })
    const result = parseAndValidate(raw)
    if (result) return { topic: result.topic, alsoTopics: result.alsoTopics, source: 'llm' }
  } catch (err) {
    console.error('topic classification failed', { error: err })
  }
  // The regex fallback has no way to see a second topic (it's a first-match-wins keyword
  // scan) -- alsoTopics is always empty here, same as before this field existed.
  return { topic: classifyTopic(job, message), alsoTopics: [], source: 'regex_fallback' }
}
