/**
 * What may actually be changed on each editable rule, and to what.
 *
 * --- Why an allowlist per rule, and not one generic "config is any object" ---
 *
 * A rule's config is a Json column, so without this every draft endpoint would accept any
 * shape at all. That matters more than usual here: `config` is read by the runtime loader and
 * handed to the code that decides which channel a message goes out on. An unvalidated key is
 * a silent no-op at best (an operator sets something and nothing happens, and they believe it
 * did) and a runtime type error inside the send path at worst.
 *
 * So each editable rule names exactly the keys it understands, with a schema for each. A key
 * nobody listed is rejected rather than stored and ignored — a stored key that does nothing is
 * indistinguishable, from the UI, from one that works.
 *
 * --- Editable does not mean "everything about it is editable" ---
 *
 * `channel.unofficial_outbound_default` is CRITICAL and still editable, because what may be
 * changed is which channel is the default, NOT whether a channel policy exists at all. That is
 * why it has a config schema but `canToggleEnabled: false`: no form may switch the rule off.
 * The rules whose edit surface is only an on/off state are the mirror image.
 */
import { z } from 'zod'
import { getBotRule } from '@/lib/bot-control/rule-registry'

export type RuleConfigSpec = {
  /** Zod schema for the whole config object. Unknown keys are rejected, never stripped. */
  schema: z.ZodType<Record<string, unknown>>
  /** Whether a form may flip this rule off entirely, as opposed to only reconfiguring it. */
  canToggleEnabled: boolean
  /** Config keys a form may render, in display order. Empty means "on/off only". */
  fields: readonly string[]
}

/** An empty config: the rule's whole edit surface is its enabled flag. */
const NO_CONFIG = z.object({}).strict()

/**
 * Per-rule edit surface. A rule absent from this map has no editable config, which is the
 * correct default — adding an entry is a deliberate act, forgetting one fails closed.
 */
export const RULE_CONFIG_SPECS: Record<string, RuleConfigSpec> = {
  'channel.unofficial_outbound_default': {
    // `liveDefaultChannel` is the value that actually decides routing. `policyDefaultChannel`
    // is the WRITTEN policy and is deliberately NOT editable here: the gap between what the
    // policy says and what the system does is the finding an operator needs to see, and
    // letting a form rewrite the policy side would erase the discrepancy instead of fixing it.
    schema: z.object({ liveDefaultChannel: z.enum(['OFFICIAL', 'UNOFFICIAL']) }).strict(),
    // CLAUDE.md's channel policy is not something a web form may repeal.
    canToggleEnabled: false,
    fields: ['liveDefaultChannel'],
  },
  'channel.official_reserved_for_capabilities': {
    schema: NO_CONFIG,
    canToggleEnabled: true,
    fields: [],
  },
  'bot.handoff_on_human_request': {
    // Only the extra LLM classifier layer can be switched off. The explicit keyword gate in
    // escalation-classifier.ts runs unconditionally and is not reachable from here.
    schema: NO_CONFIG,
    canToggleEnabled: true,
    fields: [],
  },
  'bot.skip_indonesian_numbers': {
    schema: NO_CONFIG,
    canToggleEnabled: true,
    fields: [],
  },
}

export type DraftValidation =
  | { ok: true; config: Record<string, unknown>; enabled: boolean }
  | { ok: false; error: string }

/**
 * Validates a proposed draft against the registry and this rule's spec.
 *
 * Checks the REGISTRY's `editable`, not the database row's copy of it. A row that could raise
 * its own `editable` would make this table a way to unlock the rules that were deliberately
 * locked — the one thing rule-registry.ts's own comment says must not be possible.
 */
export function validateRuleDraft(
  key: string,
  input: { enabled: boolean; config?: Record<string, unknown> }
): DraftValidation {
  const rule = getBotRule(key)
  if (!rule) return { ok: false, error: `Rule ${key} tidak ada di registry.` }
  if (!rule.editable) return { ok: false, error: `Rule ${key} tidak boleh diubah dari UI.` }

  const spec = RULE_CONFIG_SPECS[key]
  if (!spec) return { ok: false, error: `Rule ${key} belum punya skema konfigurasi yang bisa diedit.` }

  if (!spec.canToggleEnabled && input.enabled !== rule.enabled) {
    return { ok: false, error: `Rule ${key} tidak bisa dinyalakan atau dimatikan, hanya dikonfigurasi.` }
  }

  const parsed = spec.schema.safeParse(input.config ?? {})
  if (!parsed.success) {
    // Names the offending keys rather than dumping Zod's tree: the operator needs to know
    // which field they got wrong, not how the validator is built.
    //
    // An `unrecognized_keys` issue carries an EMPTY path — the problem is the object, not a
    // field within it — so its `keys` have to be read explicitly. Without this the one error
    // an operator is most likely to hit ("I typed the wrong config key") would read "(root)".
    const fields = parsed.error.issues.flatMap((issue) =>
      issue.code === 'unrecognized_keys' ? issue.keys : [issue.path.join('.') || '(root)']
    )
    return { ok: false, error: `Konfigurasi tidak valid untuk field: ${[...new Set(fields)].join(', ')}.` }
  }

  return { ok: true, config: parsed.data, enabled: input.enabled }
}

/** The edit surface a form should render, or null when the rule is not editable at all. */
export function ruleEditSurface(key: string): { canToggleEnabled: boolean; fields: readonly string[] } | null {
  const rule = getBotRule(key)
  if (!rule?.editable) return null
  const spec = RULE_CONFIG_SPECS[key]
  if (!spec) return null
  return { canToggleEnabled: spec.canToggleEnabled, fields: spec.fields }
}
