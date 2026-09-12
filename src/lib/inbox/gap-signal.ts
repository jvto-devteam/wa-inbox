import type { BotDecision } from '@/lib/bot/types'
import { extractRupiahAmounts, extractUrls } from '@/lib/bot/reply-verifier'

export const UNSOURCED_REPLY_REASON = 'reply_unsourced'
export const DEFERRED_KNOWLEDGE_REPLY_REASON = 'reply_deferred_knowledge'

export type ReplyKnowledgeGapReason = typeof UNSOURCED_REPLY_REASON | typeof DEFERRED_KNOWLEDGE_REPLY_REASON

/**
 * Apakah balasan ini menjawab TANPA bersandar pada satu pun fakta yang dikirim ke model.
 *
 * Dihitung dari `attributions` (reply-attribution.ts), yang sudah ditempel di titik tempel
 * tunggal orchestrator. Murni dan tanpa I/O supaya bisa dipakai penulis gap maupun test tanpa
 * menyeret prisma.
 *
 * Empat hal yang sengaja BUKAN gap:
 *   - mode selain `faq` -- klarifikasi dan salam memang tidak butuh fakta, dan Mode 3 menjawab
 *     dari data booking pelanggan;
 *   - keputusan tanpa `knowledge` (tidak ada tahap perakitan fakta yang berjalan);
 *   - giliran dengan NOL fakta -- itu sudah dicatat `no_facts_resolved` oleh jalur lama, dan
 *     menulisnya lagi berarti dua baris untuk satu giliran;
 *   - `attributions` yang absen -- artinya pemetaan tidak pernah dihitung (balasan lama),
 *     bukan artinya tidak bersumber.
 */
export function isUnsourcedFaqReply(decision: BotDecision): boolean {
  if (decision.mode !== 'faq') return false

  const knowledge = decision.knowledge
  if (!knowledge) return false
  if (knowledge.catalogLines.length + knowledge.managedLines.length === 0) return false

  const attributions = knowledge.attributions
  if (attributions === undefined) return false
  if (hasVerifiedPriceOrUrl(decision)) return false
  return attributions.length === 0
}

/**
 * Apakah balasan FAQ menunda sebagian pertanyaan customer karena data/knowledge belum cukup.
 *
 * Ini bukan "unsourced": balasan bisa punya paragraf lain yang benar-benar bersumber. Yang
 * dicari di sini adalah kalimat customer-facing seperti "let me check with our team" /
 * "get back to you shortly" yang berarti operator perlu mengisi knowledge atau aturan katalog
 * supaya pertanyaan serupa tidak selalu ditunda.
 */
export function isDeferredKnowledgeFaqReply(decision: BotDecision): boolean {
  if (decision.mode !== 'faq') return false
  if (!decision.knowledge) return false
  return DEFERRED_KNOWLEDGE_PATTERNS.some((pattern) => pattern.test(decision.draft))
}

export function knowledgeGapReasonForDecision(decision: BotDecision): ReplyKnowledgeGapReason | null {
  if (isDeferredKnowledgeFaqReply(decision)) return DEFERRED_KNOWLEDGE_REPLY_REASON
  if (isUnsourcedFaqReply(decision)) return UNSOURCED_REPLY_REASON
  return null
}

function hasVerifiedPriceOrUrl(decision: Extract<BotDecision, { mode: 'faq' }>): boolean {
  const verification = decision.verification
  if (!verification || verification.status === 'BLOCKED') return false
  if (verification.fabricatedPrices.length > 0 || verification.unknownUrls.length > 0) return false
  return extractRupiahAmounts(decision.draft).length > 0 || extractUrls(decision.draft).length > 0
}

const DEFERRED_KNOWLEDGE_PATTERNS = [
  /\blet me check with (?:our|the) team\b/i,
  /\bwe(?:'|’)ll check with (?:our|the) team\b/i,
  /\bi(?:'|’)ll check\b.{0,80}\b(?:for you shortly|get back to you shortly)\b/i,
  /\bget back to you shortly\b/i,
  /\bconfirm (?:this|that|it) with (?:our|the) team\b/i,
  /\bperlu kami cek\b/i,
  /\bakan kami cek\b/i,
]
