import { prisma } from '@/lib/db'
import { getChannelPolicy } from '@/lib/bot-control/runtime-channel-policy'
import type { ChannelCapabilityKey } from '@/lib/bot-control/channel-policy-config'

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
