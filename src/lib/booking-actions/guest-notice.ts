/**
 * Kabar ke TAMU sesudah perubahan booking dari chat-nya berhasil ditulis (permintaan owner 2026-10-20: tamu
 * minta "kaos 2 L 1 XL" -> booking diperbarui -> tamu dapat WhatsApp "sudah diperbarui, detail di portal").
 *
 * Setujui manual: dipanggil `executeBookingAction` sesudah transaksi EXECUTED, satu kali per eksekusi. Terapkan-otomatis:
 * `executeBookingAction` menunda (`deferGuestNotice`) dan `autoApplyCreated` mengirim SATU kabar gabungan untuk semua
 * kartu yang tertulis dari satu ekstraksi (review Important 2). Kunci `guest_update:<kartu pertama>` dicatat di botTrace
 * pesan; event GUEST_NOTICE_SENT di setiap kartu menahan panggilan ulang. Fire-and-forget, TIDAK PERNAH melempar,
 * respons eksekusi tidak berubah.
 *
 * Isi dibuat di kode (tanpa LLM, tanpa nama tamu): "Noted" + satu baris per field yang BENAR-BENAR ditulis + tautan
 * portal. Bahasa mengikuti pesan tamu sumber kartu (`guestLanguage`, owner 2026-10-21); negara di booking
 * (`isIndonesianGuest`) hanya cadangan bila chat tidak jelas. Tautan: short link `url_short`/`short_url` bila API booking
 * memuatnya (2026-10-20: booking-overview new-backoffice belum memuatnya, ScheduleController.php:273-290), selain itu
 * `client_portal_url` (null untuk TWT = tanpa tautan), selain itu `customer_portal` yang bertoken sah. Tidak ada =
 * baris tautan dihilangkan. Tautan my-booking panjang diganti `jvto.me/b/<kode>` yang dihitung ulang dan diverifikasi
 * ke legacy (`resolveGuestPortalLink`, `src/lib/booking/short-link.ts`). Dikirim dengan purpose `SYSTEM`, jadi tidak
 * ditahan safety guard saat admin mengambil alih chat.
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
import { BOOKING_UPDATE_NOTICE_SOURCE } from '@/lib/summary-items/automated'
import { bookingUrlToken } from '@/lib/booking/backoffice-client'
import type { BookingData } from '@/lib/booking/client'
import { SHORT_LINK_BASE, verifiedBookingShortCode } from '@/lib/booking/short-link'
import { dataRequestWindowClosed } from './data-requests'
import { guestLanguage } from './guest-language'
import { canonicalTshirtSizes, readBookingField, type FieldKey } from './fields'
import { recordEvent } from './history'
import { bookingAutomationAllowed } from './rollout'

export type WrittenField = { field: FieldKey; value: string }
type Lang = 'en' | 'id'

const NOTICE_LOOKBACK_MS = 24 * 60 * 60 * 1000
export const GUEST_NOTICE_FAILED_SUMMARY = 'Tamu belum dikabari perubahan booking — kabari manual'

const LABELS: Record<Lang, Record<'pickup_point' | 'pickup_time' | 'drop_point' | 'drop_time' | 'tshirt_sizes', string>> = {
  en: { pickup_point: 'Pickup point', pickup_time: 'Pickup time', drop_point: 'Drop-off point', drop_time: 'Drop-off time', tshirt_sizes: 'T-shirt' },
  id: { pickup_point: 'Titik jemput', pickup_time: 'Jam jemput', drop_point: 'Titik antar', drop_time: 'Jam antar', tshirt_sizes: 'Kaos' },
}

const TEXT: Record<Lang, { intro: string; matched: string; link: (url: string) => string }> = {
  en: { intro: 'Noted, thank you! Your booking has been updated:', matched: 'Noted, thank you! Your booking already matches your request:', link: (url) => `You can check the full details here: ${url}` },
  id: { intro: 'Noted, terima kasih! Booking Anda sudah kami perbarui:', matched: 'Noted, terima kasih! Booking Anda sudah sesuai dengan permintaan Anda:', link: (url) => `Detail lengkap bisa dicek di: ${url}` },
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
 * `guestPortalLink`, tetapi tautan my-booking panjang diganti short link `jvto.me/b/<kode>` bila kodenya terbukti milik
 * booking ini (`verifiedBookingShortCode`). Tanpa tautan (mis. TWT), tautan short dari API, atau tautan ke tempat lain
 * dibiarkan apa adanya. Gagal verifikasi = tautan panjang.
 */
