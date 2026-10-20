import { prisma } from '@/lib/db'
import { automatedMessageIds } from '@/lib/summary-items/automated'
import { dailySummaryPayloadSchema, type ConversationReview } from '@/lib/daily-summary/payload-schema'
import { jakartaDayRange } from '@/lib/daily-summary/time'

/** Riwayat per hari = review percakapan ini di `DailySummary` 30 hari terakhir (+1 hari cadangan). */
export const HISTORY_MAX_DAYS = 31

/**
 * `respondedAt` dkk. hanya terisi untuk entri `perlu_tindakan`/`tidak_jelas` yang SESUDAH hari itu
 * ada pesan OUTBOUND pertama (bot atau tim). Itu penanda "sudah ada balasan", bukan bukti semua
 * pertanyaan terjawab. null untuk entri `selesai` dan entri yang belum ditanggapi.
 */
export type ChatReviewHistoryEntry = {
  date: string
  review: ConversationReview
  respondedAt: string | null
  respondedMessageId: string | null
  respondedBy: 'AGENT' | 'BOT' | null
}

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
  const noResponse = { respondedAt: null, respondedMessageId: null, respondedBy: null } as const
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
    if (review) entries.push({ date: row.date, review, ...noResponse })
  }
  return withResponses(conversationId, entries)
}

/**
 * Tanggapan pertama = pesan OUTBOUND pertama dengan `createdAt >= akhir hari WIB` entri itu.
 * SATU kueri untuk seluruh riwayat (semua pesan keluar sesudah akhir hari entri tertua yang perlu),
 * lalu tiap entri dicari di memori. Tanpa entri yang perlu dicek, tidak ada kueri sama sekali.
 */
async function withResponses(conversationId: string, entries: ChatReviewHistoryEntry[]): Promise<ChatReviewHistoryEntry[]> {
  const ends = new Map<string, number>()
  for (const e of entries) {
    if (e.review.status !== 'selesai') ends.set(e.date, jakartaDayRange(e.date).end.getTime())
  }
  if (ends.size === 0) return entries
  const oldestEnd = new Date(Math.min(...ends.values()))
  const outbound = await prisma.message.findMany({
    // FAILED = tidak pernah sampai ke pelanggan, jadi bukan tanggapan.
    where: { conversationId, direction: 'OUTBOUND', deliveryStatus: { not: 'FAILED' }, createdAt: { gte: oldestEnd } },
    orderBy: { createdAt: 'asc' },
    // Urutan menaik dan jendela riwayat 31 hari membatasi kebutuhan; 500 menjaga kueri tetap ringan.
    take: 500,
    select: { id: true, createdAt: true, sentBy: true },
  })
  // Kabar otomatis (booking diperbarui / permintaan data) bukan tanggapan atas hari itu (review Important A).
  const automated = await automatedMessageIds([conversationId], oldestEnd)
  return entries.map((e) => {
    const end = ends.get(e.date)
    if (end === undefined) return e
    // Balasan manusia diutamakan; bot hanya bila tak ada balasan tim sesudah akhir hari itu.
    let agent: (typeof outbound)[number] | null = null
    let bot: (typeof outbound)[number] | null = null
    for (const m of outbound) {
      if (m.createdAt.getTime() < end || automated.has(m.id)) continue
      switch (m.sentBy) {
        case 'AGENT':
          agent = m
          break
        case 'BOT':
          bot ??= m
          break
        default:
          break
      }
      if (agent) break
    }
    const picked = agent ?? bot
    if (!picked) return e
    return {
      ...e,
      respondedAt: picked.createdAt.toISOString(),
      respondedMessageId: picked.id,
      respondedBy: agent ? 'AGENT' : 'BOT',
    }
  })
}
