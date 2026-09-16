import type { BotDecision } from '@/lib/bot/types'
import { splitParagraphs } from '@/lib/bot/reply-attribution'
import { extractRupiahAmounts, extractUrls } from '@/lib/bot/reply-verifier'

export const UNSOURCED_REPLY_REASON = 'reply_unsourced'
export const DEFERRED_KNOWLEDGE_REPLY_REASON = 'reply_deferred_knowledge'

export type ReplyKnowledgeGapReason = typeof UNSOURCED_REPLY_REASON | typeof DEFERRED_KNOWLEDGE_REPLY_REASON
export type ReplyKnowledgeGap = {
  reason: ReplyKnowledgeGapReason
  missingQuestion: string | null
  answerSnippet: string | null
  answerParagraph: number | null
}

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
  return knowledgeGapForDecision(decision, null)?.reason === UNSOURCED_REPLY_REASON
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
  return knowledgeGapForDecision(decision, null)?.reason ?? null
}

/**
 * SEMUA gap pada satu balasan, bukan yang pertama saja.
 *
 * Dilaporkan 2026-09-14: satu balasan menunda DUA pertanyaan pelanggan dengan dua kalimat
 * "Let me check with our team" terpisah, dan hanya satu yang muncul di daftar perbaikan --
 * pencariannya berhenti di paragraf pertama yang cocok, jadi pertanyaan kedua tidak pernah
 * tercatat dan tidak pernah bisa diperbaiki. Satu paragraf yang ditunda adalah satu pertanyaan
 * pelanggan yang belum terjawab; dua di antaranya adalah dua pekerjaan terpisah bagi operator,
 * bukan satu.
 *
 * Jalur `unsourced` sengaja tetap satu baris: ia menandai balasan yang TIDAK bersandar pada
 * fakta apa pun, satu kondisi tentang giliran itu secara keseluruhan -- bukan daftar pertanyaan
 * yang tertunda satu per satu.
 */
export function knowledgeGapsForDecision(decision: BotDecision, inboundText: string | null): ReplyKnowledgeGap[] {
  if (decision.mode !== 'faq') return []

  const deferred = deferredParagraphs(decision.draft)
  if (deferred.length > 0) {
    return deferred
      .filter((paragraph) => !isGroundedPickupRouteDeferral(decision, paragraph))
      .map((paragraph) => ({
        reason: DEFERRED_KNOWLEDGE_REPLY_REASON,
        missingQuestion: closestCustomerQuestion(inboundText, paragraph.text),
        answerSnippet: paragraph.text,
        answerParagraph: paragraph.index,
      }))
  }

  const unsourced = unattributedParagraph(decision)
  if (!unsourced) return []
  return [
    {
      reason: UNSOURCED_REPLY_REASON,
      missingQuestion: closestCustomerQuestion(inboundText, unsourced.text),
      answerSnippet: unsourced.text,
      answerParagraph: unsourced.index,
    },
  ]
}

/** Gap pertama saja -- dipakai lonceng dan ikon gelembung, yang cuma perlu tahu ADA atau TIDAK. */
export function knowledgeGapForDecision(decision: BotDecision, inboundText: string | null): ReplyKnowledgeGap | null {
  return knowledgeGapsForDecision(decision, inboundText)[0] ?? null
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

const QUESTION_SPLIT = /[^?]+?\?/g
const BULLET_PREFIX = /^\s*(?:[-*•]|\d+[.)])\s+/
const WORDS = /[\p{L}\p{N}]+/gu
const STOPWORDS = new Set([
  'yang', 'untuk', 'dari', 'dengan', 'atau', 'dan', 'ada', 'apa', 'apakah', 'adakah', 'bisa',
  'bisakah', 'boleh', 'saya', 'kami', 'kita', 'anda', 'ini', 'itu', 'berapa', 'kapan', 'dimana',
  'mana', 'bagaimana', 'gimana', 'kenapa', 'mengapa', 'siapa', 'mohon', 'tolong', 'terima',
  'kasih', 'selamat', 'halo', 'hallo', 'sudah', 'belum', 'akan', 'juga', 'saja', 'kalau', 'jika',
  'tapi', 'tetapi', 'karena', 'tersebut', 'tentang', 'seperti', 'punya', 'ingin', 'pengen',
  'the', 'and', 'for', 'with', 'you', 'are', 'what', 'can', 'how', 'where', 'when', 'does',
  'have', 'this', 'that', 'there', 'would', 'could', 'should', 'please', 'thanks', 'hello',
  'about', 'from', 'your', 'much', 'many',
])

function deferredParagraphs(replyText: string): Array<{ index: number; text: string }> {
  return splitParagraphs(replyText)
    .map((text, index) => ({ index, text }))
    .filter(({ text }) => DEFERRED_KNOWLEDGE_PATTERNS.some((pattern) => pattern.test(text)))
}

