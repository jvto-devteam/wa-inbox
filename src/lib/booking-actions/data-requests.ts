/**
 * Draf permintaan data H-7 (Task 12): pesan WhatsApp ke TAMU yang datanya kurang untuk hari-H.
 * Dengan setelan bawaan (`dataRequestApproval = ALWAYS`) pesan ini TERKIRIM SENDIRI ke tamu sungguhan,
 * jadi semua keputusan di sini condong ke "jangan kirim".
 *
 * Kandidat (semua harus terpenuhi):
 *   - percakapan WhatsApp dengan `bookingData` ber-`booking_id`, dan `date.start_ymd` 1..7 hari lagi (WIB, H-7..H-1;
 *     hari-H = trip mulai, Ruling R24);
 *   - nomor bukan Indonesia (`isIndonesianNumber`), KECUALI percakapan uji `isTest` (Ruling R13) atau nomor
 *     `BOOKING_ACTIONS_TEST_PHONES` (R25); selama rollout `test` (`rollout.ts`) HANYA percakapan uji itu;
 *   - minimal satu celah (`findDataGaps`): titik jemput 'Others' atau bandara/stasiun tanpa detail DAN tanpa
 *     nomor kedatangan (kunci celah `pickup_detail`, jalur tulis ada); jam jemput/antar KOSONG (null/''). Ruling R23:
 *     '07:00' TIDAK ditanyakan (bisa jam sungguhan; pembanding lain tetap memperlakukannya tak diketahui). Jam jemput hanya ditanyakan bila titik jemput sudah ada (begitu pula jam antar) --
 *     booking tanpa titik membawa jam palsu dan menanyakannya ke tamu hanya membingungkan.
 *   Pesan HANYA menyebut celah yang ada. Teks dibuat di kode (EN; ID bila `guestDetails.country` Indonesia),
 *   tanpa LLM dan tanpa nama tamu.
 *
 * Jadwal: tick tiap 5 menit, tetapi DRAF baru dan pengiriman otomatis hanya pukul 08:00-19:59 WIB (tamu tidak
 * dipesan malam hari). Penutupan siklus hidup (data lengkap / trip mulai) jalan kapan saja.
 *
 * Satu per booking per hari WIB: `@@unique([bookingId, type, forDay])` + cek lebih dulu + tangkap P2002, jadi tick
 * berulang idempoten (draf yang ditolak/terkirim hari ini tidak dibuat lagi hari itu). Draf OPEN hari sebelumnya
 * -> SUPERSEDED/REPLACED saat draf hari ini dibuat; data lengkap -> RESOLVED/DATA_COMPLETE; trip mulai ->
 * RESOLVED/TRIP_STARTED.
 *
 * Kirim (`sendDataRequest`, dipakai tick dan tombol "Kirim"): lewat `sendMessage` -- jalur kirim composer, lengkap
 * dengan safety guard + antrean outbound (Unofficial) dan sandbox `isTest` (tidak pernah ke Meta/coexist).
 * `sendMessage` tidak punya kunci idempotensi sendiri, jadi KLAIM-lah kuncinya (`data_request:<actionId>`, dicatat di
 * botTrace pesan): OPEN -> DONE/SENT lewat `updateMany where state OPEN` SEBELUM kirim; hanya satu pemanggil yang
 * mendapat count 1. Gagal kirim (lemparan / pesan FAILED) -> kembali OPEN + `lastError` + event EXECUTE_FAILED + push;
 * kartu yang gagal tidak dicoba otomatis lagi (menunggu orang). Dikirim = state DONE, closedReason SENT, event
 * DRAFT_SENT (actor SYSTEM bila otomatis, ACCOUNT bila diklik). Jendela 24 jam tertutup = tidak pernah mengirim
 * teks bebas (kartu tetap OPEN, UI: "Butuh template"). Tanpa push per draf; push hanya saat gagal kirim.
 * Log hanya id/status: tanpa teks pelanggan.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { sendMessage } from '@/lib/send'
import { jakartaDayKey, jakartaDayRange } from '@/lib/daily-summary/time'
import { serviceWindowClosed } from '@/lib/inbox/service-window'
import { notifyBookingAction } from '@/lib/push/send'
import { lookupBookingResult, type BookingData } from '@/lib/booking/client'
import { readBookingField, type FieldKey } from './fields'
import { recordEvent } from './history'
import { currentBookingId } from './scope'
import { blockedByIndonesianGate, bookingAutomationAllowed } from './rollout'
import { reevaluateBookingActions } from './store'

export const DATA_REQUEST_DAYS_AHEAD = 7
export const DATA_REQUEST_DAYS_MIN = 1
/** Jam kirim WIB: [mulai, selesai). */
export const DATA_REQUEST_HOUR_FROM = 8
export const DATA_REQUEST_HOUR_TO = 20
/** Batas pengiriman otomatis per tick (lonjakan tidak membanjiri tamu / safety guard). */
const MAX_AUTO_SENDS_PER_TICK = 10
/** Tiap percobaan kirim otomatis = satu panggilan API booking (timeout 10 s): dibatasi jumlah DAN total waktunya. */
export const MAX_AUTO_LOOKUPS_PER_TICK = 10
export const AUTO_SEND_BUDGET_MS = 30_000
const DAY_MS = 24 * 60 * 60 * 1000
const AIRPORT_STATION = ['Surabaya Airport', 'Denpasar Airport', 'Surabaya Train Station']
const YMD = /^\d{4}-\d{2}-\d{2}$/

