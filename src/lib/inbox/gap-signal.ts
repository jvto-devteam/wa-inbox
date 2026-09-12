import type { BotDecision } from '@/lib/bot/types'
import { extractRupiahAmounts, extractUrls } from '@/lib/bot/reply-verifier'

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

function hasVerifiedPriceOrUrl(decision: Extract<BotDecision, { mode: 'faq' }>): boolean {
  const verification = decision.verification
  if (!verification || verification.status === 'BLOCKED') return false
  if (verification.fabricatedPrices.length > 0 || verification.unknownUrls.length > 0) return false
  return extractRupiahAmounts(decision.draft).length > 0 || extractUrls(decision.draft).length > 0
}
