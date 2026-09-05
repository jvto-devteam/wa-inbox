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

export type OutboundPurpose = 'ONE_TO_ONE' | 'BOT_REPLY' | 'CAMPAIGN'

export type SafetyCheckParams = {
  conversationId: string
  contactId: string
  messageText?: string
  sentBy: 'BOT' | 'AGENT'
  purpose: OutboundPurpose
}

export type SafetyCheckResult = {
  allowed: boolean
  warnings: string[]
  blockingReason?: string
}

/** How far back an identical message counts as a duplicate. */
export const DUPLICATE_WINDOW_MS = 60_000

/** Campaign sends allowed per rolling minute, across the whole account. */
export const CAMPAIGN_RATE_PER_MINUTE = 20

/** Failed jobs in the recent window past which campaigns are paused. */
export const PROVIDER_FAILURE_THRESHOLD = 5
export const PROVIDER_FAILURE_WINDOW_MS = 5 * 60_000

export async function checkOutboundSafety(params: SafetyCheckParams): Promise<SafetyCheckResult> {
  const warnings: string[] = []

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
          createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
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
      if (recentCampaignSends >= CAMPAIGN_RATE_PER_MINUTE) {
        return {
          allowed: false,
          warnings,
          blockingReason: `Batas ${CAMPAIGN_RATE_PER_MINUTE} pengiriman per menit tercapai — campaign dijeda sementara.`,
        }
      }

      const recentFailures = await prisma.outboundJob.count({
        where: { status: 'FAILED', updatedAt: { gte: new Date(Date.now() - PROVIDER_FAILURE_WINDOW_MS) } },
      })
      if (recentFailures >= PROVIDER_FAILURE_THRESHOLD) {
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
