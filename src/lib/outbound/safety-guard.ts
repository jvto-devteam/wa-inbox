/**
 * The last check before a message actually leaves the building.
 *
 * --- What this guard is allowed to block, and why the list is short ---
 *
 * Phase 6 introduces the guard into the live send path of every agent reply and every bot
 * reply. A guard that is too eager therefore does not "protect" anything — it silently stops
 * real customers from getting real answers, which is a far worse failure than the ones it is
 * meant to prevent. CLAUDE.md's "jangan ubah perilaku bot" applies here in full.
 *
 * So the blocking rules are deliberately confined to cases that are either (a) already true
 * upstream, so blocking changes nothing that was going to happen anyway, or (b) campaigns,
 * which do not exist as a feature yet and therefore cannot regress:
 *
 *   BLOCK  campaign -> opted-out contact          (guidebook §17 rule 1)
 *   BLOCK  campaign -> duplicate text in window   (rule 4, campaign half)
 *   BLOCK  campaign -> batch rate exceeded        (rule 3)
 *   BLOCK  bot reply -> conversation no longer bot-driven (rule 6)
 *   WARN   one-to-one -> opted-out contact        (§6.7 acceptance 3 says warn, not block)
 *   WARN   bot reply -> duplicate text in window  (rule 4, bot half — see below)
 *   WARN   provider failure rate elevated         (rule 5)
 *
 * Two rules are deliberately NOT implemented as blocks here:
 *
 *   Rule 2 (per-conversation bot auto-reply cap) already exists and already runs, in
 *   `checkAndRecordRateLimit` (src/lib/bot/rate-limiter.ts), called from `flushBurst` BEFORE
 *   the orchestrator spends any LLM time. Re-checking it here would double-count the same
 *   turn — the limiter records on read — and could block a reply the system already approved
 *   and paid for. One budget, one place that spends it.
 *
 *   Rule 4 for bot replies is a warning, not a block. A bot legitimately repeating a short
 *   answer ("Baik, saya cek dulu ya") within a minute is plausible; losing that reply is not
 *   worth preventing a duplicate. Campaigns get the block, because there the repeat is the
 *   pathology itself.
 */
import { prisma } from '@/lib/db'
import { getSafetyConfig } from '@/lib/bot-control/runtime-channel-policy'

export type OutboundPurpose = 'ONE_TO_ONE' | 'BOT_REPLY' | 'CAMPAIGN'

export type SafetyCheckParams = {
  conversationId: string
  contactId: string
  /**
   * The Message this send is FOR, when one already exists.
   *
   * The queued path writes its Message row before enqueueing (send.ts creates the bubble
   * first so a provider outage can never lose it), so by the time this guard runs, the very
   * message being checked is already sitting in the table with the text being checked
   * against. Without this exclusion the duplicate query matches that row and every first
   * Unofficial send reports itself as a repeat — a warning on every reply, and, once
   * campaigns exist, a campaign blocked by its own not-yet-sent message.
   */
  currentMessageId?: string
  messageText?: string
  sentBy: 'BOT' | 'AGENT'
  purpose: OutboundPurpose
}

export type SafetyCheckResult = {
  allowed: boolean
  warnings: string[]
  blockingReason?: string
}

/**
 * The code's own numbers. Since Phase H these are the DEFAULTS, not the values: a published
 * `ChannelPolicySetting.safetyConfig` overrides each of them, and this is what the guard uses
 * when no policy is published or the policy row cannot be read.
 *
 * They are still exported, and still the fallback, deliberately. A guard whose thresholds exist
 * only in a database row stops working the moment that row is unreadable — and "stops working"
 * here means the duplicate check and the campaign rate limit silently pass everything.
 */
export const DUPLICATE_WINDOW_MS = 60_000
export const CAMPAIGN_RATE_PER_MINUTE = 20
export const PROVIDER_FAILURE_THRESHOLD = 5
export const PROVIDER_FAILURE_WINDOW_MS = 5 * 60_000

/**
 * Reads the live thresholds, falling back to the constants above.
 *
 * Never throws: this is inside the send path, and a configuration read that could stop a
 * customer's message from going out would be a worse failure than running on the defaults.
 */
