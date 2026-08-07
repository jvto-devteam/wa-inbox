/**
 * LLM-primary replacement for `isRecommendationRequest`'s role as the funnel-gate's
 * package-recommendation-intent signal. Confirmed with the operator 2026-08-07, found during
 * the same proactive manual-matching audit as the other LLM-primary conversions this session:
 * `RECOMMENDATION_INTENT_KEYWORDS`/`RECOMMENDATION_VERB_PATTERN` (orchestrator.ts) both MISSES
 * genuine recommendation requests phrased without any of its literal trigger words (e.g. "We're
 * 4 people, no idea where to go -- what would be best for us?" contains no "recommend"/
 * "package"/"options"/etc.) and has a documented history of FALSE POSITIVES from its own bare
 * keywords (bare "recommend" once wrongly matched an insurance question; bare "options" once
 * wrongly matched a cancellation question -- both fixed as one-off keyword patches, exactly the
 * "manual pattern matching that never generalizes" cycle this conversion is meant to end).
 *
 * Same design as the other LLM-primary conversions: the LLM call is primary, validated (a plain
 * boolean, nothing to hallucinate a wrong VALUE for), falls back to the unchanged
 * `isRecommendationRequest` regex (injected by the caller, since it's a private function in
 * orchestrator.ts) only on a genuine technical failure.
 */
import { callLLM } from './llm'

export type RecommendationIntentDetection = {
  isRecommendation: boolean
  source: 'llm' | 'regex_fallback'
}

const RECOMMENDATION_INTENT_SYSTEM_PROMPT = `You check whether a customer's WhatsApp message to a private tour operator (JVTO) is asking for HELP CHOOSING a tour package -- wanting a recommendation, a list of options to pick from, or asking what packages/tours are available -- based on what the message actually means, not just whether it contains a word like "recommend" or "options".

Do NOT count a message as package-recommendation intent just because it happens to contain a word like "options"/"choices"/"recommend" in an UNRELATED context -- e.g. asking about cancellation options, refund choices, or general advice (like whether to buy travel insurance) that has nothing to do with picking a tour package.

Reply with ONLY valid JSON, no markdown, no explanation, exactly this shape:
{"isRecommendation": true or false}

Examples:

Message: "We're 4 people, no idea where to go -- what would be best for us?"
Output: {"isRecommendation": true}

Message: "Which package do you recommend for Ijen?"
Output: {"isRecommendation": true}

Message: "What are my options if I have to cancel due to a flight delay?"
Output: {"isRecommendation": false}

Message: "...would you recommend that we buy our own travel insurance?"
Output: {"isRecommendation": false}

Message: "How much is the deposit?"
Output: {"isRecommendation": false}`

function stripCodeFence(raw: string): string {
  return raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '')
}

function parseAndValidate(raw: string): boolean | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFence(raw))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const value = (parsed as Record<string, unknown>).isRecommendation
  return typeof value === 'boolean' ? value : null
}

export async function detectsRecommendationIntentViaLLM(
  message: string,
  regexFallback: (message: string) => boolean,
  model?: string
): Promise<RecommendationIntentDetection> {
  try {
    const raw = await callLLM(message, { system: RECOMMENDATION_INTENT_SYSTEM_PROMPT, model })
    const isRecommendation = parseAndValidate(raw)
    if (isRecommendation !== null) return { isRecommendation, source: 'llm' }
  } catch (err) {
    console.error('recommendation-intent classification failed', { error: err })
  }
  return { isRecommendation: regexFallback(message), source: 'regex_fallback' }
}
