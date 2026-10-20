/**
 * Menjaga tab "Ringkasan chat" di Inbox tetap terbaru tanpa menunggu operator menekan
 * "Perbarui sekarang". Dipanggil dari jalur masuk pesan pelanggan (`noteInboundForChatReview`: WhatsApp
 * `inbound.ts`, Messenger/Instagram `inbound-messenger.ts`, pesan uji) untuk SEMUA percakapan -- termasuk lead
 * yang belum punya booking -- dan tidak bergantung pada gerbang rollout aksi booking: ia hanya menulis catatan
 * internal, tidak pernah mengirim pesan ke siapa pun. Email (Gmail) sengaja tidak memicunya: benang email
 * tidak punya panel ringkasan yang dipantau dan bot tidak menjawab email; job 00.00 dan tombol manual tetap jalan.
 * `runExtraction` TIDAK memanggilnya lagi (jalur masuk sudah menjadwalkan; dua pemanggil = review ganda).
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
 * Gerbang nomor Indonesia sama dengan daily summary (`collect.ts` `excludeIndonesian`): nomor 62 dilewati HANYA
 * bila `Settings.skipBotForIndonesianNumbers` menyala; percakapan `isTest` atau nomor `BOOKING_ACTIONS_TEST_PHONES`
 * selalu lolos. Gerbang dinilai di sini karena butuh `isTest` dan setelan dari DB.
 * Pesan penutup/reaksi ("ok", "thanks", 👍; `isNoiseMessage`) tidak memicu.
 */
import { prisma } from '@/lib/db'
import { isBookingTestConversation } from '@/lib/booking-actions/rollout'
import { isIndonesianNumber } from '@/lib/phone'
import { isNoiseMessage } from '@/lib/summary-items/noise'
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
    if (!conv) {
      waiting.delete(conversationId)
      return
    }
    const phone = conv.contact?.phone ?? null
    if (isIndonesianNumber(phone) && !isBookingTestConversation({ isTest: conv.isTest, phone })) {
      const settings = await prisma.settings.findUnique({ where: { id: 1 }, select: { skipBotForIndonesianNumbers: true } })
      if (settings?.skipBotForIndonesianNumbers ?? false) {
        waiting.delete(conversationId)
        return
      }
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

/**
 * Titik panggil jalur masuk: satu pesan teks pelanggan baru saja tersimpan. Pesan non-teks dan penutup/reaksi
 * dilewati. Tidak ditunggu, tidak pernah melempar.
 */
export function noteInboundForChatReview(conversationId: string, message: { type: string; content: string | null }): void {
  try {
    if (message.type !== 'text' || !message.content?.trim()) return
    if (isNoiseMessage({ type: message.type, content: message.content })) return
    scheduleChatReviewRefresh(conversationId)
  } catch (error) {
    logFailure(conversationId, error)
  }
}

// Test-only: membatalkan timer yang tertinggal antar kasus.
export function __resetChatReviewRefreshForTests(): void {
  for (const t of waiting.values()) if (t) clearTimeout(t)
  waiting.clear()
}