async function thresholds(): Promise<{
  duplicateWindowMs: number
  campaignRatePerMinute: number
  providerFailureThreshold: number
  providerFailureWindowMs: number
}> {
  try {
    const config = await getSafetyConfig()
    return {
      duplicateWindowMs: config.duplicateWindowMs,
      campaignRatePerMinute: config.campaignRatePerMinute,
      providerFailureThreshold: config.providerFailureThreshold,
      providerFailureWindowMs: config.providerFailureWindowMs,
    }
  } catch (error) {
    console.error('safety-guard: gagal membaca safetyConfig, memakai default kode', { error })
    return {
      duplicateWindowMs: DUPLICATE_WINDOW_MS,
      campaignRatePerMinute: CAMPAIGN_RATE_PER_MINUTE,
      providerFailureThreshold: PROVIDER_FAILURE_THRESHOLD,
      providerFailureWindowMs: PROVIDER_FAILURE_WINDOW_MS,
    }
  }
}

export async function checkOutboundSafety(params: SafetyCheckParams): Promise<SafetyCheckResult> {
  const warnings: string[] = []
  const limits = await thresholds()

  // Every check is wrapped: a guard that throws would take down the send it was supposed to
  // protect. On an internal failure it fails OPEN, with a warning, because the alternative —
  // failing closed — turns a database blip into a total outbound outage.
  try {
    const consent = await prisma.contactConsent.findUnique({ where: { contactId: params.contactId } })
    // A missing row means "never asked", which is how every existing contact looks. Treating
    // that as opt-out would block the entire contact book the moment this shipped.
    const optedOut = consent?.optOut === true || consent?.optIn === false

    if (optedOut) {
      if (params.purpose === 'CAMPAIGN') {
        return { allowed: false, warnings, blockingReason: 'Kontak ini menolak menerima campaign (opt-out).' }
      }
      warnings.push('Kontak ini menandai opt-out. Balasan 1:1 tetap diizinkan, tetapi jangan dipakai untuk promosi.')
    }

    if (params.purpose === 'BOT_REPLY') {
      const conversation = await prisma.conversation.findUnique({
        where: { id: params.conversationId },
        select: { botEnabled: true },
      })
      // Mirrors the re-read runBotForConversation already does after the orchestrator returns,
      // so this cannot block anything that was still going to be sent.
      if (conversation && !conversation.botEnabled) {
        return { allowed: false, warnings, blockingReason: 'Percakapan sudah diambil alih agent — bot tidak boleh mengirim.' }
      }
    }

    if (params.messageText) {
      const duplicate = await prisma.message.findFirst({
        where: {
          conversationId: params.conversationId,
          direction: 'OUTBOUND',
          content: params.messageText,
          createdAt: { gte: new Date(Date.now() - limits.duplicateWindowMs) },
          ...(params.currentMessageId ? { id: { not: params.currentMessageId } } : {}),
        },
        select: { id: true },
      })
      if (duplicate) {
        if (params.purpose === 'CAMPAIGN') {
          return { allowed: false, warnings, blockingReason: 'Pesan identik baru saja dikirim ke percakapan ini.' }
        }
        warnings.push('Pesan identik baru saja dikirim ke percakapan ini dalam satu menit terakhir.')
      }
    }

    if (params.purpose === 'CAMPAIGN') {
      const recentCampaignSends = await prisma.outboundJob.count({
        where: { createdAt: { gte: new Date(Date.now() - 60_000) } },
      })
      if (recentCampaignSends >= limits.campaignRatePerMinute) {
        return {
          allowed: false,
          warnings,
          blockingReason: `Batas ${limits.campaignRatePerMinute} pengiriman per menit tercapai — campaign dijeda sementara.`,
        }
      }

      const recentFailures = await prisma.outboundJob.count({
        where: { status: 'FAILED', updatedAt: { gte: new Date(Date.now() - limits.providerFailureWindowMs) } },
      })
      if (recentFailures >= limits.providerFailureThreshold) {
        return {
          allowed: false,
          warnings,
          blockingReason: `Provider sedang bermasalah (${recentFailures} pengiriman gagal baru-baru ini) — campaign dijeda.`,
        }
      }
    }
  } catch (error) {
    console.error('checkOutboundSafety gagal — dilewatkan dengan peringatan', { conversationId: params.conversationId, error })
    warnings.push('Pemeriksaan keamanan tidak bisa dijalankan; pengiriman diteruskan tanpa pemeriksaan.')
  }

  return { allowed: true, warnings }
}
