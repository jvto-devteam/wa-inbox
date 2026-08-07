/**
 * ADDITIVE LLM check for sales-classifier.ts's `HANDOFF_KEYWORDS` -- deliberately NOT the same
 * "LLM primary, regex fallback on technical failure" design as trip-preferences-extractor.ts/
 * topic-classifier.ts/keyword-module-classifier.ts. Confirmed with the operator 2026-08-07:
 * `HANDOFF_KEYWORDS` is the ONLY remaining path to human escalation anywhere in the bot (per
 * this file's own "no more handoff on a content gap" directive) -- a miss here means a genuine
 * complaint or explicit human request is fully absorbed by the LLM with no human ever seeing
 * it. Given that asymmetry (a missed complaint is far worse than an unnecessary handoff), the
 * keyword list stays exactly as-is and ALWAYS wins first; this only ADDS coverage for messages
 * the keyword list does not already catch, and NEVER removes or overrides a keyword hit. A
 * technical failure here (timeout/error/invalid output) fails safe to "no additional signal" --
 * i.e. exactly today's pre-existing behavior, never worse than before this file existed.
 */
import { callLLM } from './llm'

const ESCALATION_SYSTEM_PROMPT = `You check a customer's WhatsApp message to a private tour operator (JVTO) for a signal that a HUMAN must handle this, not an AI assistant. This is a SECOND check running alongside an existing keyword list -- your job is to catch what THAT list might miss, using the same 3 categories it already looks for:

1. An explicit request to talk to a human/agent/staff member (not just asking a question the bot could reasonably try to answer itself).
2. Genuine complaint or frustration -- the customer is upset about JVTO's service, not just asking an ordinary question. Being disappointed, angry, or saying the service was bad/useless/terrible counts; a neutral or curious question does NOT, even about a sensitive topic.
3. A B2B/reseller/partnership/commercial-collaboration inquiry (e.g. a travel agent, wholesaler, or influencer wanting to arrange a business deal) -- NOT an ordinary retail customer, even one traveling with a "partner"/companion.

Do NOT flag ordinary, answerable FAQ questions -- asking about cancellation, refund, rescheduling, payment status, or booking status is normal and answerable, not a complaint, even if the customer sounds slightly concerned about it. Only flag a genuine complaint/frustration/explicit human request/business inquiry as described above.

Reply with ONLY valid JSON, no markdown, no explanation, exactly this shape:
{"escalate": true or false}

Examples:

Message: "I am a bit disappointed because I bought an extra service and it never showed up"
Output: {"escalate": true}

Message: "How do I cancel my booking, and what's the refund policy?"
Output: {"escalate": false}

Message: "Can I speak to someone there directly about this?"
Output: {"escalate": true}

Message: "How much is the deposit?"
Output: {"escalate": false}

Message: "I run a travel agency in Singapore, can we discuss a wholesale rate arrangement?"
Output: {"escalate": true}`

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
  const value = (parsed as Record<string, unknown>).escalate
  return typeof value === 'boolean' ? value : null
}

/**
 * True only when the LLM confidently detects an escalation signal the keyword list didn't
 * already catch. Any technical failure (timeout, error, unparseable/invalid output) returns
 * `false` -- fails safe to "no additional signal," never blocking or degrading the reply path,
 * matching this file's own header rationale.
 */
export async function detectsAdditionalEscalationSignal(message: string, model?: string): Promise<boolean> {
  try {
    const raw = await callLLM(message, { system: ESCALATION_SYSTEM_PROMPT, model })
    const escalate = parseAndValidate(raw)
    if (escalate !== null) return escalate
  } catch (err) {
    console.error('additional escalation classification failed', { error: err })
  }
  return false
}
