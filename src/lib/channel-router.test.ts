import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { CHANNEL_CAPABILITY_KEYS, type ChannelCapabilityKey } from '@/lib/bot-control/channel-capabilities'
import {
  resolveChannel,
  channelForCapabilityPolicy,
  isCapabilityDisabled,
  resolveChannelForCapability,
} from './channel-router'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  mockPrisma.settings.findUnique.mockResolvedValue({ defaultChannel: 'UNOFFICIAL' } as never)
})

describe('resolveChannel', () => {
  it('returns the explicit channel unchanged when provided', async () => {
    // An agent who picked a channel by hand must not be overridden, or the picker is a
    // suggestion box.
    expect(await resolveChannel('UNOFFICIAL')).toBe('UNOFFICIAL')
    expect(await resolveChannel('OFFICIAL')).toBe('OFFICIAL')
    expect(mockPrisma.settings.findUnique).not.toHaveBeenCalled()
  })

  it('reads Settings.defaultChannel, the only stored default there is', async () => {
    // There used to be three stored answers to this question — a rule's `liveDefaultChannel`, a
    // channel-policy row, and this column — and the honest reply to "which channel does a reply
    // go out on" was "whichever was written last". This is the one that remains.
    mockPrisma.settings.findUnique.mockResolvedValue({ defaultChannel: 'OFFICIAL' } as never)
    expect(await resolveChannel()).toBe('OFFICIAL')
    expect(mockPrisma.settings.findUnique.mock.calls[0][0]?.where).toEqual({ id: 1 })
  })

  it('still returns a channel when Settings cannot be read', async () => {
    // This runs on every outbound message: an exception here does not degrade delivery, it
    // stops it.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.settings.findUnique.mockRejectedValue(new Error('db down'))

    expect(await resolveChannel()).toBe('UNOFFICIAL')
  })

  it('still returns a channel when there is no Settings row at all', async () => {
    mockPrisma.settings.findUnique.mockResolvedValue(null as never)
    expect(await resolveChannel()).toBe('UNOFFICIAL')
  })
})

/**
 * The answers the published default channel-policy row used to give, per capability.
 *
 * Written out literally rather than derived, because "derived from the same matrix the code
 * reads" would prove nothing. This is the transcript of that row's per-capability table as it
 * was seeded and as it stood in production, and every value below has to survive the removal of
 * the editable layer that produced it.
 */
const POLICY_ROW_ANSWERS: Record<ChannelCapabilityKey, 'OFFICIAL' | 'UNOFFICIAL'> = {
  send_text: 'UNOFFICIAL',
  send_media: 'UNOFFICIAL',
  send_document: 'UNOFFICIAL',
  send_audio: 'UNOFFICIAL',
  send_template: 'OFFICIAL',
  send_buttons: 'OFFICIAL',
  send_list: 'OFFICIAL',
  send_carousel: 'OFFICIAL',
  // The row said UNOFFICIAL_LIMITED, which `channelForCapabilityPolicy` resolved to Unofficial:
  // "limited" is a rate concern the safety guard applies, not a different channel.
  campaign: 'UNOFFICIAL',
}

describe('channelForCapabilityPolicy', () => {
  it('routes a template to OFFICIAL and plain text to UNOFFICIAL', () => {
    expect(channelForCapabilityPolicy('send_template')).toBe('OFFICIAL')
    expect(channelForCapabilityPolicy('send_text')).toBe('UNOFFICIAL')
  })

  it('treats a LIMITED capability as Unofficial, because "limited" is a rate concern', () => {
    expect(channelForCapabilityPolicy('campaign')).toBe('UNOFFICIAL')
  })

  it('gives exactly the answers the published default policy row gave, for all nine capabilities', () => {
    // The point of this file. The editable per-capability table was deleted; if any one of these
    // nine moved, a message that used to go out over one channel now goes out over the other.
    for (const capability of CHANNEL_CAPABILITY_KEYS) {
      expect(channelForCapabilityPolicy(capability), capability).toBe(POLICY_ROW_ANSWERS[capability])
    }
  })

  it('never consults the database', () => {
    // It used to read a cached policy row. Which channel can carry a template is a fact about
    // wa-coexist's API, not a lookup that can be stale, fail, or be edited between two sends.
    for (const capability of CHANNEL_CAPABILITY_KEYS) channelForCapabilityPolicy(capability)
    expect(mockPrisma.settings.findUnique).not.toHaveBeenCalled()
  })

  it('returns null only when no channel can carry a capability, which no send capability is today', () => {
    // Null used to mean "an operator set this capability to DISABLED on the Channel Policy
    // page". That form is gone, and the matrix has no capability both channels refuse — Official
    // carries all nine — so null is currently unreachable. Pinned rather than left implicit,
    // because the day it stops being true is the day the refusal branch below starts firing.
    for (const capability of CHANNEL_CAPABILITY_KEYS) {
      expect(channelForCapabilityPolicy(capability), capability).not.toBeNull()
    }
  })
})

