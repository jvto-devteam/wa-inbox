import { prisma } from '@/lib/db'
import {
  channelForCapability,
  preferredChannelForCapability,
  supportsCapability,
  type ChannelCapabilityKey,
} from '@/lib/bot-control/channel-capabilities'

/**
 * The channel a message goes out on when nothing else decides.
 *
 * CLAUDE.md's written policy, and the value every failure path here ends at. It is a constant
 * rather than a database read for the obvious reason: this function runs on every outbound
 * message, and the one thing it may never do is fail to name a channel.
 */
const CODE_DEFAULT_CHANNEL = 'UNOFFICIAL'

/**
 * Decides which channel a message goes out on.
 *
 * --- Two layers, and there used to be four ---
 *
 *   1. An EXPLICIT channel from the caller always wins. `/api/send` passes one when an agent
 *      picked a channel by hand, and anything that could override that would make the picker a
 *      suggestion box.
 *   2. `Settings.defaultChannel`, edited on /settings. The ONLY stored default.
 *
 * Between those two there used to sit a published default on a channel-policy row and, before
 * that, a `liveDefaultChannel` key inside a rule's JSON config. Three stored sources for one
 * answer meant the honest response to "which channel does a reply go out on" was "it depends
 * which of these was written last", and two of the three were edited on pages that never said
 * the third existed. Both are gone; this column is what remains.
 *
 * Note what this function does NOT decide: capability routing. `resolveChannelForCapability`
 * below answers that from the physical matrix, so a template goes over Official whatever this
 * column says. That was already true when the policy row existed — its per-capability table
 * outranked this column too — so nothing about which channel carries what has moved.
 *
 * Every failure path ends in a channel. This runs on every outbound message — an exception here
 * does not degrade delivery, it stops it.
 */
export async function resolveChannel(explicit?: 'OFFICIAL' | 'UNOFFICIAL'): Promise<'OFFICIAL' | 'UNOFFICIAL'> {
  if (explicit) return explicit

  try {
    const settings = await prisma.settings.findUnique({ where: { id: 1 }, select: { defaultChannel: true } })
    if (settings) return settings.defaultChannel
  } catch (error) {
    console.error('resolveChannel: gagal membaca Settings, memakai default kode', { error })
  }

  return CODE_DEFAULT_CHANNEL
}

/**
 * Which channel should carry a given capability.
 *
 * Answered from `channel-capabilities.ts` — the matrix of what each provider's API actually
 * implements. It used to be answered from an editable table on the Channel Policy page, and the
 * answers are the same ones: that page's default row said exactly what the matrix says, and the
 * only thing an operator could do with the form was contradict a provider's API, which
 * `resolveChannelForCapability` then corrected back.
 *
 * Returns null when the matrix has nothing that can carry it — the caller then keeps whatever
 * it would have done anyway. "Nowhere can send this" is not a routing answer, and every caller
 * here is already committed to sending something.
 *
 * Synchronous on purpose. It was async when it read a cached database row; making it a plain
 * function is how each call site says out loud that this is a fact about the providers, not a
 * lookup that can be stale, fail, or be edited between two sends in the same request.
 */
export function channelForCapabilityPolicy(capability: ChannelCapabilityKey): 'OFFICIAL' | 'UNOFFICIAL' | null {
  return preferredChannelForCapability(capability)
}

/**
 * Whether a capability cannot be sent at all.
 *
 * True only when NO channel implements it. The old policy row had a DISABLED target that an
 * operator could pick per capability; nothing else could ever make this true, and it was never
 * set in production. With that form gone this is the matrix's own answer, which is false for
 * all nine send capabilities — Official carries every one of them — exactly as it was for the
 * default row this replaces.
 *
 * Kept rather than deleted because the send paths' refusal branch is the right shape: a
 * capability nothing can carry must be reported to the caller, not dispatched into a
 * guaranteed failure. It becomes reachable the day a capability is added that Official cannot
 * carry either.
 */
export function isCapabilityDisabled(capability: ChannelCapabilityKey): boolean {
  return preferredChannelForCapability(capability) === null
}

/** What was decided for one capability, and whether it may be sent at all. */
export type CapabilityRouting = {
  channel: 'OFFICIAL' | 'UNOFFICIAL'
  /** No channel can carry this capability; the caller must not dispatch. */
  disabled: boolean
  /** Set when the preferred channel physically cannot carry the capability. */
  clampedFrom: 'OFFICIAL' | 'UNOFFICIAL' | null
}

/**
 * The single entry point a send path should use. SDD Manage Second §15 Phase H task 4.
 *
 * `channelForCapabilityPolicy` and `isCapabilityDisabled` above answer half the question each,
 * and having two of them is why neither was ever called: a send path wants one answer. This
 * composes them, and adds the two rules that make the answer safe to obey.
 *
 * --- DISABLED outranks an explicit channel ---
 *
 * Everywhere else an explicit channel wins, because an agent picking one by hand must not be
 * second-guessed. "Cannot be sent at all" is different in kind: it is not a routing preference
 * that might want overriding, it is a statement that no code path exists to carry this. An
 * explicit channel walking past it would only turn a clean refusal into a delivery failure.
 *
 * --- 'LIMITED' is clamped, and that is where campaign lands ---
 *
 * `preferredChannelForCapability` counts 'LIMITED' as capable, so `campaign` prefers Unofficial
 * — the answer the published policy row gave. `supportsCapability` does not, so the clamp below
 * moves it to Official and logs the correction. Both halves are deliberate and both are
 * unchanged from the policy-row behaviour: the preference is honest about what the provider can
 * technically do, and the clamp is honest that bulk sending over an unofficial number without a
 * throttle in front of it is how the number gets banned. There is no campaign sender yet; when
 * one arrives it will find this decision already made and already logged rather than implied.
 */
export async function resolveChannelForCapability(
  capability: ChannelCapabilityKey,
  explicit?: 'OFFICIAL' | 'UNOFFICIAL'
): Promise<CapabilityRouting> {
  if (isCapabilityDisabled(capability)) {
    return { channel: explicit ?? CODE_DEFAULT_CHANNEL, disabled: true, clampedFrom: null }
  }

  if (explicit) return { channel: explicit, disabled: false, clampedFrom: null }

  const preferred = channelForCapabilityPolicy(capability)
  // Unreachable while the matrix has no capability both channels refuse — `isCapabilityDisabled`
  // above already returned for that case. Kept so the fallback is the org-wide default rather
  // than a crash if that ever stops being true.
  if (preferred === null) return { channel: await resolveChannel(), disabled: false, clampedFrom: null }

  if (supportsCapability(preferred, capability)) {
    return { channel: preferred, disabled: false, clampedFrom: null }
  }

  const corrected = channelForCapability(capability)
  console.warn('resolveChannelForCapability: channel yang dipilih tidak mendukung kemampuan ini', {
    capability,
    preferred,
    usedInstead: corrected,
  })
  return { channel: corrected, disabled: false, clampedFrom: preferred }
}
