/**
 * LLM-primary replacement for `isBookingIntent`/`isPackageDetailIntent`'s role as the switch
 * that decides WHICH link a customer gets: the page of the package they are actually asking
 * about, or whichever general policy link the topic happened to resolve (orchestrator.ts's
 * `primaryLink`).
 *
 * The sixth conversion of this kind, and the one the 2026-08-07 audit missed. Reported
 * 2026-09-12 from a real reply: a customer wrote "we'd like to book your Bromo 1D1N tour from
 * Surabaya" and was sent the generic "how booking works" explainer instead of that tour's own
 * page, because `BOOKING_INTENT_KEYWORDS` lists "we want to book" but not "we'd like to book",
 * and `isPackageDetailIntent` needs one of its ~17 literal ask-words ("price", "available",
 * "included", ...) that this message never used. Every fact in that reply was correct and
 * verification passed -- only the link was wrong, which is exactly the kind of miss no
 * grounding check can see.
 *
 * That is the failure mode recommendation-intent-classifier.ts's header already named as "the
 * manual pattern matching that never generalizes" cycle. Patching one more phrase into the list
 * buys one more phrasing; the customer's next way of saying the same thing is not in it either.
 *
 * Same design as the five before it: the LLM call is primary, validated (a plain boolean,
 * nothing to hallucinate a wrong VALUE for -- only a wrong shape or a technical failure to
 * worry about), and falls back to the UNCHANGED keyword predicates (injected by the caller,
 * since both are private to orchestrator.ts) only when the call genuinely fails.
 */
import { callLLM } from './llm'

const PACKAGE_LINK_INTENT_SYSTEM_PROMPT = `You check whether a customer's WhatsApp message to a private tour operator (JVTO) is about ONE SPECIFIC package they have already settled on -- so the reply should link THAT package's own page -- rather than a general question whose answer is a policy or guide page.

Count it as true when the customer names or clearly points at a particular tour/package and wants to act on it or know more about it: booking it, reserving it, asking its price or availability, what it includes, where it starts or finishes, or asking for its details. The phrasing does not matter -- "we'd like to book", "we want to take", "can you quote", "is it available", "we'll take the 3D2N one" all count. A package named earlier in the conversation and referred to as "it" or "that one" counts too.

Count it as false when the message is a general question that is not about one particular package: how booking or payment works in general, refund and cancellation policy, whether tours are private, what destinations exist, asking for a recommendation between several packages, or anything unrelated to picking a package at all.

Reply with ONLY valid JSON, no markdown, no explanation, exactly this shape:
{"wantsPackageLink": true or false}

Examples:

Message: "We're 2 people and we'd like to book your Bromo 1D1N tour from Surabaya for 12-13 September."
Output: {"wantsPackageLink": true}

Message: "I am interested in T4 Day Tumpak Sewu, Bromo & Ijen Adventure from Surabaya to Bali for 1 person starting on 6 October. Do you still have availability?"
Output: {"wantsPackageLink": true}

Message: "how do I pay the deposit, and is it refundable?"
Output: {"wantsPackageLink": false}

Message: "which package would you recommend for 4 people with 3 days?"
Output: {"wantsPackageLink": false}

Message: "are your tours private or shared with other travellers?"
Output: {"wantsPackageLink": false}`

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
  const value = (parsed as Record<string, unknown>).wantsPackageLink
  return typeof value === 'boolean' ? value : null
}

export type PackageLinkIntentDetection = {
  wantsPackageLink: boolean
  source: 'llm' | 'regex_fallback'
}

export async function detectsPackageLinkIntentViaLLM(
  message: string,
  regexFallback: (message: string) => boolean,
  model?: string
): Promise<PackageLinkIntentDetection> {
  try {
    const raw = await callLLM(message, { system: PACKAGE_LINK_INTENT_SYSTEM_PROMPT, model })
    const wantsPackageLink = parseAndValidate(raw)
    if (wantsPackageLink !== null) return { wantsPackageLink, source: 'llm' }
  } catch (err) {
    console.error('package-link-intent classification failed', { error: err })
  }
  return { wantsPackageLink: regexFallback(message), source: 'regex_fallback' }
}