describe('isCapabilityDisabled', () => {
  it('is false for every send capability, exactly as it was under the default policy row', () => {
    for (const capability of CHANNEL_CAPABILITY_KEYS) {
      expect(isCapabilityDisabled(capability), capability).toBe(false)
    }
  })

  it('never consults the database', () => {
    isCapabilityDisabled('send_text')
    expect(mockPrisma.settings.findUnique).not.toHaveBeenCalled()
  })
})

/**
 * Regression cover for the audit finding "9 capability rules di Channel Policy tidak punya
 * caller" — `channelForCapabilityPolicy` and `isCapabilityDisabled` existed, were published,
 * snapshotted and rolled back correctly, and were read by nothing on any send path.
 *
 * These pin the composed entry point the send paths call. The rule worth stating is that the
 * physical matrix clamps the preference: a capability may PREFER a channel that cannot actually
 * carry it, and obeying that literally would be a guaranteed delivery failure.
 */
describe('resolveChannelForCapability (regresi Temuan 2)', () => {
  it('mengikuti channel yang ditunjuk matriks', async () => {
    expect(await resolveChannelForCapability('send_template')).toEqual({
      channel: 'OFFICIAL',
      disabled: false,
      clampedFrom: null,
    })
  })

  it('menghormati channel eksplisit', async () => {
    expect(await resolveChannelForCapability('send_text', 'OFFICIAL')).toEqual({
      channel: 'OFFICIAL',
      disabled: false,
      clampedFrom: null,
    })
  })

  it('mengoreksi kemampuan yang channel pilihannya tidak bisa membawanya', async () => {
    // `campaign` is 'LIMITED' on Unofficial: technically possible, and exactly what gets a
    // number banned without a throttle in front of it. The preference is honest about the
    // former; the clamp is honest about the latter. The correction is reported, not silent —
    // routing that quietly does not do what it says is its own kind of lie.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await resolveChannelForCapability('campaign')).toEqual({
      channel: 'OFFICIAL',
      disabled: false,
      clampedFrom: 'UNOFFICIAL',
    })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('menghasilkan routing yang identik dengan baris kebijakan default untuk kesembilan kemampuan', async () => {
    // The composed answer, not just the preference: `campaign` is the one capability where the
    // two differ, and it differed in exactly the same way before this table was removed.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    for (const capability of CHANNEL_CAPABILITY_KEYS) {
      const routing = await resolveChannelForCapability(capability)
      const expected = capability === 'campaign' ? 'OFFICIAL' : POLICY_ROW_ANSWERS[capability]
      expect(routing.channel, capability).toBe(expected)
      expect(routing.disabled, capability).toBe(false)
    }

    warn.mockRestore()
  })

  it('tidak menyentuh database untuk kemampuan yang sudah punya channel', async () => {
    // Every capability has one, so `resolveChannel`'s Settings read is never reached from here.
    // That was already true when the policy row existed — its per-capability table outranked
    // Settings too — so this pins that nothing about the send path's query count moved.
    await resolveChannelForCapability('send_text')
    expect(mockPrisma.settings.findUnique).not.toHaveBeenCalled()
  })
})
