/**
 * Web Push ke admin untuk kejadian aksi booking (Task 8b).
 *
 * `notifyBookingAction` TIDAK PERNAH melempar dan dipanggil fire-and-forget sesudah transaksi
 * commit -- kegagalan push tidak boleh menggagalkan webhook/balasan bot. Tanpa env VAPID
 * lengkap ia diam-diam no-op (log satu kali). Kunci privat hanya dibaca di sini, tidak pernah
 * dikirim ke klien dan tidak pernah masuk log.
 *
 * Isi notifikasi: kode booking + ringkasan field/nilai. Nomor HP dan email dibuang
 * (`scrub`); nama tamu tidak pernah dimasukkan oleh pemanggil.
 */
import webpush from 'web-push'
import { prisma } from '@/lib/db'
import { recordEvent } from '@/lib/booking-actions/history'

export type PushPayload = { title: string; body: string; url: string; tag: string }
export type BookingPushKind = 'CHANGE' | 'MISMATCH' | 'TASK' | 'AUTO_APPLIED' | 'EXECUTE_FAILED' | 'DATA_REQUEST_FAILED' | 'GUEST_NOTICE_FAILED'
export type BookingPushEvent = {
  kind: BookingPushKind
  conversationId: string
  bookingCode: string | null
  summary: string
  actionId: string
  /** Pesan sumber; bila ada, notifikasi membuka pesan itu. */
  messageId?: string | null
  /**
   * Alarm "kabari manual" memakai tag sendiri (`booking-action:<id>:<suffix>`): notifikasi bertag sama saling
   * MENGGANTI di HP admin, jadi AUTO_APPLIED berikutnya tidak boleh menghapus alarm kabar tamu/vendor yang gagal.
   */
  tagSuffix?: 'guest' | 'guest-revert' | 'vendor-tshirt' | 'vendor-bali'
}

const TITLES: Record<BookingPushKind, string> = {
  CHANGE: 'Permintaan perubahan booking',
  MISMATCH: 'Data chat beda dengan booking',
  TASK: 'Tugas booking baru',
  AUTO_APPLIED: 'Perubahan booking diterapkan',
  EXECUTE_FAILED: 'Perubahan booking gagal diterapkan',
  DATA_REQUEST_FAILED: 'Permintaan data tamu gagal terkirim',
  GUEST_NOTICE_FAILED: 'Tamu belum dikabari perubahan booking',
}
const MAX_SUMMARY = 100

const FIELD_LABELS: Record<string, string> = {
  pickup_point: 'Titik jemput', pickup_detail: 'Detail jemput', pickup_arrival: 'Kedatangan jemput', pickup_time: 'Jam jemput',
  drop_point: 'Titik antar', drop_detail: 'Detail antar', drop_arrival: 'Kedatangan antar', drop_time: 'Jam antar',
  tshirt_sizes: 'Ukuran kaos', note: 'Catatan', travel_date: 'Tanggal trip', total_pax: 'Jumlah tamu', hotel: 'Hotel',
}

const FREE_TEXT_FIELDS = new Set(['note', 'pickup_detail', 'drop_detail', 'pickup_arrival', 'drop_arrival'])

/** Ringkasan pendek "Titik jemput → Surabaya Hotel". */
export function summarizeAction(field: string, value: string | null): string {
  const label = FIELD_LABELS[field] ?? field
  // Teks bebas dari tamu bisa memuat nama: layar kunci hanya menampilkan labelnya.
  if (FREE_TEXT_FIELDS.has(field)) return `${label} ${field === 'note' ? 'baru' : 'diperbarui'} — buka chat`
  return value ? `${label} → ${value}` : label
}

/** Buang email dan deret angka panjang (nomor HP, termasuk yang berspasi/strip). */
function scrub(text: string): string {
  return text
    .replace(/[^\s@]+@[^\s@]+/g, '…')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, (m) => (m.replace(/\D/g, '').length >= 7 ? '…' : m))
    .replace(/\d{8,}/g, '…')
    .replace(/@/g, '')
}

export function buildPushPayload(e: BookingPushEvent): PushPayload {
  const summary = scrub(e.summary)
  const clipped = summary.length > MAX_SUMMARY ? `${summary.slice(0, MAX_SUMMARY - 1)}…` : summary
  const code = e.bookingCode ? scrub(e.bookingCode) : null
  const params = new URLSearchParams({ conversation: e.conversationId })
  if (e.messageId) params.set('message', e.messageId)
  // Perubahan yang sudah ditulis: pengingat bahwa masih bisa dibatalkan. Ditambahkan SESUDAH pemotongan ringkasan.
  const text = e.kind === 'AUTO_APPLIED' ? `Diterapkan otomatis · ${clipped} — ketuk untuk melihat/batalkan` : clipped
  return {
    title: TITLES[e.kind],
    body: code ? `${code}: ${text}` : text,
    url: `/inbox?${params.toString()}`,
    tag: e.tagSuffix ? `booking-action:${e.actionId}:${e.tagSuffix}` : `booking-action:${e.actionId}`,
  }
}

let warnedUnconfigured = false

function vapidFromEnv(): { subject: string; publicKey: string; privateKey: string } | null {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = process.env
  if (!publicKey || !privateKey || !subject) return null
  return { subject, publicKey, privateKey }
}

/**
 * Penanda `PUSHED` di riwayat kartu: sapuan tick (`pushUnnotifiedChanges`) mengirim ulang push CHANGE hanya untuk
 * kartu OPEN yang belum pernah dikabarkan (push hilang karena proses mati/restart). Dicatat sebelum kirim, juga
 * tanpa VAPID, supaya sapuan tidak berulang tiap tick. Disembunyikan dari tampilan riwayat.
 */
async function markPushed(e: BookingPushEvent): Promise<void> {
  try {
    await recordEvent(prisma, { conversationId: e.conversationId, actionId: e.actionId, event: 'PUSHED', actor: 'SYSTEM', reason: e.kind })
  } catch {
    // recordEvent standalone sudah menelan; sabuk pengaman saja.
  }
}

export async function notifyBookingAction(e: BookingPushEvent): Promise<void> {
  await markPushed(e)
  try {
    const vapid = vapidFromEnv()
    if (!vapid) {
      if (!warnedUnconfigured) {
        warnedUnconfigured = true
        console.warn('push: VAPID belum diisi, notifikasi booking dilewati')
      }
      return
    }
    const subs = await prisma.pushSubscription.findMany()
    if (subs.length === 0) return
    const body = JSON.stringify(buildPushPayload(e))
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
            vapidDetails: vapid,
            TTL: 60 * 60 * 24,
            timeout: 10_000,
          })
          await prisma.pushSubscription.update({ where: { id: s.id }, data: { lastSuccessAt: new Date() } })
        } catch (err) {
          const status = typeof err === 'object' && err !== null ? (err as { statusCode?: unknown }).statusCode : undefined
          if (status === 404 || status === 410) {
            await prisma.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } }).catch(() => undefined)
          } else {
            console.error('push: kirim gagal', typeof status === 'number' ? status : 'error')
          }
        }
      })
    )
  } catch {
    console.error('push: notifyBookingAction gagal')
  }
}