const PICKUP_TIMING_TEXT = /\b(?:pickup|pick-up|arriv(?:e|al)|start|begin|timing)\b/i
const BROMO_FIRST_TEXT = /\b(?:bromo first|visiting bromo first|start(?:ing)? with bromo)\b/i
const IJEN_TEXT = /\bijen\b/i
const ROUTE_DURATION_TEXT = /\b3[.,]5\s*[–-]\s*4[.,]5\b|\b6\s*[–-]\s*8\b/i
const PICKUP_ROUTE_KNOWLEDGE_TEXT = /\bpickup after 12:00\b|\brecommend visiting bromo first\b|\bsurabaya to (?:the )?bromo\b/i

function isGroundedPickupRouteDeferral(
  decision: Extract<BotDecision, { mode: 'faq' }>,
  paragraph: { index: number; text: string }
): boolean {
  if (!PICKUP_TIMING_TEXT.test(paragraph.text)) return false
  if (!BROMO_FIRST_TEXT.test(paragraph.text) || !IJEN_TEXT.test(paragraph.text)) return false
  if (!ROUTE_DURATION_TEXT.test(paragraph.text)) return false

  const knowledge = decision.knowledge
  if (!knowledge) return false
  const attributed = knowledge.attributions?.some((attribution) => attribution.paragraph === paragraph.index) ?? false
  if (attributed) return true

  const groundedText = [
    ...knowledge.catalogLines,
    ...knowledge.managedLines.map((line) => line.line),
  ].join('\n')
  return PICKUP_ROUTE_KNOWLEDGE_TEXT.test(groundedText) && BROMO_FIRST_TEXT.test(groundedText) && ROUTE_DURATION_TEXT.test(groundedText)
}

function unattributedParagraph(decision: Extract<BotDecision, { mode: 'faq' }>): { index: number; text: string } | null {
  const knowledge = decision.knowledge
  if (!knowledge) return null
  if (knowledge.catalogLines.length + knowledge.managedLines.length === 0) return null
  const attributions = knowledge.attributions
  if (attributions === undefined) return null
  if (attributions.length === 0) {
    if (hasVerifiedPriceOrUrlInParagraph(decision, decision.draft)) return null
    return firstAnswerParagraph(decision.draft)
  }

  const attributed = new Set(attributions.map((a) => a.paragraph))
  for (const [index, text] of splitParagraphs(decision.draft).entries()) {
    if (attributed.has(index)) continue
    if (!isMeaningfulAnswer(text)) continue
    if (hasVerifiedPriceOrUrlInParagraph(decision, text)) continue
    return { index, text }
  }
  return null
}

function firstAnswerParagraph(replyText: string): { index: number; text: string } | null {
  const paragraphs = splitParagraphs(replyText)
  const index = paragraphs.findIndex((paragraph) => paragraph.trim().length > 0)
  return index === -1 ? null : { index, text: paragraphs[index] }
}

function isMeaningfulAnswer(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 12) return false
  if (/^(?:hi|hello|halo|hallo)[!.\s]*$/i.test(trimmed)) return false
  if (extractUrls(trimmed).length > 0 && contentWords(trimmed).size <= 2) return false
  return contentWords(trimmed).size > 0
}

function hasVerifiedPriceOrUrlInParagraph(decision: Extract<BotDecision, { mode: 'faq' }>, paragraph: string): boolean {
  const verification = decision.verification
  if (!verification || verification.status === 'BLOCKED') return false
  if (verification.fabricatedPrices.length > 0 || verification.unknownUrls.length > 0) return false
  return extractRupiahAmounts(paragraph).length > 0 || extractUrls(paragraph).length > 0
}

function splitCustomerQuestions(inboundText: string | null): string[] {
  const normalized = inboundText?.replace(/\s+/g, ' ').trim()
  if (!normalized) return []
  const questionMatches = normalized.match(QUESTION_SPLIT)?.map((q) => q.trim()).filter(Boolean) ?? []
  if (questionMatches.length > 0) return questionMatches
  const bullets = inboundText!
    .split('\n')
    .map((line) => line.replace(BULLET_PREFIX, '').trim())
    .filter((line) => line.length > 0)
  return bullets.length > 1 ? bullets : [normalized]
}

function closestCustomerQuestion(inboundText: string | null, answerSnippet: string): string | null {
  const questions = splitCustomerQuestions(inboundText)
  if (questions.length === 0) return inboundText?.trim() || null
  if (questions.length === 1) return questions[0]

  const answerWords = contentWords(answerSnippet)
  let best = questions[0]
  let bestScore = -1
  for (const question of questions) {
    let score = 0
    for (const word of contentWords(question)) {
      if (answerWords.has(word)) score += 1
    }
    if (score > bestScore) {
      best = question
      bestScore = score
    }
  }
  return bestScore > 0 ? best : inboundText?.trim() || best
}

function contentWords(text: string): Set<string> {
  const words = text.toLowerCase().match(WORDS) ?? []
  return new Set(words.filter((word) => word.length >= 4 && !STOPWORDS.has(word)))
}
