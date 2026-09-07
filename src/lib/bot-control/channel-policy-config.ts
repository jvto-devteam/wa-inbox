/**
 * The shape and the safe bounds of a channel policy.
 *
 * --- Why the bounds are here and not left to the form ---
 *
 * `safetyConfig` replaces the constants in `safety-guard.ts`, which means a number typed into a
 * web form now decides whether the duplicate check, the campaign rate limit and the provider
 * circuit breaker do anything at all. Zero on `campaignRatePerMinute` does not "loosen" the
 * limit — it disables the gate. A duplicate window of 0 ms disables duplicate detection. Both
 * are behaviour changes dressed as settings, and both are one keystroke away without a floor.
 *
 * So every number has a minimum that keeps the guard meaningful, and a maximum that keeps it
 * from becoming its own denial of service.
 *
 * --- Capabilities: the row may choose the channel, never invent the capability ---
 *
 * `channel-capabilities.ts` decides which capabilities EXIST, because each entry describes an
 * endpoint the code actually implements. A policy row may only say which channel carries an
 * existing one. A key nobody implemented is rejected rather than stored, because a routing rule
 * for a capability that cannot be sent routes nothing.
 */
import { z } from 'zod'

/** Capability keys the SDD's default row uses. Validated against the code's own list below. */
export const CHANNEL_CAPABILITY_KEYS = [
  'send_text',
  'send_media',
  'send_document',
  'send_audio',
  'send_template',
  'send_buttons',
  'send_list',
  'send_carousel',
  'campaign',
] as const

export type ChannelCapabilityKey = (typeof CHANNEL_CAPABILITY_KEYS)[number]

/** Where a capability may be carried. UNOFFICIAL_LIMITED means "allowed, but rate-limited". */
export const CAPABILITY_TARGETS = ['OFFICIAL', 'UNOFFICIAL', 'UNOFFICIAL_LIMITED', 'DISABLED'] as const

export const OUTBOUND_CHANNELS = ['OFFICIAL', 'UNOFFICIAL'] as const
export type OutboundChannel = (typeof OUTBOUND_CHANNELS)[number]

/**
 * Bounds for every safety number, with the reason each floor exists.
 *
 * The floors are the load-bearing half. A ceiling stops an operator hurting throughput; a floor
 * stops them silently switching a guard off.
 */
export const SAFETY_BOUNDS = {
  // 1, not 0: zero would let a campaign send without limit, which is the failure the guard was
  // written for. 600/minute is already ten per second — past any provider's tolerance.
  campaignRatePerMinute: { min: 1, max: 600 },
  // 1000 ms, per the phase brief. Below a second, "identical message just sent" stops being
  // detectable at all and the check becomes decorative.
  duplicateWindowMs: { min: 1_000, max: 24 * 60 * 60 * 1_000 },
  // 1: zero failures would trip the breaker permanently and stop every campaign forever.
  providerFailureThreshold: { min: 1, max: 1_000 },
  providerFailureWindowMs: { min: 10_000, max: 24 * 60 * 60 * 1_000 },
} as const

export const safetyConfigSchema = z
  .object({
    campaignRatePerMinute: z
      .number()
      .int()
      .min(SAFETY_BOUNDS.campaignRatePerMinute.min)
      .max(SAFETY_BOUNDS.campaignRatePerMinute.max),
    duplicateWindowMs: z
      .number()
      .int()
      .min(SAFETY_BOUNDS.duplicateWindowMs.min)
      .max(SAFETY_BOUNDS.duplicateWindowMs.max),
    providerFailureThreshold: z
      .number()
      .int()
      .min(SAFETY_BOUNDS.providerFailureThreshold.min)
      .max(SAFETY_BOUNDS.providerFailureThreshold.max),
    providerFailureWindowMs: z
      .number()
      .int()
      .min(SAFETY_BOUNDS.providerFailureWindowMs.min)
      .max(SAFETY_BOUNDS.providerFailureWindowMs.max),
    quietHoursEnabled: z.boolean(),
  })
  .strict()

export type SafetyConfig = z.infer<typeof safetyConfigSchema>

export const capabilityRulesSchema = z.record(z.enum(CHANNEL_CAPABILITY_KEYS), z.enum(CAPABILITY_TARGETS))

export type CapabilityRules = z.infer<typeof capabilityRulesSchema>

export const channelPolicyDraftSchema = z
  .object({
    // No cast: Zod infers the literal union from the readonly tuple, so `defaultOutbound` comes
    // out as 'OFFICIAL' | 'UNOFFICIAL' rather than plain `string`. That matters — `resolveChannel`
    // returns this value directly, and a widened type there would have to be re-narrowed by hand
    // at every call site.
    defaultOutbound: z.enum(OUTBOUND_CHANNELS),
    officialMode: z.string().trim().min(1).max(60),
    unofficialMode: z.string().trim().min(1).max(60),
    capabilityRules: capabilityRulesSchema,
    safetyConfig: safetyConfigSchema,
  })
  .strict()

