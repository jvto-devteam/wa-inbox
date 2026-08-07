/**
 * LLM-primary replacement for `UNKNOWN_PREFERENCE_KEYWORDS`' role as the trip-preferences
 * funnel's ONLY bypass. Confirmed with the operator 2026-08-07, part of the same manual-
 * matching audit as trip-preferences-extractor.ts/topic-classifier.ts/keyword-module-
 * classifier.ts: start/finish/day-count is MANDATORY before a package recommendation, and the
 * ONLY documented way past it is the customer explicitly saying they don't know/don't care --
 * a 24-phrase literal keyword list (orchestrator.ts's own `UNKNOWN_PREFERENCE_KEYWORDS`). The
 * audit flagged this as structurally the highest-risk remaining matcher: a miss doesn't just
 * mislabel something, it traps the customer in a repeat-question loop with no other way out,
 * since the funnel is mandatory by design.
 *
 * Same design as the first three: the LLM call is primary, validated (a plain boolean, nothing
 * to hallucinate a wrong VALUE for -- only a wrong shape/failure to worry about), falls back to
 * the unchanged keyword list (`isUnknownPreferenceSignal`, re-exported from orchestrator.ts's
 * own module) only on a genuine technical failure.
 */
import { callLLM } from './llm'

const PREFERENCE_DECLINE_SYSTEM_PROMPT = `You check whether a customer replying to a private tour operator (JVTO) has explicitly said they DON'T KNOW or DON'T CARE about a specific travel preference being asked about (where their trip starts, where it finishes, or how many days it should be) -- as opposed to actually answering the question, or saying something unrelated.

This must be about NOT KNOWING their own travel preferences specifically -- not a general "whatever"/"up to you" about something else entirely (e.g. "whatever's included is fine" is about package inclusions, not about not knowing their preferences, so that is NOT a match).

Reply with ONLY valid JSON, no markdown, no explanation, exactly this shape:
{"declined": true or false}

Examples:

Message: "gak tau juga sih, terserah aja"
Output: {"declined": true}

Message: "I'm not sure yet, whatever you recommend works for us"
Output: {"declined": true}

Message: "3 days, starting from Surabaya"
Output: {"declined": false}

Message: "whatever's included in the package is fine with us"
Output: {"declined": false}

Message: "no idea honestly, you know the routes better than we do"
Output: {"declined": true}`

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
  const value = (parsed as Record<string, unknown>).declined
  return typeof value === 'boolean' ? value : null
}

export type PreferenceDeclineDetection = {
  declined: boolean
  source: 'llm' | 'regex_fallback'
}

export async function detectsPreferenceDeclineViaLLM(
  message: string,
  regexFallback: (message: string) => boolean,
  model?: string
): Promise<PreferenceDeclineDetection> {
  try {
    const raw = await callLLM(message, { system: PREFERENCE_DECLINE_SYSTEM_PROMPT, model })
    const declined = parseAndValidate(raw)
    if (declined !== null) return { declined, source: 'llm' }
  } catch (err) {
    console.error('preference-decline classification failed', { error: err })
  }
  return { declined: regexFallback(message), source: 'regex_fallback' }
}