export type DataGapField = Extract<FieldKey, 'pickup_detail' | 'pickup_time' | 'drop_time'>

function asBooking(raw: unknown): BookingData | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as BookingData) : null
}

/** Celah data yang perlu ditanyakan ke tamu, berurutan; kosong = lengkap. */
export function findDataGaps(booking: BookingData): DataGapField[] {
  const gaps: DataGapField[] = []
  const point = readBookingField(booking, 'pickup_point')
  const detail = readBookingField(booking, 'pickup_detail')
  const arrival = readBookingField(booking, 'pickup_arrival')
  // Satu kunci `pickup_detail` untuk 'Others' dan bandara/stasiun (nomor kedatangan dihitung detail): hanya field
  // yang punya jalur tulis (R16) yang jadi celah, jadi draf tidak bisa menggantung tanpa bisa ditutup.
  if (point !== null && (point === 'Others' || AIRPORT_STATION.includes(point)) && !detail && !arrival) gaps.push('pickup_detail')
  // R23: hanya null/'' yang pasti kosong; '07:00' tidak ditanyakan.
  if (point !== null && readBookingField(booking, 'pickup_time') === null) gaps.push('pickup_time')
  if (readBookingField(booking, 'drop_point') !== null && readBookingField(booking, 'drop_time') === null) gaps.push('drop_time')
  return gaps
}

function isIndonesianGuest(booking: BookingData): boolean {
  const country = booking.guestDetails?.country
  return typeof country === 'string' && /indonesia/i.test(country)
}

const TEXT = {
  en: {
    intro: (date: string | null) => `Hello from Java Volcano Tour Operator! Your trip ${date ? `starts on ${date}` : 'is coming up'}. To get everything ready, could you please send us:`,
    outro: 'Thank you!',
    pickup_detail: 'The name of your hotel or the exact address for pickup',
    flight: 'Your flight number and arrival time',
    train: 'Your train name/number and arrival time',
    pickup_time: 'Your preferred pickup time',
    drop_time: 'Your preferred drop-off time',
  },
  id: {
    intro: (date: string | null) => `Halo dari Java Volcano Tour Operator! Trip Anda ${date ? `dimulai pada ${date}` : 'segera dimulai'}. Agar semuanya siap, mohon kirimkan:`,
    outro: 'Terima kasih!',
    pickup_detail: 'Nama hotel atau alamat lengkap untuk penjemputan',
    flight: 'Nomor penerbangan dan jam kedatangan Anda',
    train: 'Nama/nomor kereta dan jam kedatangan Anda',
    pickup_time: 'Jam penjemputan yang Anda inginkan',
    drop_time: 'Jam pengantaran yang Anda inginkan',
  },
} as const

const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  id: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'],
} as const

