/**
 * LLM-primary replacement for KEYWORD_TRIGGERED_MODULES' role as a keyword matcher. Confirmed
 * with the operator 2026-08-07, part of the same systemic fix as trip-preferences-extractor.ts
 * and topic-classifier.ts: an audit of every manual regex/keyword matcher in the bot found
 * knowledge.ts's `KEYWORD_TRIGGERED_MODULES` (85 literal phrases across 14 independent fact
 * triggers -- ISIC pricing, dietary notes, official invoices, emergency support, cancellation
 * terms, Ijen crater access, drones, Bromo closures, jacket/shoe rental, the Ijen trolley,
 * out-of-catalog destinations) as the single most bug-dense matcher in the codebase: its own
 * comments document 6 separate real incidents of a genuinely answerable, catalog-approved
 * question getting "let me check with our team" instead of the real fact, because the customer's
 * own wording ("breaks down"/"backup unit" instead of "vehicle breakdown"/"backup vehicle";
 * "blue flames" instead of "blue fire") never matched the literal phrase list.
 *
 * Same design as the other two: the LLM call is PRIMARY (a wrong/incomplete keyword match, not
 * an absence of one, is the documented failure mode), its output is validated against the real
 * module_id set (KEYWORD_TRIGGERED_MODULES' own list, knowledge.ts's single source of truth for
 * both this and the keyword fallback -- see that file's own comment on why there is only one
 * such list, not a second hand-maintained copy), and the existing keyword scan
 * (`resolveKeywordTriggeredFacts`/the internal check inside `resolveKnowledgeForTopic`) is kept
 * completely unchanged as the fallback for a genuine technical failure.
 */
import { callLLM } from './llm'
import { KEYWORD_TRIGGERED_MODULES, hasKeywordTriggeredModule, resolveKeywordTriggeredFacts, factsForModuleIds } from './knowledge'

export type KeywordModuleClassification = {
  moduleIds: string[]
  source: 'llm' | 'regex_fallback'
}

const VALID_MODULE_IDS = new Set(KEYWORD_TRIGGERED_MODULES.map((m) => m.moduleId))

function buildSystemPrompt(): string {
  const catalog = KEYWORD_TRIGGERED_MODULES.map((m) => `- "${m.moduleId}": ${m.description}`).join('\n')
  return (
    "You are checking a customer's WhatsApp message to a private tour operator (JVTO) against a fixed catalog of independent fact triggers, to decide which ones (if any) the message calls for -- based on what the message actually means, not just literal keywords.\n\n" +
    `Catalog of triggers:\n${catalog}\n\n` +
    'A message can match zero, one, or several of these -- they are independent, not mutually exclusive. Only select a trigger if the message genuinely asks about or states that specific thing; do not select one just because it is loosely related.\n\n' +
    'Reply with ONLY valid JSON, no markdown, no explanation, exactly this shape:\n' +
    '{"moduleIds": ["<module_id>", ...]}\n\n' +
    'Use an empty array if none apply. Examples:\n\n' +
    'Message: "If the driver or vehicle breaks down during the tour, is there a backup unit ready?"\n' +
    'Output: {"moduleIds": ["policy_emergency_and_support"]}\n\n' +
    'Message: "Seeing the blue flames was the main reason we booked this tour. Is it still accessible right now?"\n' +
    'Output: {"moduleIds": ["policy_ijen_crater_access_status"]}\n\n' +
    'Message: "Please make sure her meals don\'t contain beef, and can you send an official invoice under our company name?"\n' +
    'Output: {"moduleIds": ["service_dietary_preference_noted", "policy_official_invoice"]}\n\n' +
    'Message: "How much is the deposit?"\n' +
    'Output: {"moduleIds": []}'
  )
}

const KEYWORD_MODULE_SYSTEM_PROMPT = buildSystemPrompt()

function stripCodeFence(raw: string): string {
  return raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '')
}

function parseAndValidate(raw: string): string[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFence(raw))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const ids = (parsed as Record<string, unknown>).moduleIds
  if (!Array.isArray(ids)) return null
  // Hallucinated/unknown IDs are silently dropped, not trusted -- same "discard, don't
  // propagate" rule as the other two LLM-primary extractors' field-level validation.
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && VALID_MODULE_IDS.has(id)))]
}

export async function classifyKeywordModulesViaLLM(message: string, model?: string): Promise<KeywordModuleClassification> {
  try {
    const raw = await callLLM(message, { system: KEYWORD_MODULE_SYSTEM_PROMPT, model })
    const moduleIds = parseAndValidate(raw)
    if (moduleIds) return { moduleIds, source: 'llm' }
  } catch (err) {
    console.error('keyword-triggered module classification failed', { error: err })
  }
  // Fallback derives moduleIds from the real regex scan (resolveKeywordTriggeredFacts
  // resolves facts directly, not IDs -- hasKeywordTriggeredModule/the KEYWORD_TRIGGERED_MODULES
  // scan is duplicated minimally here rather than adding a 3rd public knowledge.ts export just
  // to expose IDs from the fallback path specifically).
  if (!hasKeywordTriggeredModule(message)) return { moduleIds: [], source: 'regex_fallback' }
  const low = message.toLowerCase()
  const moduleIds = KEYWORD_TRIGGERED_MODULES.filter(({ keywords }) => keywords.some((k) => low.includes(k))).map((m) => m.moduleId)
  return { moduleIds, source: 'regex_fallback' }
}

/** Convenience: resolved facts (not just IDs) for a message, LLM-primary with the same fallback. */
export async function keywordTriggeredFactsViaLLM(
  message: string,
  model?: string
): Promise<{ facts: string[]; moduleIds: string[]; source: 'llm' | 'regex_fallback' }> {
  const { moduleIds, source } = await classifyKeywordModulesViaLLM(message, model)
  if (source === 'regex_fallback') return { facts: resolveKeywordTriggeredFacts(message), moduleIds, source }
  return { facts: factsForModuleIds(moduleIds), moduleIds, source }
}
