/**
 * Ringkasan harian versi "baca mesin" untuk GET /api/v1/summaries.
 *
 * Pemakainya agen Operator second brain JVTO: ia butuh POLA (pertanyaan yang sering muncul,
 * komplain, alasan tidak jadi booking, janji tim yang belum ditepati), bukan identitas tamu.
 * Jadi digest ini sengaja membuang semua yang menunjuk ke orang:
 *
 * - tidak ada `contactName`, `snippet`, `inboundText`, `messageText`, atau `messageId`;
 * - teks bebas tulisan LLM (poin penting, pertanyaan, janji, alasan, langkah berikut) disaring
 *   lewat `redactText`: nama kontak percakapan itu, nomor telepon, dan email diganti penanda.
 *
 * Yang tetap ikut: `conversationId` (id internal, bukan data pribadi; perlu untuk menghitung
 * percakapan yang sama lintas hari) dan kode booking backoffice (bukan data pribadi; perlu untuk
 * mengaitkan insight ke booking).
 */
import {
  dailySummaryPayloadSchema,
  normalizePoint,
  normalizePromise,
  normalizeQuestion,
  type ConversationReview,
  type DailySummaryPayload,
} from '@/lib/daily-summary/payload-schema'

/**
 * Kandidat nomor telepon: deretan angka dengan pemisah. Kandidat baru dianggap telepon oleh
 * `looksLikePhone` -- tanpa saringan itu nominal ("Rp 1.500.000", "IDR 2,040,000") dan tanggal
 * ("2026-11-04") ikut tersensor dan insight pembayaran kehilangan angkanya (ditemukan di produksi
 * 2026-11-05: 15 nominal jadi "[nomor]").
 */
const PHONE_CANDIDATE_RE = /\+?\d[\d\s().-]{6,}\d/g
const CURRENCY_BEFORE_RE = /(?:rp|idr|usd|us\$|\$|€|eur|myr|rm|sgd|s\$)\s*\.?\s*$/i
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const NAME_MARK = '[tamu]'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Kata dari nama kontak yang cukup panjang untuk disaring sebagai nama (>= 3 huruf).
 * Nama lengkap disaring lebih dulu supaya "Anna Maria" tidak tersisa sebagai "[tamu] Maria".
 */
function nameNeedles(contactName: string | null | undefined): string[] {
  const full = contactName?.trim()
  if (!full) return []
  const parts = full.split(/\s+/).filter((p) => p.replace(/[^\p{L}]/gu, '').length >= 3)
  return [full, ...parts].sort((a, b) => b.length - a.length)
}

/**
 * Telepon = 10-15 digit, diawali "+", "0", atau "62", dan tidak didahului simbol mata uang.
 * Nominal ribuan berpemisah titik/koma ("1.500.000") tidak pernah lolos karena tidak diawali 0/62/+,
 * kecuali angkanya memang berbentuk nomor Indonesia.
 */
function looksLikePhone(match: string, before: string): boolean {
  if (CURRENCY_BEFORE_RE.test(before)) return false
  const digits = match.replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 15) return false
  return match.startsWith('+') || digits.startsWith('0') || digits.startsWith('62')
}

function redactPhones(text: string): string {
  return text.replace(PHONE_CANDIDATE_RE, (match: string, offset: number) =>
    looksLikePhone(match, text.slice(Math.max(0, offset - 6), offset)) ? '[nomor]' : match
  )
}

export function redactText(text: string, contactName?: string | null): string {
  let out = redactPhones(text.replace(EMAIL_RE, '[email]'))
  for (const needle of nameNeedles(contactName)) {
    out = out.replace(new RegExp(`(?<![\\p{L}])${escapeRegExp(needle)}(?![\\p{L}])`, 'giu'), NAME_MARK)
  }
  return out
}

export type DigestReview = {
  status: ConversationReview['status']
  jenisKontak: ConversationReview['jenisKontak']
  topik: string
  alasan: string
  profil: string[]
  poinPenting: { jenis: string | null; teks: string }[]
  pertanyaan: { teks: string; terjawab: boolean | null }[]
  janjiTim: { teks: string; terpenuhi: boolean | null }[]
  langkahBerikut: string
}