export type ChannelPolicyDraft = z.infer<typeof channelPolicyDraftSchema>

/** SDD Manage Second §7.11's default row, verbatim. Also the seed and the runtime fallback. */
export const DEFAULT_CHANNEL_POLICY_KEY = 'whatsapp.default'

export const DEFAULT_CHANNEL_POLICY: ChannelPolicyDraft = {
  defaultOutbound: 'UNOFFICIAL',
  officialMode: 'INBOUND_AND_CAPABILITY',
  unofficialMode: 'PRIMARY_OUTBOUND',
  capabilityRules: {
    send_text: 'UNOFFICIAL',
    send_media: 'UNOFFICIAL',
    send_document: 'UNOFFICIAL',
    send_audio: 'UNOFFICIAL',
    send_template: 'OFFICIAL',
    send_buttons: 'OFFICIAL',
    send_list: 'OFFICIAL',
    send_carousel: 'OFFICIAL',
    campaign: 'UNOFFICIAL_LIMITED',
  },
  safetyConfig: {
    campaignRatePerMinute: 20,
    duplicateWindowMs: 60_000,
    providerFailureThreshold: 5,
    providerFailureWindowMs: 300_000,
    quietHoursEnabled: false,
  },
}

export type PolicyValidation = { ok: true; draft: ChannelPolicyDraft } | { ok: false; error: string }

/** Validates a proposed policy, naming the field at fault rather than dumping Zod's tree. */
export function validateChannelPolicyDraft(value: unknown): PolicyValidation {
  const parsed = channelPolicyDraftSchema.safeParse(value)
  if (parsed.success) return { ok: true, draft: parsed.data }

  const fields = parsed.error.issues.flatMap((issue) =>
    issue.code === 'unrecognized_keys' ? issue.keys : [issue.path.join('.') || '(kebijakan)']
  )
  return { ok: false, error: `Kebijakan channel tidak valid pada: ${[...new Set(fields)].join(', ')}.` }
}

/**
 * Reads a stored policy back, defensively.
 *
 * Returns null for anything this build cannot understand, so the runtime falls back to the
 * code's own constants rather than handing the send path a half-read shape. A policy that
 * cannot be parsed must not be able to silently disable the duplicate guard.
 */
export function readChannelPolicy(value: unknown): ChannelPolicyDraft | null {
  const parsed = channelPolicyDraftSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * Warnings an operator should read before publishing, and the reason each is a WARNING.
 *
 * None of these block: every one of them is a legitimate choice somebody might have to make in
 * an incident, and a policy editor that refuses the choice an incident requires is one that
 * gets bypassed by editing the database directly. What they must not be is silent.
 */
export function policyWarnings(draft: ChannelPolicyDraft): string[] {
  const warnings: string[] = []

  if (draft.defaultOutbound === 'OFFICIAL') {
    // CLAUDE.md's channel policy, and the single most consequential switch on this page: every
    // agent and bot reply would start costing a Meta conversation and obeying its 24-hour rule.
    warnings.push(
      'Default outbound diarahkan ke OFFICIAL. Kebijakan tertulis adalah UNOFFICIAL — semua balasan agent dan bot akan lewat Meta, dengan biaya dan jendela 24 jam yang mengikutinya.'
    )
  }

  if (draft.capabilityRules.send_text === 'OFFICIAL') {
    warnings.push('Teks biasa diarahkan ke OFFICIAL, padahal itu jalur balasan harian.')
  }

  for (const [key, target] of Object.entries(draft.capabilityRules)) {
    if (target === 'DISABLED') warnings.push(`Kemampuan "${key}" dimatikan sepenuhnya.`)
  }

  if (draft.safetyConfig.campaignRatePerMinute > DEFAULT_CHANNEL_POLICY.safetyConfig.campaignRatePerMinute * 5) {
    warnings.push(
      `Batas campaign ${draft.safetyConfig.campaignRatePerMinute}/menit jauh di atas default ${DEFAULT_CHANNEL_POLICY.safetyConfig.campaignRatePerMinute} — risiko diblokir provider.`
    )
  }

  if (draft.safetyConfig.duplicateWindowMs < DEFAULT_CHANNEL_POLICY.safetyConfig.duplicateWindowMs) {
    warnings.push('Jendela deteksi duplikat lebih pendek dari default — pesan kembar lebih mungkin lolos.')
  }

  return warnings
}
