/**
 * Kabar ke TAMU sesudah perubahan booking dari chat-nya berhasil ditulis (permintaan owner 2026-10-20: tamu
 * minta "kaos 2 L 1 XL" -> booking diperbarui -> tamu dapat WhatsApp "sudah diperbarui, detail di portal").
 *
 * Dipanggil `executeBookingAction` sesudah transaksi EXECUTED, untuk Setujui manual DAN terapkan-otomatis, satu
 * kali per eksekusi (kartu yang sama tidak pernah dieksekusi dua kali; kunci `guest_update:<actionId>` dicatat di
 * botTrace pesan dan event GUEST_NOTICE_SENT menahan panggilan ulang). Fire-and-forget, TIDAK PERNAH melempar,
 * respons eksekusi tidak berubah.
 *
 * Isi dibuat di kode (tanpa LLM, tanpa nama tamu): "Noted" + satu baris per field yang BENAR-BENAR ditulis + tautan
 * portal. Inggris bawaan, Indonesia bila `guestDetails.country` memuat "indonesia" (`isIndonesianGuest`, aturan
 * yang sama dengan permintaan data). Tautan: short link `url_short`/`short_url` bila API booking memuatnya
 * (2026-10-20: booking-overview new-backoffice belum memuatnya, ScheduleController.php:273-290), selain itu
 * `client_portal_url` (null untuk TWT = tanpa tautan), selain itu `customer_portal` yang bertoken sah. Tidak ada =
 * baris tautan dihilangkan.
 *
 * Gerbang (semuanya condong ke "jangan kirim"):
 *   - hanya kartu dari pesan TAMU (`sourceMessageId` menunjuk pesan INBOUND);
 *   - WhatsApp dengan nomor; rollout `test` (R25) = hanya percakapan uji (`bookingAutomationAllowed`);
 *   - jendela 24 jam tertutup = TIDAK mengirim teks bebas: event GUEST_NOTICE_SKIPPED (WINDOW_CLOSED) + push
 *     GUEST_NOTICE_FAILED ("kabari tamu manual"). Kirim gagal = GUEST_NOTICE_FAILED + push yang sama.
 * Jalur kirim = `sendMessage` (sama dengan permintaan data): safety guard + antrean outbound, sandbox `isTest` tidak
 * pernah dikirim sungguhan.
 *
 * "Batalkan" TIDAK mengabari tamu (keputusan 2026-10-20): admin yang mengurus komunikasinya.
 *
 * Pesan ini OUTBOUND, jadi tidak bisa jadi sumber usulan baru (ekstraksi hanya menerima sumber INBOUND,
 * schedule.ts `inboundIds`) dan tidak dihitung "tamu baru menjawab" oleh permintaan data (`guestRecentlyAnswered`
 * hanya membaca pesan INBOUND, kartu, dan fakta). Log hanya id/alasan, tanpa teks.
 */
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { sendMessage } from '@/lib/send'
import { notifyBookingAction } from '@/lib/push/send'
import { bookingUrlToken } from '@/lib/booking/backoffice-client'
import type { BookingData } from '@/lib/booking/client'
import { dataRequestWindowClosed, isIndonesianGuest } from './data-requests'
import { canonicalTshirtSizes, readBookingField, type FieldKey } from './fields'
import { recordEvent } from './history'
import { bookingAutomationAllowed } from './rollout'

export type WrittenField = { field: FieldKey; value: string }
type Lang = 'en' | 'id'

const SHORT_LINK_BASE = 'https://jvto.me/b/'
export const GUEST_NOTICE_FAILED_SUMMARY = 'Tamu belum dikabari perubahan booking — kabari manual'

const LABELS: Record<Lang, Record<'pickup_point' | 'pickup_time' | 'drop_point' | 'drop_time' | 'tshirt_sizes', string>> = {
  en: { pickup_point: 'Pickup point', pickup_time: 'Pickup time', drop_point: 'Drop-off point', drop_time: 'Drop-off time', tshirt_sizes: 'T-shirt' },
  id: { pickup_point: 'Titik jemput', pickup_time: 'Jam jemput', drop_point: 'Titik antar', drop_time: 'Jam antar', tshirt_sizes: 'Kaos' },
}

const TEXT: Record<Lang, { intro: string; link: (url: string) => string }> = {
  en: { intro: 'Noted, thank you! Your booking has been updated:', link: (url) => `You can check the full details here: ${url}` },
  id: { intro: 'Noted, terima kasih! Booking Anda sudah kami perbarui:', link: (url) => `Detail lengkap bisa dicek di: ${url}` },
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  return t ? t : null
}

/** Tautan portal untuk tamu, atau null (lihat kepala file). */
export function guestPortalLink(b: BookingData): string | null {
  for (const key of ['url_short', 'short_url']) {
    const v = text(b[key])
    if (v === null) continue
    if (/^https:\/\/\S+$/i.test(v)) return v
    if (/^[A-Za-z0-9_-]+$/.test(v)) return `${SHORT_LINK_BASE}${v}`
  }
  if ('client_portal_url' in b) {
    const v = text(b.client_portal_url)
    return v !== null && /^https:\/\/\S+$/i.test(v) ? v : null
  }
  // `customer_portal` selalu dirakit ".../my-booking/" + url, jadi url kosong tetap tampak berbentuk tautan.
  const portal = text(b.customer_portal)
  const token = bookingUrlToken(b)
  return portal !== null && token !== null && token !== 'my-booking' && /^https:\/\//i.test(portal) ? portal : null
}

