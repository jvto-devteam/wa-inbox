/**
 * Tanda terima ke TAMU segera sesudah permintaannya menjadi kartu (owner 2026-10-20): "Noted, permintaan Anda sudah
 * kami terima dan sedang kami proses." Dikirim SEBELUM terapkan-otomatis; kabar "sudah diperbarui" (guest-notice.ts)
 * tetap menyusul sebagai pesan kedua -- keduanya memang diminta, jadi tidak ada penahan jeda di antaranya.
 *
 * Dipanggil `runExtraction` tepat sesudah `applyExtraction`. Memicu hanya bila ekstraksi itu melahirkan kartu CHANGE/TASK (id dari `applyExtraction().cardIds`, termasuk kartu isian yang lahir di `evaluate` DI DALAM applyExtraction; kartu `reevaluate` tick tidak)
 * dari pesan TAMU (bukan MISMATCH, bukan DATA_REQUEST, bukan kartu isian lahir di reevaluate). SATU pesan per run
 * walau kartunya banyak. Teks dibuat di kode (tanpa LLM, tanpa nama tamu); Inggris bawaan, Indonesia bila
 * `isIndonesianGuest`. Terkirim juga saat bot mati (admin yang menangani chat) -- tidak membaca `botEnabled`.
 *
 * Gerbang (condong ke "jangan kirim"): WhatsApp bernomor; `bookingAutomationAllowed`; jendela 24 jam terbuka (tertutup
 * = diam, tanpa push; tamu baru saja menulis, jadi lazimnya terbuka). Idempotensi: event GUEST_ACK_SENT di setiap
 * kartu yang disebut DITULIS SEBELUM kirim (klaim di bawah kunci advisory; run tumpang tindih tidak kirim ganda, kirim gagal tidak diulang) + paling banyak satu tanda terima per
 * percakapan per 2 menit (burst). Gagal kirim = log nama galat saja, tanpa push (jalur kabar-perubahan sudah
 * membunyikan alarm bila gagal). Pesan ini OUTBOUND bertanda `botTrace.source = booking_request_ack` (otomatis:
 * bukan "balasan kita", `summary-items/automated.ts`) dan tidak pernah jadi sumber usulan (ekstraksi hanya INBOUND).
 */
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { sendMessage } from '@/lib/send'
import type { BookingData } from '@/lib/booking/client'
import { BOOKING_REQUEST_ACK_SOURCE } from '@/lib/summary-items/automated'
import { dataRequestWindowClosed, isIndonesianGuest } from './data-requests'
import { recordEvent } from './history'
import { bookingAutomationAllowed } from './rollout'

export const GUEST_ACK_MIN_GAP_MS = 2 * 60_000

export const GUEST_ACK_TEXT = {
  en: "Noted, we've received your request and are processing it now.",
  id: 'Noted, permintaan Anda sudah kami terima dan sedang kami proses.',
} as const

export function guestAckText(booking: BookingData): string {
  return isIndonesianGuest(booking) ? GUEST_ACK_TEXT.id : GUEST_ACK_TEXT.en
}

export async function notifyGuestRequestReceived(input: {
  conversationId: string
  bookingId: string | null
  booking: BookingData
  /** Id kartu CHANGE/TASK yang DIBUAT run ekstraksi ini (`applyExtraction().cardIds`), bukan jendela waktu. */
  cardIds: readonly string[]
  now?: Date
}): Promise<void> {
  const { conversationId } = input
  const now = input.now ?? new Date()
  try {
    if (input.cardIds.length === 0) return
    const cards =
      (await prisma.bookingAction.findMany({
        where: { id: { in: [...input.cardIds] }, conversationId, type: { in: ['CHANGE', 'TASK'] }, sourceMessageId: { not: null } },
        select: { id: true, sourceMessageId: true },
      })) ?? []
    if (cards.length === 0) return

    const sourceIds = [...new Set(cards.flatMap((c) => (c.sourceMessageId ? [c.sourceMessageId] : [])))]
    const sources = (await prisma.message.findMany({ where: { id: { in: sourceIds }, conversationId }, select: { id: true, direction: true } })) ?? []
    const inbound = new Set(sources.filter((m) => m.direction === 'INBOUND').map((m) => m.id))
    const guestCards = cards.filter((c) => c.sourceMessageId !== null && inbound.has(c.sourceMessageId))
    if (guestCards.length === 0) return

    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { isTest: true, contact: { select: { phone: true } }, channelIdentity: { select: { platform: true } } },
    })
    if (!conv || (conv.channelIdentity?.platform ?? 'WHATSAPP') !== 'WHATSAPP' || !conv.contact?.phone) return
    if (!bookingAutomationAllowed({ isTest: conv.isTest, phone: conv.contact.phone })) return

    const ids = guestCards.map((c) => c.id)
    // Jendela tertutup = diam (tanpa klaim, tanpa push).
    if (await dataRequestWindowClosed(conversationId, now)) return

    // KLAIM sebelum kirim, satu langkah bersyarat di bawah kunci per percakapan: run yang tumpang tindih melihat event ini
    // dan berhenti. Kirim yang gagal sesudahnya TIDAK dikirim ulang (hanya di-log).
    const claimed = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`guest_ack:${conversationId}`}))`
      const acked = await tx.bookingActionEvent.findFirst({ where: { actionId: { in: ids }, event: 'GUEST_ACK_SENT' }, select: { id: true } })
      if (acked) return false
      const recent = await tx.bookingActionEvent.findFirst({
        where: { conversationId, event: 'GUEST_ACK_SENT', createdAt: { gte: new Date(now.getTime() - GUEST_ACK_MIN_GAP_MS) } },
        select: { id: true },
      })
      if (recent) return false
      for (const id of ids) {
        await recordEvent(tx, {
          conversationId, bookingId: input.bookingId, actionId: id, event: 'GUEST_ACK_SENT', actor: 'SYSTEM', newValue: { batch: ids },
        })
      }
      return true
    })
    if (!claimed) return

    try {
      const sent = await sendMessage({
        conversationId,
        text: guestAckText(input.booking),
        sentBy: 'BOT',
        botTrace: { source: BOOKING_REQUEST_ACK_SOURCE, idempotencyKey: `guest_ack:${ids[0]}` },
      })
      if (!sent || sent.deliveryStatus === 'FAILED') console.error('notifyGuestRequestReceived: kirim gagal', { conversationId })
    } catch (error) {
      console.error('notifyGuestRequestReceived: kirim gagal', { conversationId, error: error instanceof Error ? error.name : 'unknown' })
    }
    broadcast({ type: 'booking-actions.changed', conversationId })
  } catch (error) {
    console.error('notifyGuestRequestReceived gagal', { error: error instanceof Error ? error.name : 'unknown' })
  }
}
