/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import {
  validateFlowSafeConfig,
  editableFieldsFor,
  canEditField,
  SAFE_CONFIG_FIELDS,
  MAX_CLARIFICATION_ATTEMPTS,
} from './flow-config'

describe('editable levels', () => {
  it('gives READ_ONLY no editable fields at all', () => {
    // A flow nobody opened for editing must offer no controls: an inert form is worse than
    // none, because an operator will believe they changed the bot.
    expect(editableFieldsFor('READ_ONLY')).toEqual([])
    expect(validateFlowSafeConfig('READ_ONLY', { greetingText: 'Halo' }).ok).toBe(false)
  })

  it('gives an unknown level nothing either, failing closed', () => {
    expect(editableFieldsFor('ENTAH')).toEqual([])
    expect(validateFlowSafeConfig('ENTAH', {}).ok).toBe(false)
  })

  it('lets TEXT_ONLY change sentences but not thresholds or field lists', () => {
    expect(canEditField('TEXT_ONLY', 'fallbackReply')).toBe(true)
    expect(canEditField('TEXT_ONLY', 'maxClarificationAttempts')).toBe(false)
    expect(canEditField('TEXT_ONLY', 'leadFields')).toBe(false)
  })

  it('checks the level PER FIELD, not once for the whole payload', () => {
    // A TEXT_ONLY flow that accepted a threshold because the rest of the object was fine would
    // have its level mean nothing at all.
    const result = validateFlowSafeConfig('TEXT_ONLY', {
      fallbackReply: 'Maaf, saya belum tahu.',
      maxClarificationAttempts: 3,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('maxClarificationAttempts')
  })

  it('gives SAFE_CONFIG every field in the list', () => {
    expect(editableFieldsFor('SAFE_CONFIG')).toEqual([...SAFE_CONFIG_FIELDS])
  })
})

describe('validateFlowSafeConfig', () => {
  it('accepts the seven safe fields', () => {
    const config = {
      greetingText: 'Halo!',
      clarificationPrompt: 'Boleh dijelaskan lagi?',
      maxClarificationAttempts: 2,
      fallbackReply: 'Saya cek dulu ya.',
      handoffReply: 'Saya sambungkan ke agent.',
      workingHoursReply: 'Kami balas jam kerja.',
      leadFields: ['nama', 'tanggal'],
    }
    expect(validateFlowSafeConfig('SAFE_CONFIG', config)).toEqual({ ok: true, config })
  })

  it('rejects a field that is not on the list, rather than storing it and ignoring it', () => {
    // A stored key that nothing reads is indistinguishable, from the UI, from one that works.
    const result = validateFlowSafeConfig('SAFE_CONFIG', { branchingRules: [{ if: 'x' }] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('branchingRules')
  })

  it('refuses zero clarification attempts, which would disable clarification entirely', () => {
    // A behaviour change dressed as a setting.
    expect(validateFlowSafeConfig('SAFE_CONFIG', { maxClarificationAttempts: 0 }).ok).toBe(false)
  })

  it('caps clarification attempts, so a confused customer can still reach a human', () => {
    expect(validateFlowSafeConfig('SAFE_CONFIG', { maxClarificationAttempts: MAX_CLARIFICATION_ATTEMPTS }).ok).toBe(true)
    expect(
      validateFlowSafeConfig('SAFE_CONFIG', { maxClarificationAttempts: MAX_CLARIFICATION_ATTEMPTS + 1 }).ok
    ).toBe(false)
  })

  it('accepts an empty string, which means "keep the code wording"', () => {
    // Forcing an operator to retype the original sentence to revert is how a typo becomes
    // permanent.
    expect(validateFlowSafeConfig('SAFE_CONFIG', { fallbackReply: '' }).ok).toBe(true)
  })

  it('accepts an empty config, which changes nothing', () => {
    expect(validateFlowSafeConfig('SAFE_CONFIG', {}).ok).toBe(true)
    expect(validateFlowSafeConfig('SAFE_CONFIG', undefined).ok).toBe(true)
  })

  it('rejects a non-object config', () => {
    expect(validateFlowSafeConfig('SAFE_CONFIG', 'teks biasa').ok).toBe(false)
    expect(validateFlowSafeConfig('SAFE_CONFIG', [1, 2]).ok).toBe(false)
  })

  it('caps the lead-field list, since each one is another question before an answer', () => {
    const many = Array.from({ length: 11 }, (_, i) => `field${i}`)
    expect(validateFlowSafeConfig('SAFE_CONFIG', { leadFields: many }).ok).toBe(false)
  })
})
