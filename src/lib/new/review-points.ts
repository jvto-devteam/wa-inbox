// Riwayat Agent /new: jumlah poin penting SEBELUM sebuah pembaruan ringkasan chat.
// Conversation.chatReview selalu ditimpa, jadi pembanding satu-satunya adalah ringkasan harian
// (DailySummary.payload) — aturan pilih review sama dengan chatReviewHistory (src/lib/chat-review/history.ts).
import { dailySummaryPayloadSchema } from '@/lib/daily-summary/payload-schema'

export interface SummaryRow { date: string; payload: unknown }
export interface DayCounts { date: string; counts: Map<string, number> }

/** Jumlah poin per percakapan per tanggal; baris yang payload-nya tidak lolos skema dilewati. Urutan baris dipertahankan. */
export function indexPointCounts(rows: SummaryRow[]): DayCounts[] {
  const out: DayCounts[] = []
  for (const row of rows) {
    const parsed = dailySummaryPayloadSchema.safeParse(row.payload)
    if (!parsed.success) continue
    const p = parsed.data
    const counts = new Map<string, number>()
    // Satu percakapan bisa muncul di beberapa bagian; yang dipakai review non-null pertama.
    for (const list of [p.conversations, p.unreplied, p.dormant, p.newLeads]) {
      for (const it of list) {
        if (it.review && !counts.has(it.conversationId)) counts.set(it.conversationId, it.review.poinPenting.length)
      }
    }
    out.push({ date: row.date, counts })
  }
  return out
}

/** Poin di ringkasan harian terakhir percakapan ini dengan tanggal < `beforeDay`; null = belum pernah diringkas. */
export function previousPointCount(index: DayCounts[], conversationId: string, beforeDay: string): number | null {
  let best: DayCounts | null = null
  for (const d of index) {
    if (d.date < beforeDay && d.counts.has(conversationId) && (!best || d.date > best.date)) best = d
  }
  return best ? best.counts.get(conversationId)! : null
}
