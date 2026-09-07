/**
 * What may be changed on a flow in this phase, and nothing else.
 *
 * --- Why the list is seven fields and stops there ---
 *
 * A flow's branching is not data. It is `if` statements in `src/lib/bot/orchestrator.ts` — early
 * returns, a `Promise.allSettled` whose two branches are deliberately asymmetric, a funnel that
 * re-asks until three fields are known. Making that editable from a web form means building an
 * interpreter for it, and a half-finished interpreter driving production is far more dangerous
 * than a flow that cannot yet be edited (SDD Manage Second §8.3, and `existing-flow-registry.ts`
 * says the same about why it is hand-written).
 *
 * So SAFE_CONFIG covers exactly the values the code already reads verbatim: sentences the bot
 * says, and one threshold it counts against. Everything else stays read-only until Flow Builder
 * V1. A field absent from `flowSafeConfigSchema` is rejected rather than stored and ignored — a
 * stored key that nothing reads is indistinguishable, from the UI, from one that works.
 *
 * --- Why every text field may be empty ---
 *
 * An empty string means "keep the code's own wording", not "say nothing". That distinction is
 * why the schema allows it and the loader treats it as absent: an operator who clears a box is
 * reverting to the default, and forcing them to retype the original sentence to do that is how
 * a typo ends up permanently in the bot's mouth.
 */
import { z } from 'zod'

/** Fields an operator may edit at SAFE_CONFIG level, in display order. */
export const SAFE_CONFIG_FIELDS = [
  'greetingText',
  'clarificationPrompt',
  'maxClarificationAttempts',
  'fallbackReply',
  'handoffReply',
  'workingHoursReply',
  'leadFields',
] as const

export type SafeConfigField = (typeof SAFE_CONFIG_FIELDS)[number]

/** Editable levels, weakest first. SDD Manage Second §7.5. */
export const FLOW_EDITABLE_LEVELS = ['READ_ONLY', 'TEXT_ONLY', 'SAFE_CONFIG', 'FLOW_BUILDER_V1'] as const
export type FlowEditableLevel = (typeof FLOW_EDITABLE_LEVELS)[number]

/** Levels at which the safe-config form is offered at all. */
const LEVELS_WITH_SAFE_CONFIG: readonly FlowEditableLevel[] = ['TEXT_ONLY', 'SAFE_CONFIG', 'FLOW_BUILDER_V1']

/** Fields TEXT_ONLY may touch: sentences, never thresholds or field lists. */
const TEXT_ONLY_FIELDS: readonly SafeConfigField[] = [
  'greetingText',
  'clarificationPrompt',
  'fallbackReply',
  'handoffReply',
  'workingHoursReply',
]

/**
 * The bot re-asks this many times before giving up and handing off.
 *
 * Bounded on both ends, and the bounds are not decoration. Zero would disable clarification
 * entirely — a behaviour change dressed as a setting. A large number turns a confused customer
 * into someone being interrogated by a bot that will not let them reach a human, which is the
 * single worst experience this system can produce.
 */
export const MIN_CLARIFICATION_ATTEMPTS = 1
export const MAX_CLARIFICATION_ATTEMPTS = 5

const replyText = z.string().trim().max(2000)

export const flowSafeConfigSchema = z
  .object({
    greetingText: replyText.optional(),
    clarificationPrompt: replyText.optional(),
    maxClarificationAttempts: z
      .number()
      .int()
      .min(MIN_CLARIFICATION_ATTEMPTS)
      .max(MAX_CLARIFICATION_ATTEMPTS)
      .optional(),
    fallbackReply: replyText.optional(),
    handoffReply: replyText.optional(),
    workingHoursReply: replyText.optional(),
    // The fields the funnel insists on knowing before it will quote. Capped because each one is
    // another question a customer has to answer before getting an answer of their own.
    leadFields: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
  })
  .strict()

export type FlowSafeConfig = z.infer<typeof flowSafeConfigSchema>

export type FlowConfigValidation =
  | { ok: true; config: FlowSafeConfig }
  | { ok: false; error: string }

/** Whether this level may edit this field at all. */
export function canEditField(level: string, field: SafeConfigField): boolean {
  if (!LEVELS_WITH_SAFE_CONFIG.includes(level as FlowEditableLevel)) return false
  if (level === 'TEXT_ONLY') return TEXT_ONLY_FIELDS.includes(field)
  return true
}

/** Fields a form should render for this level, or an empty list when it may edit nothing. */
export function editableFieldsFor(level: string): readonly SafeConfigField[] {
  if (!LEVELS_WITH_SAFE_CONFIG.includes(level as FlowEditableLevel)) return []
  return SAFE_CONFIG_FIELDS.filter((field) => canEditField(level, field))
}

/**
 * Validates a proposed safe config against the flow's editable level.
 *
 * The level is checked per FIELD, not once for the whole object. A TEXT_ONLY flow that accepted
 * a `maxClarificationAttempts` because the rest of the payload was fine would have its level
 * mean nothing at all.
 */
export function validateFlowSafeConfig(level: string, value: unknown): FlowConfigValidation {
  if (!LEVELS_WITH_SAFE_CONFIG.includes(level as FlowEditableLevel)) {
    return { ok: false, error: `Flow dengan level ${level} tidak bisa diubah dari UI.` }
  }

  const parsed = flowSafeConfigSchema.safeParse(value ?? {})
  if (!parsed.success) {
    const fields = parsed.error.issues.flatMap((issue) =>
      issue.code === 'unrecognized_keys' ? issue.keys : [issue.path.join('.') || '(konfigurasi)']
    )
    return { ok: false, error: `Konfigurasi flow tidak valid pada: ${[...new Set(fields)].join(', ')}.` }
  }

  const forbidden = Object.keys(parsed.data).filter(
    (key) => !canEditField(level, key as SafeConfigField)
  )
  if (forbidden.length > 0) {
    return { ok: false, error: `Level ${level} tidak boleh mengubah: ${forbidden.join(', ')}.` }
  }

  return { ok: true, config: parsed.data }
}

/**
 * Reads a stored config back, defensively.
 *
 * A row written by an older build, or edited straight in the database, may not match. Returning
 * null lets the loader fall back to the code's own values rather than hand the bot a shape it
 * will read fields off blindly.
 */
export function readFlowSafeConfig(value: unknown): FlowSafeConfig | null {
  const parsed = flowSafeConfigSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
