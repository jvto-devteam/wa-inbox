/**
 * The outbound safety numbers: the code's defaults, and the range an operator may type.
 *
 * --- Why this is its own module and not part of safety-guard.ts ---
 *
 * `safety-guard.ts` imports Prisma. The Settings page is a client component and needs these
 * bounds to put `min`/`max` on its inputs, so importing them from the guard would pull the
 * database client into the browser bundle. The alternative — retyping 1, 600, 1000 and the rest
 * into JSX — is how a floor and the form that is supposed to enforce it drift apart. One file
 * with no imports, read by the guard, the route that validates, and the form that offers.
 *
 * --- Why bounds exist at all ---
 *
 * These four numbers decide whether the duplicate check, the campaign rate limit and the
 * provider circuit breaker do anything at all. Zero on `campaignRatePerMinute` does not
 * "loosen" the limit — it disables the gate. A duplicate window of 0 ms disables duplicate
 * detection. Both are behaviour changes dressed as settings, and both are one keystroke away
 * without a floor.
 *
 * They used to live in a policy row behind a draft → review → approve → publish cycle, and the
 * floors were enforced on the way into that cycle. The cycle is gone: these are ordinary
 * columns on `Settings`, saved straight from a form. That makes the floors MORE load-bearing,
 * not less — there is no longer an approver between the keystroke and the send path. The
 * ceiling stops an operator hurting throughput; the floor stops them silently switching a guard
 * off. PATCH /api/settings is the only writer, and it is where these are enforced.
 */

/**
 * The code's own numbers, and what the guard runs on when `Settings` cannot be read.
 *
 * Also the schema defaults, so a row nobody has edited behaves exactly like a build that has
 * never heard of these columns.
 */
export const DUPLICATE_WINDOW_MS = 60_000
export const CAMPAIGN_RATE_PER_MINUTE = 20
export const PROVIDER_FAILURE_THRESHOLD = 5
export const PROVIDER_FAILURE_WINDOW_MS = 5 * 60_000

/** Bounds for every safety number, with the reason each floor is where it is. */
export const SAFETY_BOUNDS = {
  // 1, not 0: zero would let a campaign send without limit, which is the failure the guard was
  // written for. 600/minute is already ten per second — past any provider's tolerance.
  campaignRatePerMinute: { min: 1, max: 600 },
  // 1000 ms. Below a second, "identical message just sent" stops being detectable at all and
  // the check becomes decorative.
  duplicateWindowMs: { min: 1_000, max: 24 * 60 * 60 * 1_000 },
  // 1: zero failures would trip the breaker permanently and stop every campaign forever.
  providerFailureThreshold: { min: 1, max: 1_000 },
  providerFailureWindowMs: { min: 10_000, max: 24 * 60 * 60 * 1_000 },
} as const

export type SafetyBoundKey = keyof typeof SAFETY_BOUNDS

/** Field order and wording for the Settings form, kept next to the bounds they belong to. */
export const SAFETY_FIELD_LABELS: Record<SafetyBoundKey, string> = {
  campaignRatePerMinute: 'Batas pengiriman campaign per menit',
  duplicateWindowMs: 'Jendela deteksi pesan duplikat (ms)',
  providerFailureThreshold: 'Jumlah kegagalan sebelum campaign dijeda',
  providerFailureWindowMs: 'Rentang waktu penghitungan kegagalan (ms)',
}

export type SafetyThresholds = Record<SafetyBoundKey, number>

export const DEFAULT_SAFETY_THRESHOLDS: SafetyThresholds = {
  campaignRatePerMinute: CAMPAIGN_RATE_PER_MINUTE,
  duplicateWindowMs: DUPLICATE_WINDOW_MS,
  providerFailureThreshold: PROVIDER_FAILURE_THRESHOLD,
  providerFailureWindowMs: PROVIDER_FAILURE_WINDOW_MS,
}
