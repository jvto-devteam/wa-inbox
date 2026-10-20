/**
 * Tanda terima ke TAMU segera sesudah permintaannya menjadi kartu (owner 2026-10-20): "Noted, permintaan Anda sudah
 * kami terima dan sedang kami proses." Dikirim SEBELUM terapkan-otomatis; kabar "sudah diperbarui" (guest-notice.ts)
 * tetap menyusul sebagai pesan kedua -- keduanya memang diminta, jadi tidak ada penahan jeda di antaranya.
 *
 * Dipanggil `runExtraction` tepat sesudah `applyExtraction`. Memicu hanya bila ekstraksi itu melahirkan kartu CHANGE/TASK
 * dari pesan TAMU (bukan MISMATCH, bukan DATA_REQUEST, bukan kartu isian lahir di reevaluate). SATU pesan per run
 * walau kartunya banyak. Teks dibuat di kode (tanpa LLM, tanpa nama tamu); Inggris bawaan, Indonesia bila
 * `isIndonesianGuest`. Terkirim juga saat bot mati (admin yang menangani chat) -- tidak membaca `botEnabled`.
 *
 * Gerbang (condong ke "jangan kirim"): WhatsApp bernomor; `bookingAutomationAllowed`; jendela 24 jam terbuka (tertutup
 * = diam, tanpa push; tamu baru saja menulis, jadi lazimnya terbuka). Idempotensi: event GUEST_ACK_SENT di setiap
 * kartu yang disebut (ekstraksi ulang tidak mengirim lagi untuk kartu yang sama) + paling banyak satu tanda terima per
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
/** Margin kecil: `createdAt` kartu diberi stempel DB, `since` oleh proses ini. */
const SINCE_MARGIN_MS = 5_000

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
  /** Awal run ekstraksi: hanya kartu CHANGE/TASK yang lahir sejak itu yang dihitung. */
  since: Date
  now?: Date
}): Promise<void> {
  const { conversationId } = input
  const now = input.now ?? new Date()
  try {
    const cards =
      (await prisma.bookingAction.findMany({
        where: {
          conversationId,
          type: { in: ['CHANGE', 'TASK'] },
          createdAt: { gte: new Date(input.since.getTime() - SINCE_MARGIN_MS) },
          sourceMessageId: { not: null },
        },
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
    const acked = await prisma.bookingActionEvent.findFirst({
      where: { actionId: { in: ids }, event: 'GUEST_ACK_SENT' },
      select: { id: true },
    })
    if (acked) return
    const recent = await prisma.bookingActionEvent.findFirst({
      where: { conversationId, event: 'GUEST_ACK_SENT', createdAt: { gte: new Date(now.getTime() - GUEST_ACK_MIN_GAP_MS) } },
      select: { id: true },
    })
    if (recent) return

    if (await dataRequestWindowClosed(conversationId, now)) return

    const first = ids[0]
    let messageId: string | null = null
    try {
      const sent = await sendMessage({
        conversationId,
        text: guestAckText(input.booking),
        sentBy: 'BOT',
        botTrace: { source: BOOKING_REQUEST_ACK_SOURCE, idempotencyKey: `guest_ack:${first}` },
      })
      if (!sent || sent.deliveryStatus === 'FAILED') {
        console.error('notifyGuestRequestReceived: kirim gagal', { conversationId })
        return
      }
      messageId = sent.id
    } catch (error) {
      console.error('notifyGuestRequestReceived: kirim gagal', { conversationId, error: error instanceof Error ? error.name : 'unknown' })
      return
    }
    for (const id of ids) {
      await recordEvent(prisma, {
        conversationId, bookingId: input.bookingId, actionId: id, event: 'GUEST_ACK_SENT', actor: 'SYSTEM',
        newValue: { messageId, batch: ids },
      })
    }
    broadcast({ type: 'booking-actions.changed', conversationId })
  } catch (error) {
    console.error('notifyGuestRequestReceived gagal', { error: error instanceof Error ? error.name : 'unknown' })
  }
}
