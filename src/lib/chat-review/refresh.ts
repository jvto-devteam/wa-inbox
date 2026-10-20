import { prisma } from '@/lib/db'
import { buildNumberedTranscript, lastRealMessage, markAutomated } from '@/lib/daily-summary/collect'
import { automatedMessageIds } from '@/lib/summary-items/automated'
import { TRANSCRIPT_MAX_MESSAGES } from '@/lib/daily-summary/config'
import { reviewConversation, type ReviewReason } from '@/lib/daily-summary/review'
import { applyReviewToItem } from '@/lib/summary-items/sync'
import { saveChatReview } from './store'

/**
 * Meringkas SATU percakapan lewat LLM, menyimpannya sebagai ringkasan terbaru, lalu menerapkannya
 * ke item "Janji tim". Satu-satunya tempat blok ini hidup: dipakai tombol "Perbarui sekarang"
 * (`POST /api/conversations/[id]/chat-review`) dan auto-refresh sesudah ekstraksi booking.
 *
 * `empty` = percakapan belum punya pesan; `failed` = LLM tidak memberi ringkasan yang sah (review
 * lama tidak disentuh). Galat tak terduga dilempar ke pemanggil, yang memutuskan cara
 * melaporkannya.
 */
export type RefreshChatReviewResult = { status: 'ok' } | { status: 'empty' } | { status: 'failed' }

export async function refreshChatReview(conversationId: string, asOf: Date): Promise<RefreshChatReviewResult> {
  const latest = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: TRANSCRIPT_MAX_MESSAGES,
    select: { id: true, direction: true, sentBy: true, type: true, content: true, createdAt: true },
  })
  if (latest.length === 0) return { status: 'empty' }
  // Kabar otomatis ("booking sudah diperbarui", permintaan data) berlabel sendiri di transkrip dan tidak menentukan
  // `reasons`: pertanyaan tamu yang hanya dijawab kabar otomatis tetap 'unreplied' (review Important A).
  const messages = markAutomated([...latest].reverse(), await automatedMessageIds([conversationId], latest[latest.length - 1].createdAt))
  const reasons: ReviewReason[] = lastRealMessage(messages)?.direction === 'INBOUND' ? ['unreplied'] : ['active']

  const settings = await prisma.settings.findUnique({ where: { id: 1 }, select: { ollamaModel: true } })
  const review = await reviewConversation(buildNumberedTranscript(messages), reasons, settings?.ollamaModel ?? undefined)
  if (!review) return { status: 'failed' }

  await saveChatReview(conversationId, review, asOf)
  // Janji tim yang kini sudah ditepati menutup item PROMISE-nya (PROMISE_KEPT). Tidak pernah melempar.
  await applyReviewToItem(conversationId, review, asOf)
  return { status: 'ok' }
}
