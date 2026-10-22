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
 * Jeda: paling cepat 30 dtk (`CHAT_REVIEW_DEBOUNCE_MS`, pembuka burst masuk satu review) dan minimal 5 menit sejak
 * `chatReviewAt` ATAU percobaan terakhir (`lastAttemptAt`, juga bila gagal) -- SATU timer (`unref`). Pesan berikutnya
 * selama percakapan ini menunggu tidak menambah timer. Pesan yang tiba SELAGI review berjalan menandai `dirty`; sesudah
 * selesai satu run lagi dijadwalkan (jeda 5 menit dari `chatReviewAt` baru), jadi sisa burst tidak hilang. Pesan AGEN
 * (`noteOutboundForChatReview`) ikut memicu supaya janji tim kepada lead tersemat; email (`EMAIL`) dilewati.
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
import { isAutomatedSource } from '@/lib/summary-items/automated'
import { broadcast } from '@/lib/realtime'
import { refreshChatReview } from './refresh'

export const CHAT_REVIEW_MIN_GAP_MS = 5 * 60_000
/** Jeda sebelum run "segera": pembuka burst ("Hi" / "I booked Ijen" / "ganti jemput jam 5") masuk satu review. */
export const CHAT_REVIEW_DEBOUNCE_MS = 30_000
/** Chat dibuka dan ada pesan sesudah ringkasan terakhir: tidak perlu menunggu burst, cukup jeda singkat. */
export const CHAT_REVIEW_OPEN_DEBOUNCE_MS = 2_000

/** Percakapan yang sedang menunggu (gerbang berjalan atau timer terpasang). */
const waiting = new Map<string, ReturnType<typeof setTimeout> | null>()
/** Percakapan yang review-nya sedang berjalan (LLM sampai 60 dtk). */
const running = new Set<string>()
/** Pesan masuk selagi review berjalan: sesudah selesai, jadwalkan satu run lagi (jeda 5 menit dari yang baru). */
const dirty = new Set<string>()
/** Percobaan terakhir per percakapan (berhasil atau gagal): LLM yang mati tidak dicoba ulang di setiap pesan. */
const lastAttemptAt = new Map<string, number>()

function logFailure(conversationId: string, error: unknown): void {
  console.error('[chat-review] auto-refresh gagal', {
    conversationId,
    error: error instanceof Error ? error.name : 'unknown',
  })
}

async function run(conversationId: string): Promise<void> {
  waiting.delete(conversationId)
  running.add(conversationId)
  lastAttemptAt.set(conversationId, Date.now())
  try {
    const result = await refreshChatReview(conversationId, new Date())
    if (result.status === 'ok') broadcast({ type: 'conversation.updated', conversationId })
    else if (result.status === 'failed') logFailure(conversationId, new Error('ringkasan kosong'))
  } catch (error) {
    logFailure(conversationId, error)
  } finally {
    running.delete(conversationId)
    // Sisa burst yang tiba selagi berjalan tidak boleh hilang.
    if (dirty.delete(conversationId)) scheduleChatReviewRefresh(conversationId)
  }
}

async function plan(conversationId: string, now: Date, debounceMs: number): Promise<void> {
  try {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { chatReviewAt: true, isTest: true, contact: { select: { phone: true } }, channelIdentity: { select: { platform: true } } },
    })
    if (!conv || conv.channelIdentity?.platform === 'EMAIL') {
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
    const last = Math.max(conv.chatReviewAt?.getTime() ?? 0, lastAttemptAt.get(conversationId) ?? 0)
    const wait = Math.max(last > 0 ? last + CHAT_REVIEW_MIN_GAP_MS - now.getTime() : 0, debounceMs)
    const timer = setTimeout(() => void run(conversationId), wait)
    if (typeof timer === 'object' && 'unref' in timer) timer.unref()
    waiting.set(conversationId, timer)
  } catch (error) {
    waiting.delete(conversationId)
    logFailure(conversationId, error)
  }
}

export function scheduleChatReviewRefresh(
  conversationId: string,
  now: Date = new Date(),
  debounceMs: number = CHAT_REVIEW_DEBOUNCE_MS
): void {
  try {
    if (running.has(conversationId)) {
      dirty.add(conversationId)
      return
    }
    if (waiting.has(conversationId)) return
    waiting.set(conversationId, null)
    void plan(conversationId, now, debounceMs)
  } catch (error) {
    waiting.delete(conversationId)
    logFailure(conversationId, error)
  }
}

/**
 * Tombol "Perbarui sekarang" baru saja meringkas: batalkan jadwal otomatis yang menunggu dan catat percobaan, supaya
 * tidak ada run otomatis tambahan dalam 5 menit. Run yang sedang berjalan dibiarkan.
 */
export function noteManualChatReviewRefresh(conversationId: string): void {
  const timer = waiting.get(conversationId)
  if (timer) clearTimeout(timer)
  waiting.delete(conversationId)
  dirty.delete(conversationId)
  lastAttemptAt.set(conversationId, Date.now())
}

/**
 * Titik panggil jalur masuk: satu pesan teks pelanggan baru saja tersimpan. Pesan non-teks (foto/stiker/placeholder
 * lampiran) dan penutup/reaksi dilewati. Tidak ditunggu, tidak pernah melempar.
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

/**
 * Pesan keluar dari AGEN sungguhan (bukan bot, bukan pesan otomatis) ikut memicu: janji tim kepada lead perlu
 * tersemat. Jeda dan gerbang sama dengan pesan masuk.
 */
export function noteOutboundForChatReview(
  conversationId: string,
  message: { sentBy: string; text: string; botTrace?: unknown }
): void {
  try {
    if (message.sentBy !== 'AGENT' || !message.text.trim()) return
    const trace = message.botTrace
    const source = trace && typeof trace === 'object' ? (trace as { source?: unknown }).source : undefined
    if (typeof source === 'string' && isAutomatedSource(source)) return
    scheduleChatReviewRefresh(conversationId)
  } catch (error) {
    logFailure(conversationId, error)
  }
}

/**
 * Owner 2026-10-22: chat dibuka -> bila ada pesan yang lebih baru dari ringkasan terakhir (atau belum pernah diringkas),
 * jadwalkan ringkasan baru. Gerbang dan jeda minimal 5 menit sama dengan pemicu pesan (`plan`), jadi membuka chat
 * berkali-kali tidak memanggil LLM berkali-kali; ringkasan yang sudah terbaru tidak disentuh. Tidak ditunggu, tidak
 * pernah melempar. Tab ringkasan memuat ulang sendiri lewat `conversation.updated` sesudah ringkasan selesai.
 */
export function noteChatOpenedForChatReview(conversationId: string): void {
  void (async () => {
    try {
      const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { chatReviewAt: true } })
      if (!conv) return
      const last = await prisma.message.findFirst({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      })
      if (!last) return
      if (conv.chatReviewAt && last.createdAt.getTime() <= conv.chatReviewAt.getTime()) return
      scheduleChatReviewRefresh(conversationId, new Date(), CHAT_REVIEW_OPEN_DEBOUNCE_MS)
    } catch (error) {
      logFailure(conversationId, error)
    }
  })()
}

// Test-only: membatalkan timer yang tertinggal antar kasus.
export function __resetChatReviewRefreshForTests(): void {
  for (const t of waiting.values()) if (t) clearTimeout(t)
  waiting.clear()
  running.clear()
  dirty.clear()
  lastAttemptAt.clear()
}