/** "2026-10-25" -> "25 Oct 2026" / "25 Okt 2026"; null bila bukan tanggal. */
function formatYmd(ymd: string | null, lang: 'en' | 'id'): string | null {
  if (ymd === null || !YMD.test(ymd)) return null
  const [y, m, d] = ymd.split('-').map(Number)
  if (m < 1 || m > 12) return null
  return `${d} ${MONTHS[lang][m - 1]} ${y}`
}

/** Teks draf: hanya butir yang kurang. Murni, tanpa LLM dan tanpa nama tamu. */
export function buildDataRequestText(booking: BookingData, gaps: readonly DataGapField[]): string {
  const t = isIndonesianGuest(booking) ? TEXT.id : TEXT.en
  const point = readBookingField(booking, 'pickup_point')
  const lines = gaps.map((g) => {
    if (g === 'pickup_detail') {
      if (point === 'Surabaya Train Station') return `- ${t.train}`
      if (point === 'Surabaya Airport' || point === 'Denpasar Airport') return `- ${t.flight}`
    }
    return `- ${t[g]}`
  })
  const lang = isIndonesianGuest(booking) ? 'id' : 'en'
  return [t.intro(formatYmd(readBookingField(booking, 'travel_date'), lang)), ...lines, '', t.outro].join('\n')
}

/** Jam WIB (0-23) pada `now`. */
function jakartaHour(now: Date): number {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).getUTCHours()
}

export function inDataRequestHours(now: Date): boolean {
  const h = jakartaHour(now)
  return h >= DATA_REQUEST_HOUR_FROM && h < DATA_REQUEST_HOUR_TO
}

/** Selisih hari kalender (WIB) dari `today` ke `ymd`; null bila bukan tanggal. */
function daysUntil(ymd: unknown, today: string): number | null {
  if (typeof ymd !== 'string' || !YMD.test(ymd)) return null
  const diff = Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)
  return Number.isNaN(diff) ? null : Math.round(diff / DAY_MS)
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
}

