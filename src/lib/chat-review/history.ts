import { prisma } from '@/lib/db'
import { dailySummaryPayloadSchema, type ConversationReview } from '@/lib/daily-summary/payload-schema'

/** Riwayat per hari = review percakapan ini di `DailySummary` 30 hari terakhir (+1 hari cadangan). */
export const HISTORY_MAX_DAYS = 31

export type ChatReviewHistoryEntry = { date: string; review: ConversationReview }

/**
 * Satu percakapan bisa muncul di beberapa bagian payload (aktif, belum dibalas, diam, lead baru)
 * dengan review yang sama; yang diambil review non-null pertama. Baris yang payload-nya tidak lolos
 * skema dilewati, bukan menggagalkan seluruh riwayat.
 */
export async function chatReviewHistory(conversationId: string): Promise<ChatReviewHistoryEntry[]> {
  const rows = await prisma.dailySummary.findMany({
    orderBy: { date: 'desc' },
    take: HISTORY_MAX_DAYS,
    select: { date: true, payload: true },
  })
  const entries: ChatReviewHistoryEntry[] = []
  for (const row of rows) {
    const parsed = dailySummaryPayloadSchema.safeParse(row.payload)
    if (!parsed.success) continue
    const p = parsed.data
    const candidates = [p.conversations, p.unreplied, p.dormant, p.newLeads]
    let review: ConversationReview | null = null
    for (const list of candidates) {
      review = list.find((i) => i.conversationId === conversationId && i.review)?.review ?? null
      if (review) break
    }
    if (review) entries.push({ date: row.date, review })
  }
  return entries
}