export async function resolveGuestPortalLink(b: BookingData, fetchImpl?: typeof fetch): Promise<string | null> {
  const link = guestPortalLink(b)
  if (link === null || text(b.url_short) !== null || text(b.short_url) !== null) return link
  const token = bookingUrlToken(b)
  if (token === null || !link.replace(/[?#].*$/, '').replace(/\/+$/, '').endsWith(`/my-booking/${token}`)) return link
  const code = await verifiedBookingShortCode(token, fetchImpl)
  return code ? `${SHORT_LINK_BASE}${code}` : link
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
export function buildGuestNoticeText(
  written: readonly WrittenField[],
  booking: BookingData,
  variant: 'updated' | 'matched' = 'updated',
  opts: {
    /** Isi pesan tamu sumber kartu: bahasanya menang atas negara di booking (`guestLanguage`). */
    guestTexts?: readonly string[]
    /** Tautan yang sudah diselesaikan (`resolveGuestPortalLink`); kosong = `guestPortalLink(booking)`. */
    link?: string | null
  } = {}
): string | null {
  const lang: Lang = guestLanguage(booking, opts.guestTexts)
  const lines = guestNoticeLines(written, booking, lang)
  if (lines.length === 0) return null
  const link = opts.link !== undefined ? opts.link : guestPortalLink(booking)
  return [variant === 'matched' ? TEXT[lang].matched : TEXT[lang].intro, ...lines, ...(link ? ['', TEXT[lang].link(link)] : [])].join('\n')
}

/** Satu kartu yang ikut dikabarkan: id, pesan sumbernya, dan nilai yang ditulisnya (kartu + isian detail). */
export type GuestNoticeItem = { actionId: string; sourceMessageId: string | null; written: readonly WrittenField[] }

/**
 * SATU pesan untuk semua kartu `items` (urutan = kartu utama dulu). Setujui manual: kartu + pendamping satu
 * eksekusi; terapkan-otomatis: semua kartu yang tertulis dari satu ekstraksi (`autoApplyCreated`), supaya satu pesan
 * tamu tidak dijawab beberapa "Noted". Kunci = `guest_update:<kartu pertama>`; GUEST_NOTICE_SENT dicatat di SETIAP
 * kartu yang disebut, dan salah satunya sudah ada = tidak dikirim lagi.
 */
export async function notifyGuestOfUpdate(input: {
  conversationId: string
  bookingId: string | null
  accountId: string | null
  /** Booking segar (bagian yang tidak ditulis + tautan + negara). */
  booking: BookingData
  items: readonly GuestNoticeItem[]
  /** 'matched' = nilainya sudah ada di booking (tidak ada tulisan): "sudah sesuai" menyusul tanda terima. */
  variant?: 'updated' | 'matched'
  now?: Date
}): Promise<void> {
  const { conversationId, bookingId, accountId } = input
  const now = input.now ?? new Date()
  const code = text(input.booking.id)
  try {
    // Hanya kartu yang lahir dari pesan TAMU di percakapan ini.
    const sourceIds = [...new Set(input.items.flatMap((i) => (i.sourceMessageId ? [i.sourceMessageId] : [])))]
    if (sourceIds.length === 0) return
    const sources =
      (await prisma.message.findMany({ where: { id: { in: sourceIds }, conversationId }, select: { id: true, direction: true, content: true } })) ?? []
    const inboundSources = sources.filter((m) => m.direction === 'INBOUND')
    const inbound = new Set(inboundSources.map((m) => m.id))
    const guestTexts = inboundSources.flatMap((m) => (m.content ? [m.content] : []))
    const items = input.items.filter((i) => i.sourceMessageId !== null && inbound.has(i.sourceMessageId))
    if (items.length === 0) return
    const written = items.flatMap((i) => i.written)
    if (buildGuestNoticeText(written, input.booking, input.variant, { guestTexts }) === null) return
    const actionId = items[0].actionId
    const ids = items.map((i) => i.actionId)
    const pushManual = (reason: string) =>
      Promise.resolve(
        notifyBookingAction({
          kind: 'GUEST_NOTICE_FAILED', conversationId, bookingCode: code, summary: `${GUEST_NOTICE_FAILED_SUMMARY} (${reason})`, actionId, tagSuffix: 'guest',
        })
      ).catch(() => undefined)

    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { isTest: true, contact: { select: { phone: true } }, channelIdentity: { select: { platform: true } } },
    })
    if (!conv || (conv.channelIdentity?.platform ?? 'WHATSAPP') !== 'WHATSAPP' || !conv.contact?.phone) return
    if (!bookingAutomationAllowed({ isTest: conv.isTest, phone: conv.contact.phone })) return

    // Kabar dikirim tepat sesudah eksekusi: 24 jam cukup sebagai batas pindai (tanpa indeks actionId).
    const already = await prisma.bookingActionEvent.findFirst({
      where: { actionId: { in: ids }, event: 'GUEST_NOTICE_SENT', createdAt: { gte: new Date(now.getTime() - NOTICE_LOOKBACK_MS) } },
      select: { id: true },
    })
    if (already) return

    if (await dataRequestWindowClosed(conversationId, now)) {
      await recordEvent(prisma, { conversationId, bookingId, actionId, event: 'GUEST_NOTICE_SKIPPED', actor: 'SYSTEM', reason: 'WINDOW_CLOSED' })
      broadcast({ type: 'booking-actions.changed', conversationId })
      await pushManual('jendela 24 jam tertutup')
      return
    }

    // Short link diselesaikan SESUDAH semua gerbang (memanggil legacy), supaya kabar yang tidak dikirim tidak memukul jaringan.
    const link = await resolveGuestPortalLink(input.booking)
    const body = buildGuestNoticeText(written, input.booking, input.variant, { guestTexts, link }) ?? ''

    let messageId: string | null = null
    let failed = false
    try {
      const sent = await sendMessage({
        conversationId,
        text: body,
        sentBy: accountId ? 'AGENT' : 'BOT',
        agentId: accountId ?? undefined,
        // Kabar sistem, bukan balasan bot: tetap terkirim saat admin mengambil alih chat.
        purpose: 'SYSTEM',
        botTrace: { source: BOOKING_UPDATE_NOTICE_SOURCE, idempotencyKey: `guest_update:${actionId}` },
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
    for (const id of ids) {
      await recordEvent(prisma, {
        conversationId, bookingId, actionId: id, event: 'GUEST_NOTICE_SENT', actor: accountId ? 'ACCOUNT' : 'SYSTEM', accountId,
        newValue: { messageId, batch: ids },
      })
    }
    broadcast({ type: 'booking-actions.changed', conversationId })
  } catch (error) {
    console.error('notifyGuestOfUpdate gagal', { error: error instanceof Error ? error.name : 'unknown' })
  }
}
