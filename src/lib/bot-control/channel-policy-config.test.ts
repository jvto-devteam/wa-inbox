/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import type { ChannelCapability } from './channel-capabilities'
import {
  validateChannelPolicyDraft,
  readChannelPolicy,
  policyWarnings,
  DEFAULT_CHANNEL_POLICY,
  CHANNEL_CAPABILITY_KEYS,
  SAFETY_BOUNDS,
} from './channel-policy-config'

const valid = DEFAULT_CHANNEL_POLICY

describe('capability keys', () => {
  it('names only capabilities the code actually implements', () => {
    // A routing rule for a capability that cannot be sent routes nothing. This assignment fails
    // to compile the moment a key here stops existing in channel-capabilities.ts.
    const asImplemented: readonly ChannelCapability[] = CHANNEL_CAPABILITY_KEYS
    expect(asImplemented.length).toBe(9)
  })
})

describe('validateChannelPolicyDraft', () => {
  it('accepts the SDD default row verbatim', () => {
    expect(validateChannelPolicyDraft(valid)).toEqual({ ok: true, draft: valid })
  })

  it('refuses a campaign rate of zero, which would disable the gate', () => {
    // Not "looser" — off. A behaviour change dressed as a setting.
    const result = validateChannelPolicyDraft({
      ...valid,
      safetyConfig: { ...valid.safetyConfig, campaignRatePerMinute: 0 },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('campaignRatePerMinute')
  })

  it('refuses a duplicate window below one second', () => {
    // Below a second, "identical message just sent" stops being detectable at all.
    expect(
      validateChannelPolicyDraft({ ...valid, safetyConfig: { ...valid.safetyConfig, duplicateWindowMs: 999 } }).ok
    ).toBe(false)
    expect(
      validateChannelPolicyDraft({
        ...valid,
        safetyConfig: { ...valid.safetyConfig, duplicateWindowMs: SAFETY_BOUNDS.duplicateWindowMs.min },
      }).ok
    ).toBe(true)
  })

  it('refuses a provider failure threshold of zero, which would trip the breaker forever', () => {
    expect(
      validateChannelPolicyDraft({
        ...valid,
        safetyConfig: { ...valid.safetyConfig, providerFailureThreshold: 0 },
      }).ok
    ).toBe(false)
  })

  it('caps the campaign rate, so the limiter cannot become its own denial of service', () => {
    expect(
      validateChannelPolicyDraft({
        ...valid,
        safetyConfig: { ...valid.safetyConfig, campaignRatePerMinute: SAFETY_BOUNDS.campaignRatePerMinute.max + 1 },
      }).ok
    ).toBe(false)
  })

  it('refuses a capability key the code does not implement', () => {
    const result = validateChannelPolicyDraft({
      ...valid,
      capabilityRules: { ...valid.capabilityRules, send_telegram: 'UNOFFICIAL' },
    })
    expect(result.ok).toBe(false)
  })

  it('refuses a routing target outside the known set', () => {
    expect(
      validateChannelPolicyDraft({ ...valid, capabilityRules: { ...valid.capabilityRules, send_text: 'SMS' } }).ok
    ).toBe(false)
  })

  it('refuses an unknown top-level field rather than storing it silently', () => {
    const result = validateChannelPolicyDraft({ ...valid, quietHoursStart: '22:00' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('quietHoursStart')
  })

  it('refuses a default outbound that is not a channel', () => {
    expect(validateChannelPolicyDraft({ ...valid, defaultOutbound: 'TELEGRAM' }).ok).toBe(false)
  })
})

describe('readChannelPolicy', () => {
  it('returns null for a shape this build cannot understand', () => {
    // A policy that cannot be parsed must not be able to silently disable the duplicate guard.
    expect(readChannelPolicy({ bentuk: 'lama' })).toBeNull()
    expect(readChannelPolicy(null)).toBeNull()
  })

  it('returns the parsed policy for a valid one', () => {
    expect(readChannelPolicy(valid)).toEqual(valid)
  })
})

describe('policyWarnings', () => {
  it('says nothing about the default policy', () => {
    expect(policyWarnings(valid)).toEqual([])
  })

  it('warns loudly about routing everything through OFFICIAL', () => {
    const warnings = policyWarnings({ ...valid, defaultOutbound: 'OFFICIAL' })
    expect(warnings.some((w) => w.includes('OFFICIAL'))).toBe(true)
    expect(warnings.some((w) => w.includes('24 jam'))).toBe(true)
  })

  it('warns when plain text is routed to OFFICIAL', () => {
    const warnings = policyWarnings({
      ...valid,
      capabilityRules: { ...valid.capabilityRules, send_text: 'OFFICIAL' },
    })
    expect(warnings.some((w) => w.includes('Teks biasa'))).toBe(true)
  })

  it('names each capability that has been switched off', () => {
    const warnings = policyWarnings({
      ...valid,
      capabilityRules: { ...valid.capabilityRules, send_media: 'DISABLED' },
    })
    expect(warnings.some((w) => w.includes('send_media'))).toBe(true)
  })

  it('warns about a campaign rate far above the default', () => {
    const warnings = policyWarnings({
      ...valid,
      safetyConfig: { ...valid.safetyConfig, campaignRatePerMinute: 500 },
    })
    expect(warnings.some((w) => w.includes('500'))).toBe(true)
  })

  it('warns about a shortened duplicate window, without refusing it', () => {
    // Legitimate in an incident; it just must not be silent.
    const warnings = policyWarnings({ ...valid, safetyConfig: { ...valid.safetyConfig, duplicateWindowMs: 5_000 } })
    expect(warnings.some((w) => w.includes('duplikat'))).toBe(true)
  })
})