function bookingCode(b: BookingData): string | null {
  const id = (b as Record<string, unknown>).id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

async function lastInboundIso(conversationId: string): Promise<string | null> {
  const msg = await prisma.message.findFirst({
    where: { conversationId, direction: 'INBOUND' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  return msg ? msg.createdAt.toISOString() : null
}

/** Jendela 24 jam tertutup untuk percakapan ini? (dipakai juga GET panel kartu). */
export async function dataRequestWindowClosed(conversationId: string, now: Date = new Date()): Promise<boolean> {
  return serviceWindowClosed(await lastInboundIso(conversationId), now)
}

export type SendDataRequestResult =
  | { ok: true }
  | { ok: false; status: 404 | 409 | 502; error: string }

/**
 * Kirim satu draf DATA_REQUEST. `accountId` null = sistem (otomatis). Tidak melempar.
 */
export async function sendDataRequest(input: { actionId: string; accountId: string | null; now?: Date; onLookup?: () => void }): Promise<SendDataRequestResult> {
  const now = input.now ?? new Date()
  try {
    const action = await prisma.bookingAction.findUnique({
      where: { id: input.actionId },
      include: { conversation: { select: { id: true, bookingData: true, isTest: true, contact: { select: { phone: true } }, channelIdentity: { select: { platform: true } } } } },
    })
    if (!action || action.type !== 'DATA_REQUEST') return { ok: false, status: 404, error: 'Tindakan tidak ditemukan' }
    if (action.state !== 'OPEN') return { ok: false, status: 409, error: 'Tindakan sudah ditutup' }
    let text = action.draftText?.trim() ?? ''
    if (!text) return { ok: false, status: 409, error: 'Draf kosong' }

    const conv = action.conversation
    const booking = asBooking(conv.bookingData)
    if (!booking || action.bookingId === null || currentBookingId(booking) !== action.bookingId) {
      return { ok: false, status: 409, error: 'Booking percakapan berganti, periksa ulang' }
    }
    if (findDataGaps(booking).length === 0) return { ok: false, status: 409, error: 'Data booking sudah lengkap' }
    if ((conv.channelIdentity?.platform ?? 'WHATSAPP') !== 'WHATSAPP' || !conv.contact.phone) {
      return { ok: false, status: 409, error: 'Percakapan ini tidak bisa dikirimi WhatsApp' }
    }
    const gate = { isTest: conv.isTest, phone: conv.contact.phone }
    if (!bookingAutomationAllowed(gate)) {
      return { ok: false, status: 409, error: 'Permintaan data masih tahap uji (hanya nomor uji)' }
    }
    if (blockedByIndonesianGate(gate)) {
      return { ok: false, status: 409, error: 'Nomor Indonesia tidak dikirimi draf otomatis' }
    }
    // Draf kemarin tidak boleh terkirim hari ini (isinya dari data kemarin) -- juga lewat tombol Kirim.
    const today = jakartaDayKey(now)
    if (action.forDay !== today) return { ok: false, status: 409, error: 'Draf sudah kedaluwarsa' }
    // Paling banyak satu pesan permintaan data per booking per hari WIB, apa pun cara kirimnya.
    if (await sentToday(action.bookingId, today)) {
      return { ok: false, status: 409, error: 'Permintaan data untuk booking ini sudah terkirim hari ini' }
    }
    if (await dataRequestWindowClosed(conv.id, now)) {
      return { ok: false, status: 409, error: 'Butuh template: tamu belum chat lebih dari 24 jam' }
    }

    const gapFields = Array.isArray(action.proposedValue) ? action.proposedValue.filter((f): f is string => typeof f === 'string') : []
    // Pengiriman OTOMATIS tidak menanyakan ulang tamu yang baru menjawab; sisanya diserahkan ke orang (draf tetap OPEN).
    if (input.accountId === null && (await guestRecentlyAnswered(action, gapFields))) {
      return { ok: false, status: 409, error: 'Tamu baru menjawab, menunggu orang memeriksa' }
    }

    // Data booking di DB bisa ~24 jam basi: segarkan SATU booking ini tepat sebelum klaim. Gagal = jangan kirim, draf
    // tetap OPEN tanpa push (dicoba lagi tick berikutnya). Percakapan uji tidak punya booking untuk dicari (sandbox).
    if (!conv.isTest) {
      input.onLookup?.()
      const fresh = await lookupBookingResult(conv.contact.phone)
      if (fresh.status !== 'found') return { ok: false, status: 502, error: 'Data booking belum bisa diperiksa, coba lagi nanti' }
      if (currentBookingId(fresh.data) !== action.bookingId) {
        // Draf ini milik booking lain: tutup, jangan dicoba lagi tiap 5 menit sepanjang hari.
        await closeOpen(action, 'RESOLVED', 'BOOKING_CHANGED', now)
        return { ok: false, status: 409, error: 'Booking percakapan berganti, periksa ulang' }
      }
      await prisma.conversation.update({ where: { id: conv.id }, data: { bookingData: fresh.data as Prisma.InputJsonValue, bookingCheckedAt: now } })
      // Data baru tersimpan: kartu lain percakapan ini dibandingkan ulang (sama dengan ensureFreshBookingData). Tidak melempar.
      try {
        await reevaluateBookingActions(conv.id)
      } catch (error) {
        console.error('sendDataRequest: reevaluate gagal', { actionId: action.id, error: error instanceof Error ? error.name : 'unknown' })
      }
      // Tanggal trip bisa bergeser sejak draf dibuat: di luar H-7..H-1 tidak ada yang dikirim.
      const days = daysUntil(fresh.data.date?.start_ymd, today)
      if (days === null || days < DATA_REQUEST_DAYS_MIN || days > DATA_REQUEST_DAYS_AHEAD) {
        await closeOpen(action, 'RESOLVED', days !== null && days <= 0 ? 'TRIP_STARTED' : 'OUT_OF_WINDOW', now)
        return { ok: false, status: 409, error: 'Tanggal trip di luar jendela permintaan data' }
      }
      const gaps = findDataGaps(fresh.data)
      if (gaps.length === 0) {
        await closeOpen(action, 'RESOLVED', 'DATA_COMPLETE', now)
        return { ok: false, status: 409, error: 'Data booking sudah lengkap' }
      }
      if (input.accountId === null && (await guestRecentlyAnswered(action, gaps))) {
        return { ok: false, status: 409, error: 'Tamu baru menjawab, menunggu orang memeriksa' }
      }
      // Teks SELALU dibangun ulang dari data segar (tanggal bisa berubah walau celahnya sama).
      const rebuilt = buildDataRequestText(fresh.data, gaps)
      if (rebuilt !== text || gaps.join() !== gapFields.join()) {
        await prisma.bookingAction.updateMany({ where: { id: action.id, state: 'OPEN' }, data: { draftText: rebuilt, proposedValue: gaps } })
        broadcast({ type: 'booking-actions.changed', conversationId: conv.id })
        // Operator tidak boleh mengirim teks yang berbeda dari yang ia lihat: kartu dimuat ulang, kirim lagi.
        if (input.accountId !== null) return { ok: false, status: 409, error: 'Isi pesan berubah — muat ulang' }
        text = rebuilt
      }
    }

    // Klaim = kunci idempotensi `data_request:<actionId>`: hanya satu pemanggil yang lolos.
    const claim = await prisma.bookingAction.updateMany({
      where: { id: action.id, state: 'OPEN' },
      data: { state: 'DONE', closedReason: 'SENT', closedAt: now, closedById: input.accountId, lastError: null },
    })
    if (claim.count === 0) return { ok: false, status: 409, error: 'Tindakan sudah ditutup' }

    let failure: string | null = null
    let messageId: string | null = null
    try {
      const sent = await sendMessage({
        conversationId: conv.id,
        text,
        sentBy: input.accountId ? 'AGENT' : 'BOT',
        agentId: input.accountId ?? undefined,
        botTrace: { source: 'data_request', idempotencyKey: `data_request:${action.id}` },
      })
      messageId = sent?.id ?? null
      if (sent?.deliveryStatus === 'FAILED') failure = 'Pesan gagal dikirim'
    } catch (error) {
      console.error('sendDataRequest: kirim gagal', { actionId: action.id, error: error instanceof Error ? error.name : 'unknown' })
      failure = 'Pesan gagal dikirim'
    }

    if (failure !== null) {
      await prisma.bookingAction.updateMany({
        where: { id: action.id, state: 'DONE', closedReason: 'SENT' },
        data: { state: 'OPEN', closedReason: null, closedAt: null, closedById: null, lastError: failure },
      })
      await recordEvent(prisma, {
        conversationId: conv.id, bookingId: action.bookingId, actionId: action.id,
        event: 'EXECUTE_FAILED', actor: input.accountId ? 'ACCOUNT' : 'SYSTEM', accountId: input.accountId, reason: 'SEND_FAILED',
      })
      void Promise.resolve(
        notifyBookingAction({
          kind: 'DATA_REQUEST_FAILED',
          conversationId: conv.id,
          bookingCode: bookingCode(booking),
          summary: 'Permintaan data H-7 belum terkirim ke tamu',
          actionId: action.id,
        })
      ).catch(() => undefined)
      broadcast({ type: 'booking-actions.changed', conversationId: conv.id })
      return { ok: false, status: 502, error: 'Pesan gagal dikirim' }
    }

    await recordEvent(prisma, {
      conversationId: conv.id, bookingId: action.bookingId, actionId: action.id,
      event: 'DRAFT_SENT', actor: input.accountId ? 'ACCOUNT' : 'SYSTEM', accountId: input.accountId,
      newValue: { messageId, auto: input.accountId === null },
    })
    broadcast({ type: 'booking-actions.changed', conversationId: conv.id })
    return { ok: true }
  } catch (error) {
    console.error('sendDataRequest gagal', { actionId: input.actionId, error: error instanceof Error ? error.name : 'unknown' })
    return { ok: false, status: 502, error: 'Gagal mengirim draf' }
  }
}

/** Sudah ada DATA_REQUEST terkirim (closedReason SENT) untuk booking ini pada hari WIB `day`? */
async function sentToday(bookingId: string | null, day: string): Promise<boolean> {
  if (bookingId === null) return false
  const { start, end } = jakartaDayRange(day)
  const row = await prisma.bookingAction.findFirst({
    where: { bookingId, type: 'DATA_REQUEST', closedReason: 'SENT', closedAt: { gte: start, lt: end } },
    select: { id: true },
  })
  return Boolean(row)
}

/** Tamu baru menjawab soal celah ini: CHANGE terbuka, fakta aktif, atau pesan masuk lebih baru dari draf. */
async function guestRecentlyAnswered(
  action: { conversationId: string; bookingId: string | null; createdAt: Date },
  gapFields: string[]
): Promise<boolean> {
  // Titik & detail jemput ditulis bersama (R17), jadi kartu titik ikut dihitung.
  // Nomor penerbangan/kereta yang disebut tamu disimpan ekstraktor sebagai `pickup_arrival` (tanpa jalur tulis, R16).
  const fields = gapFields.includes('pickup_detail') ? [...gapFields, 'pickup_point', 'pickup_arrival'] : gapFields
  if (fields.length > 0) {
    const change = await prisma.bookingAction.findFirst({
      where: { conversationId: action.conversationId, type: 'CHANGE', state: 'OPEN', field: { in: fields }, OR: [{ bookingId: action.bookingId }, { bookingId: null }] },
      select: { id: true },
    })
    if (change) return true
    const fact = await prisma.bookingFact.findFirst({
      where: { conversationId: action.conversationId, field: { in: fields }, supersededAt: null, OR: [{ bookingId: action.bookingId }, { bookingId: null }] },
      select: { id: true },
    })
    if (fact) return true
  }
  const newer = await prisma.message.findFirst({
    where: { conversationId: action.conversationId, direction: 'INBOUND', createdAt: { gt: action.createdAt } },
    select: { id: true },
  })
  return Boolean(newer)
}

async function closeOpen(
  row: { id: string; conversationId: string; bookingId: string | null },
  state: 'SUPERSEDED' | 'RESOLVED',
  closedReason: string,
  now: Date
): Promise<boolean> {
  const res = await prisma.bookingAction.updateMany({
    where: { id: row.id, state: 'OPEN' },
    data: { state, closedReason, closedAt: now },
  })
  if (res.count === 0) return false
  await recordEvent(prisma, {
    conversationId: row.conversationId, bookingId: row.bookingId, actionId: row.id, event: state, actor: 'SYSTEM', reason: closedReason,
  })
  broadcast({ type: 'booking-actions.changed', conversationId: row.conversationId })
  return true
}

/**
 * Satu putaran tick: tutup draf yang sudah tidak relevan, buat draf hari ini (08:00-19:59 WIB), lalu kirim otomatis
 * bila `dataRequestApproval = ALWAYS`. Dipanggil dari `POST /api/summary-items/tick`; pemanggil menangkap galat.
 */
export async function createDataRequestDrafts(now: Date = new Date()): Promise<{ created: number; closed: number; sent: number }> {
  const today = jakartaDayKey(now)
  let created = 0
  let closed = 0
  let sent = 0

  // 1. Siklus hidup draf OPEN: trip mulai / data lengkap (kapan saja, tanpa batas jam).
  const open = await prisma.bookingAction.findMany({
    where: { type: 'DATA_REQUEST', state: 'OPEN' },
    select: { id: true, conversationId: true, bookingId: true, forDay: true, conversation: { select: { bookingData: true } } },
  })
  for (const row of open) {
    const booking = asBooking(row.conversation.bookingData)
    if (!booking || row.bookingId === null || currentBookingId(booking) !== row.bookingId) continue
    const days = daysUntil(booking.date?.start_ymd, today)
    if (days !== null && days <= 0) {
      // R24: hari-H sudah dihitung "trip mulai".
      if (await closeOpen(row, 'RESOLVED', 'TRIP_STARTED', now)) closed++
    } else if (findDataGaps(booking).length === 0) {
      if (await closeOpen(row, 'RESOLVED', 'DATA_COMPLETE', now)) closed++
    }
  }

  if (!inDataRequestHours(now)) return { created, closed, sent }

  // 2. Draf hari ini.
  const convs = await prisma.conversation.findMany({
    where: { bookingData: { not: Prisma.DbNull } },
    select: { id: true, bookingData: true, isTest: true, contact: { select: { phone: true } }, channelIdentity: { select: { platform: true } } },
  })
  for (const conv of convs) {
    const booking = asBooking(conv.bookingData)
    if (!booking) continue
    const bookingId = currentBookingId(booking)
    if (bookingId === null) continue
    const days = daysUntil(booking.date?.start_ymd, today)
    if (days === null || days < DATA_REQUEST_DAYS_MIN || days > DATA_REQUEST_DAYS_AHEAD) continue
    if ((conv.channelIdentity?.platform ?? 'WHATSAPP') !== 'WHATSAPP') continue
    const phone = conv.contact?.phone ?? null
    if (!phone) continue
    const gate = { isTest: conv.isTest, phone }
    if (!bookingAutomationAllowed(gate) || blockedByIndonesianGate(gate)) continue
    const gaps = findDataGaps(booking)
    if (gaps.length === 0) continue

    // Satu per booking per hari -- termasuk yang sudah ditolak/terkirim hari ini.
    const existing = await prisma.bookingAction.findFirst({
      where: { bookingId, type: 'DATA_REQUEST', forDay: today },
      select: { id: true },
    })
    if (existing) continue
    // ... dan tidak jika sudah ada pesan permintaan data terkirim hari ini (mis. draf kemarin dikirim manual 07:30).
    if (await sentToday(bookingId, today)) continue

    let row: { id: string }
    try {
      row = await prisma.bookingAction.create({
        data: {
          conversationId: conv.id,
          bookingId,
          type: 'DATA_REQUEST',
          field: 'data_request',
          tier: 'AI',
          proposedValue: gaps,
          draftText: buildDataRequestText(booking, gaps),
          state: 'OPEN',
          forDay: today,
        },
        select: { id: true },
      })
    } catch (error) {
      if (isUniqueViolation(error)) continue
      throw error
    }
    created++
    await recordEvent(prisma, {
      conversationId: conv.id, bookingId, actionId: row.id, event: 'CREATED', actor: 'SYSTEM',
      newValue: { type: 'DATA_REQUEST', fields: gaps, forDay: today },
    })

    // Draf kemarin yang masih OPEN digantikan.
    const older = await prisma.bookingAction.findMany({
      where: { bookingId, type: 'DATA_REQUEST', state: 'OPEN', forDay: { not: today } },
      select: { id: true, conversationId: true, bookingId: true },
    })
    for (const o of older) if (await closeOpen(o, 'SUPERSEDED', 'REPLACED', now)) closed++
    broadcast({ type: 'booking-actions.changed', conversationId: conv.id })
  }

  // 3. Kirim otomatis (ALWAYS): draf OPEN hari ini tanpa kegagalan sebelumnya. Jendela tertutup -> dilewati
  // di sendDataRequest dan dicoba lagi tick berikutnya (tamu mungkin menulis).
  const settings = await prisma.settings.findUnique({ where: { id: 1 }, select: { dataRequestApproval: true } })
  if (settings?.dataRequestApproval === 'ALWAYS') {
    const todays = await prisma.bookingAction.findMany({
      where: { type: 'DATA_REQUEST', state: 'OPEN', forDay: today, lastError: null },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: { id: true },
    })
    const startedAt = Date.now()
    let lookups = 0
    for (const t of todays) {
      // Batas: terkirim, percobaan lookup (berhasil atau tidak -- API booking yang menggantung tidak boleh menahan
      // tick ber-single-flight), dan waktu total. Draf berjendela tertutup tidak memakai lookup, jadi tak menghabiskan jatah.
      if (sent >= MAX_AUTO_SENDS_PER_TICK || lookups >= MAX_AUTO_LOOKUPS_PER_TICK || Date.now() - startedAt >= AUTO_SEND_BUDGET_MS) break
      const res = await sendDataRequest({ actionId: t.id, accountId: null, now, onLookup: () => { lookups++ } })
      if (res.ok) sent++
    }
  }
  return { created, closed, sent }
}