export function digestReview(review: ConversationReview | null, contactName: string | null): DigestReview | null {
  if (!review) return null
  const r = (t: string) => redactText(t, contactName)
  return {
    status: review.status,
    jenisKontak: review.jenisKontak,
    topik: r(review.topik),
    alasan: r(review.alasan),
    profil: review.profil.map((p) => p.label),
    poinPenting: review.poinPenting.map(normalizePoint).map((p) => ({ jenis: p.jenis, teks: r(p.teks) })),
    pertanyaan: review.pertanyaan.map(normalizeQuestion).map((q) => ({ teks: r(q.teks), terjawab: q.terjawab })),
    janjiTim: review.janjiTim.map(normalizePromise).map((p) => ({ teks: r(p.teks), terpenuhi: p.terpenuhi })),
    langkahBerikut: r(review.langkahBerikut),
  }
}

export type SummaryDigest = {
  date: string
  status: string
  generatedAt: string
  excludedIndonesian: boolean | null
  counts: DailySummaryPayload['counts']
  filteredOut: { unreplied: number; dormant: number }
  conversations: {
    conversationId: string
    bookingRef: string | null
    pipelineStage: string
    inbound: number
    outbound: number
    review: DigestReview | null
  }[]
  unreplied: { conversationId: string; pipelineStage: string; waitingMinutes: number }[]
  dormant: { conversationId: string; pipelineStage: string; silentHours: number }[]
  newLeads: {
    conversationId: string
    pipelineStage: string
    tripBrief: DailySummaryPayload['newLeads'][number]['tripBrief']
  }[]
  handoffs: { count: number; stillWaiting: number }
  gaps: { newCount: number; openTotal: number; byReason: { key: string; count: number }[]; byTopic: { key: string; count: number }[] }
}

/**
 * `bookingRefs`: conversationId -> kode booking backoffice (atau tidak ada). Payload lama yang
 * bentuknya tidak lolos skema mengembalikan null; route menjawabnya sebagai "tidak tersedia",
 * bukan menebak isinya.
 */
export function buildSummaryDigest(
  row: { date: string; status: string; payload: unknown },
  bookingRefs: ReadonlyMap<string, string>
): SummaryDigest | null {
  const parsed = dailySummaryPayloadSchema.safeParse(row.payload)
  if (!parsed.success) return null
  const p = parsed.data
  const ref = (id: string) => bookingRefs.get(id) ?? null

  return {
    date: row.date,
    status: row.status,
    generatedAt: p.generatedAt,
    excludedIndonesian: p.excludedIndonesian ?? null,
    counts: p.counts,
    filteredOut: { unreplied: p.filteredOut.unreplied, dormant: p.filteredOut.dormant },
    conversations: p.conversations.map((c) => ({
      conversationId: c.conversationId,
      bookingRef: ref(c.conversationId),
      pipelineStage: c.pipelineStage,
      inbound: c.inbound,
      outbound: c.outbound,
      review: digestReview(c.review, c.contactName),
    })),
    unreplied: p.unreplied.map((u) => ({
      conversationId: u.conversationId,
      pipelineStage: u.pipelineStage,
      waitingMinutes: Math.round(u.waitingMs / 60_000),
    })),
    dormant: p.dormant.map((d) => ({
      conversationId: d.conversationId,
      pipelineStage: d.pipelineStage,
      silentHours: Math.round(d.silentMs / 3_600_000),
    })),
    newLeads: p.newLeads.map((n) => ({
      conversationId: n.conversationId,
      pipelineStage: n.pipelineStage,
      tripBrief: n.tripBrief,
    })),
    handoffs: { count: p.handoffs.length, stillWaiting: p.handoffs.filter((h) => h.stillWaiting).length },
    gaps: { newCount: p.gaps.newCount, openTotal: p.gaps.openTotal, byReason: p.gaps.byReason, byTopic: p.gaps.byTopic },
  }
}
