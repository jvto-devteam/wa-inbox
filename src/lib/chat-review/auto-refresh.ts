/**
 * Menjaga tab "Ringkasan chat" di Inbox tetap terbaru tanpa menunggu operator menekan
 * "Perbarui sekarang". Dipanggil `schedule.ts` sesudah ekstraksi booking selesai.
 *
 * TIDAK PERNAH MELEMPAR dan tidak boleh memperlambat apa pun: `scheduleChatReviewRefresh` hanya
 * mencatat bahwa percakapan ini sedang menunggu lalu kembali; kueri, LLM, dan penyimpanan
 * terjadi di belakang (`void`). Kegagalan hanya di-log (nama galat, tanpa isi chat); review lama
 * tetap karena `saveChatReview` tidak menimpa yang lebih baru dan tidak dipanggil bila LLM gagal.
 *
 * Jeda minimal 5 menit sejak `chatReviewAt` terakhir:
 *   - sudah lewat -> jalan sekarang;
 *   - belum -> SATU timer (`unref`) di akhir jeda. Pesan berikutnya selama percakapan ini
 *     tercatat menunggu tidak menambah timer, jadi satu burst = satu review.
 *
 * Gerbang nomor Indonesia sama dengan ekstraksi booking (Ruling R13): nomor 62 dilewati, kecuali
 * percakapan `isTest`. Gerbang dinilai di sini karena butuh `isTest` dari DB.
 */
import { prisma } from '@/lib/db'
import { isIndonesianNumber } from '@/lib/phone'
import { broadcast } from '@/lib/realtime'
import { refreshChatReview } from './refresh'

export const CHAT_REVIEW_MIN_GAP_MS = 5 * 60_000

/** Percakapan yang sedang menunggu (gerbang berjalan atau timer jeda terpasang). */
const waiting = new Map<string, ReturnType<typeof setTimeout> | null>()

function logFailure(conversationId: string, error: unknown): void {
  console.error('[chat-review] auto-refresh gagal', {
    conversationId,
    error: error instanceof Error ? error.name : 'unknown',
  })
}

async function run(conversationId: string): Promise<void> {
  try {
    const result = await refreshChatReview(conversationId, new Date())
    if (result.status === 'ok') broadcast({ type: 'conversation.updated', conversationId })
    else if (result.status === 'failed') logFailure(conversationId, new Error('ringkasan kosong'))
  } catch (error) {
    logFailure(conversationId, error)
  } finally {
    waiting.delete(conversationId)
  }
}

async function plan(conversationId: string, now: Date): Promise<void> {
  try {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { chatReviewAt: true, isTest: true, contact: { select: { phone: true } } },
    })
    if (!conv || (!conv.isTest && isIndonesianNumber(conv.contact?.phone ?? null))) {
      waiting.delete(conversationId)
      return
    }
    const wait = conv.chatReviewAt ? conv.chatReviewAt.getTime() + CHAT_REVIEW_MIN_GAP_MS - now.getTime() : 0
    if (wait <= 0) {
      await run(conversationId)
      return
    }
    const timer = setTimeout(() => void run(conversationId), wait)
    if (typeof timer === 'object' && 'unref' in timer) timer.unref()
    waiting.set(conversationId, timer)
  } catch (error) {
    waiting.delete(conversationId)
    logFailure(conversationId, error)
  }
}

export function scheduleChatReviewRefresh(conversationId: string, now: Date = new Date()): void {
  try {
    if (waiting.has(conversationId)) return
    waiting.set(conversationId, null)
    void plan(conversationId, now)
  } catch (error) {
    waiting.delete(conversationId)
    logFailure(conversationId, error)
  }
}

// Test-only: membatalkan timer yang tertinggal antar kasus.
export function __resetChatReviewRefreshForTests(): void {
  for (const t of waiting.values()) if (t) clearTimeout(t)
  waiting.clear()
}