/**
 * Satu baris per perubahan yang ditulis. Titik + detail satu baris ("Surabaya Hotel · Hotel Majapahit"); bagian
 * yang tidak ditulis diambil dari `booking` (data segar sebelum tulis) -- kecuali detail lama saat titiknya berganti.
 */
export function guestNoticeLines(written: readonly WrittenField[], booking: BookingData, lang: Lang): string[] {
  const get = (f: FieldKey) => written.find((w) => w.field === f)?.value ?? null
  const l = LABELS[lang]
  const lines: string[] = []
  for (const side of ['pickup', 'drop'] as const) {
    const pointKey = `${side}_point` as const
    const detailKey = `${side}_detail` as const
    const timeKey = `${side}_time` as const
    const point = get(pointKey)
    const detail = get(detailKey)
    if (point !== null || detail !== null) {
      const shownPoint = point ?? readBookingField(booking, pointKey)
      const shownDetail = detail ?? (point !== null ? null : readBookingField(booking, detailKey))
      const value = [shownPoint, shownDetail].filter((p): p is string => p !== null).join(' · ')
      if (value) lines.push(`- ${l[pointKey]}: ${value}`)
    }
    const time = get(timeKey)
    if (time !== null) lines.push(`- ${l[timeKey]}: ${time}`)
  }
  const sizes = get('tshirt_sizes')
  if (sizes !== null) lines.push(`- ${l.tshirt_sizes}: ${canonicalTshirtSizes(sizes) ?? sizes}`)
  return lines
}

/** Teks lengkap, atau null bila tidak ada baris yang bisa disebut. Murni. */
export function buildGuestNoticeText(written: readonly WrittenField[], booking: BookingData): string | null {
  const lang: Lang = isIndonesianGuest(booking) ? 'id' : 'en'
  const lines = guestNoticeLines(written, booking, lang)
  if (lines.length === 0) return null
  const link = guestPortalLink(booking)
  return [TEXT[lang].intro, ...lines, ...(link ? ['', TEXT[lang].link(link)] : [])].join('\n')
}

export async function notifyGuestOfUpdate(input: {
  actionId: string
  conversationId: string
  bookingId: string | null
  accountId: string | null
  /** Booking segar yang dipakai menulis (bagian yang tidak ditulis + tautan + negara). */
  booking: BookingData
  written: readonly WrittenField[]
  sourceMessageId: string | null
  now?: Date
}): Promise<void> {
  const { actionId, conversationId, bookingId, accountId } = input
  const now = input.now ?? new Date()
  const code = text(input.booking.id)
  const pushManual = (reason: string) =>
    Promise.resolve(
      notifyBookingAction({ kind: 'GUEST_NOTICE_FAILED', conversationId, bookingCode: code, summary: `${GUEST_NOTICE_FAILED_SUMMARY} (${reason})`, actionId })
    ).catch(() => undefined)

  try {
    const body = buildGuestNoticeText(input.written, input.booking)
    if (body === null) return
    if (input.sourceMessageId === null) return
    const source = await prisma.message.findUnique({ where: { id: input.sourceMessageId }, select: { direction: true, conversationId: true } })
    if (source?.direction !== 'INBOUND' || source.conversationId !== conversationId) return

    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { isTest: true, contact: { select: { phone: true } }, channelIdentity: { select: { platform: true } } },
    })
    if (!conv || (conv.channelIdentity?.platform ?? 'WHATSAPP') !== 'WHATSAPP' || !conv.contact?.phone) return
    if (!bookingAutomationAllowed({ isTest: conv.isTest, phone: conv.contact.phone })) return

    const already = await prisma.bookingActionEvent.findFirst({ where: { actionId, event: 'GUEST_NOTICE_SENT' }, select: { id: true } })
    if (already) return

    if (await dataRequestWindowClosed(conversationId, now)) {
      await recordEvent(prisma, { conversationId, bookingId, actionId, event: 'GUEST_NOTICE_SKIPPED', actor: 'SYSTEM', reason: 'WINDOW_CLOSED' })
      broadcast({ type: 'booking-actions.changed', conversationId })
      await pushManual('jendela 24 jam tertutup')
      return
    }

    let messageId: string | null = null
    let failed = false
    try {
      const sent = await sendMessage({
        conversationId,
        text: body,
        sentBy: accountId ? 'AGENT' : 'BOT',
        agentId: accountId ?? undefined,
        botTrace: { source: 'booking_update_notice', idempotencyKey: `guest_update:${actionId}` },
      })
      messageId = sent?.id ?? null
      failed = sent?.deliveryStatus === 'FAILED'
    } catch (error) {
      console.error('notifyGuestOfUpdate: kirim gagal', { actionId, error: error instanceof Error ? error.name : 'unknown' })
      failed = true
    }

    if (failed) {
      await recordEvent(prisma, { conversationId, bookingId, actionId, event: 'GUEST_NOTICE_FAILED', actor: 'SYSTEM', reason: 'SEND_FAILED' })
      broadcast({ type: 'booking-actions.changed', conversationId })
      await pushManual('pesan gagal dikirim')
      return
    }
    await recordEvent(prisma, {
      conversationId, bookingId, actionId, event: 'GUEST_NOTICE_SENT', actor: accountId ? 'ACCOUNT' : 'SYSTEM', accountId,
      newValue: { messageId },
    })
    broadcast({ type: 'booking-actions.changed', conversationId })
  } catch (error) {
    console.error('notifyGuestOfUpdate gagal', { actionId, error: error instanceof Error ? error.name : 'unknown' })
  }
}
