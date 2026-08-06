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
 */
import { callLLM } from './llm'
import { classifyTopic, type ResolverTopic } from './module-resolver'

export type TopicClassification = {
  topic: ResolverTopic
  source: 'llm' | 'regex_fallback'
}

const VALID_TOPICS = new Set<ResolverTopic>([
  'inclusions', 'price', 'private_tour', 'vehicle', 'rooming', 'hotel', 'route_endpoint',
  'destination_readiness', 'booking', 'payment', 'cancellation', 'blue_fire', 'greeting', 'general',
])

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

Reply with ONLY valid JSON, no markdown, no explanation, exactly this shape:
{"topic": "<one of the 14 topic names above, exactly as spelled>"}

Examples:

Message: "how much is the deposit and when do I pay?"
Output: {"topic": "payment"}

Message: "...Mount Ijen and after transfer to Bali... are there guaranteed private double rooms?"
Output: {"topic": "rooming"}

Message: "Is it still accessible to see the blue flames right now?"
Output: {"topic": "blue_fire"}

Message: "多少钱一个人?"
Output: {"topic": "price"}`

function validateTopic(v: unknown): ResolverTopic | null {
  return typeof v === 'string' && VALID_TOPICS.has(v as ResolverTopic) ? (v as ResolverTopic) : null
}

function stripCodeFence(raw: string): string {
  return raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '')
}

function parseAndValidate(raw: string): ResolverTopic | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFence(raw))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  return validateTopic((parsed as Record<string, unknown>).topic)
}

export async function classifyTopicViaLLM(job: string | null | undefined, message: string, model?: string): Promise<TopicClassification> {
  try {
    const raw = await callLLM(message, { system: TOPIC_CLASSIFICATION_SYSTEM_PROMPT, model })
    const topic = parseAndValidate(raw)
    if (topic) return { topic, source: 'llm' }
  } catch (err) {
    console.error('topic classification failed', { error: err })
  }
  return { topic: classifyTopic(job, message), source: 'regex_fallback' }
}
