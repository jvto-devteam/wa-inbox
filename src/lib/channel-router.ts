import { prisma } from '@/lib/db'
import { getChannelPolicy } from '@/lib/bot-control/runtime-channel-policy'
import type { ChannelCapabilityKey } from '@/lib/bot-control/channel-policy-config'
import { channelForCapability, supportsCapability } from '@/lib/bot-control/channel-capabilities'

/**
 * Decides which channel a message goes out on.
 *
 * --- Three layers, and the order is the whole design ---
 *
 *   1. An EXPLICIT channel from the caller always wins. `/api/send` passes one when an agent
 *      picked a channel by hand, and a policy that could override that would make the picker a
 *      suggestion box.
 *   2. `ChannelPolicySetting.defaultOutbound`, published through Bot Control.
 *   3. `Settings.defaultChannel`, the column this function has always read.
 *
 * Layer 3 stays, and stays LAST rather than being deleted, because the Settings page still
 * writes to it. Removing it would silently strip a control an operator already uses; keeping it
 * as the fallback means the app behaves exactly as before until somebody publishes a policy,
 * and the policy wins from the moment they do.
 *
 * Every failure path ends in a channel. This runs on every outbound message — an exception here
 * does not degrade delivery, it stops it.
 */
export async function resolveChannel(explicit?: 'OFFICIAL' | 'UNOFFICIAL'): Promise<'OFFICIAL' | 'UNOFFICIAL'> {
  if (explicit) return explicit

  const policy = await getChannelPolicy()
  if (policy.source === 'database') return policy.defaultOutbound

  // No published policy yet: read the column the Settings page owns, exactly as before.
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } })
    if (settings) return settings.defaultChannel
  } catch (error) {
    console.error('resolveChannel: gagal membaca Settings, memakai default kebijakan', { error })
  }

  return policy.defaultOutbound
}

/**
 * Which channel the policy says should carry a given capability.
 *
 * Returns null when the policy has nothing to say about it — the caller then keeps whatever it
 * would have done anyway. A capability the policy has DISABLED also returns null rather than a
 * channel, because "do not send this" is not a routing answer and every caller here is already
 * committed to sending something.
 */
export async function channelForCapabilityPolicy(
  capability: ChannelCapabilityKey
): Promise<'OFFICIAL' | 'UNOFFICIAL' | null> {
  const policy = await getChannelPolicy()
  const target = policy.capabilityRules[capability]
  if (target === 'OFFICIAL') return 'OFFICIAL'
  // UNOFFICIAL_LIMITED still routes over Unofficial; the "limited" half is a rate concern the
  // safety guard applies, not a different channel.
  if (target === 'UNOFFICIAL' || target === 'UNOFFICIAL_LIMITED') return 'UNOFFICIAL'
  return null
}

/** Whether the policy has switched a capability off entirely. */
export async function isCapabilityDisabled(capability: ChannelCapabilityKey): Promise<boolean> {
  return (await getChannelPolicy()).capabilityRules[capability] === 'DISABLED'
}

/** What the policy decided for one capability, and whether it may be sent at all. */
export type CapabilityRouting = {
  channel: 'OFFICIAL' | 'UNOFFICIAL'
  /** The policy switched this capability off entirely; the caller must not dispatch. */
  disabled: boolean
  /** Set when the policy named a channel that physically cannot carry the capability. */
  clampedFrom: 'OFFICIAL' | 'UNOFFICIAL' | null
}

/**
 * The single entry point a send path should use. SDD Manage Second §15 Phase H task 4.
 *
 * `channelForCapabilityPolicy` and `isCapabilityDisabled` above answer half the question each,
 * and having two of them is why neither was ever called: a send path wants one answer. This
 * composes them, and adds the two rules that make the policy safe to obey.
 *
 * --- DISABLED outranks an explicit channel ---
 *
 * Everywhere else an explicit channel wins, because an agent picking one by hand must not be
 * second-guessed. "Off" is different in kind: it is not a routing preference the operator might
 * want overridden, it is the operator saying this must not go out. A DISABLED capability that an
 * explicit channel could walk past would be a switch that does nothing whenever it matters.
 *
 * --- The physical matrix clamps the policy ---
 *
 * `channel-capabilities.ts` describes endpoints that exist; the policy only says which channel
 * should carry them. So a policy routing `send_template` to Unofficial — where wa-coexist has no
 * template endpoint at all — is corrected to the channel that can actually carry it rather than
 * obeyed into a guaranteed delivery failure. The correction is logged, because a policy quietly
 * not doing what it says is its own kind of lie.
 */
export async function resolveChannelForCapability(
  capability: ChannelCapabilityKey,
  explicit?: 'OFFICIAL' | 'UNOFFICIAL'
): Promise<CapabilityRouting> {
  if (await isCapabilityDisabled(capability)) {
    return { channel: explicit ?? 'UNOFFICIAL', disabled: true, clampedFrom: null }
  }

  if (explicit) return { channel: explicit, disabled: false, clampedFrom: null }

  const preferred = await channelForCapabilityPolicy(capability)
  if (preferred === null) return { channel: await resolveChannel(), disabled: false, clampedFrom: null }

  if (supportsCapability(preferred, capability)) {
    return { channel: preferred, disabled: false, clampedFrom: null }
  }

  const corrected = channelForCapability(capability)
  console.warn('resolveChannelForCapability: kebijakan menunjuk channel yang tidak mendukung kemampuan ini', {
    capability,
    policyTarget: preferred,
    usedInstead: corrected,
  })
  return { channel: corrected, disabled: false, clampedFrom: preferred }
}
