/**
 * The live channel policy, for the send path.
 *
 * Same contract as the other three runtime loaders — thirty-second cache, never throws, falls
 * back to the code's own defaults — and here the "never throws" clause matters more than
 * anywhere else. This is read by `resolveChannel`, which runs on EVERY outbound message. A
 * throw would not degrade the bot, it would stop every reply in the system, agent replies
 * included, because a configuration row could not be read.
 *
 * The fallback is `DEFAULT_CHANNEL_POLICY`, which is the SDD's own default row and matches what
 * the code did before this table existed. So an unreadable database means the app behaves
 * exactly as it did in Phase G, not that it behaves unpredictably.
 */
import { prisma } from '@/lib/db'
import {
  DEFAULT_CHANNEL_POLICY,
  DEFAULT_CHANNEL_POLICY_KEY,
  readChannelPolicy,
  type ChannelPolicyDraft,
} from '@/lib/bot-control/channel-policy-config'

export const CHANNEL_POLICY_CACHE_TTL_MS = 30_000

export type RuntimeChannelPolicy = ChannelPolicyDraft & {
  /** 'database' when a published row supplied it, 'code' when this is the fallback. */
  source: 'database' | 'code'
}

type CacheEntry = { value: RuntimeChannelPolicy; expiresAt: number }
let cache: CacheEntry | null = null

/** Drops the cache. Called after a publish so an operator sees their change take effect. */
export function invalidateChannelPolicyCache(): void {
  cache = null
}

const FALLBACK: RuntimeChannelPolicy = { ...DEFAULT_CHANNEL_POLICY, source: 'code' }

export async function getChannelPolicy(now: number = Date.now()): Promise<RuntimeChannelPolicy> {
  if (cache && cache.expiresAt > now) return cache.value

  // Whole body guarded, like the other three loaders: this sits in front of EVERY send, so a
  // line after the await throwing would stop delivery for the whole account.
  try {
    const row = await prisma.channelPolicySetting.findUnique({
      where: { key: DEFAULT_CHANNEL_POLICY_KEY },
      select: {
        defaultOutbound: true,
        officialMode: true,
        unofficialMode: true,
        capabilityRules: true,
        safetyConfig: true,
      },
    })

    // No row is the un-seeded state, not "no policy". Reading it as data would leave the send
    // path with no default channel at all.
    const policy = row
      ? readChannelPolicy({
          defaultOutbound: row.defaultOutbound,
          officialMode: row.officialMode,
          unofficialMode: row.unofficialMode,
          capabilityRules: row.capabilityRules,
          safetyConfig: row.safetyConfig,
        })
      : null

    const value: RuntimeChannelPolicy = policy ? { ...policy, source: 'database' } : FALLBACK
    cache = { value, expiresAt: now + CHANNEL_POLICY_CACHE_TTL_MS }
    return value
  } catch (error) {
    // Not cached, so recovery is immediate once the database is back — and never rethrown,
    // because this sits in front of every send.
    console.error('getChannelPolicy: gagal membaca ChannelPolicySetting, memakai default kode', { error })
    return FALLBACK
  }
}

/** The safety numbers alone, for the outbound guard. */
export async function getSafetyConfig() {
  return (await getChannelPolicy()).safetyConfig
}
