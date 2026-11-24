// Riwayat Agent /new (DATA ASLI): pemetaan murni dari log yang sudah ada ke aktivitas per agent.
// Tidak ada tabel baru; kueri ada di src/app/api/new/agent-activity/route.ts.
//   balas    <- BotDecisionRun (REPLIED/CLARIFIED/HANDOFF/FAILED) + BookingActionEvent GUEST_ACK/GUEST_NOTICE
//   poin     <- Conversation.chatReviewAt (ringkasan chat diperbarui)
//   ringkas  <- DailySummary (job harian)
//   note     <- BookingActionEvent EXECUTED/EXECUTE_FAILED oleh SYSTEM/BOT (data booking diperbarui dari chat)
//   reminder/crew/vendor <- OutboundJob ber-templateKey (TEMPLATE_AGENT) + VENDOR_NOTICE_FAILED
//   lead     <- belum ada di sistem
// Nomor telepon/target tidak pernah ikut keluar; hanya nama kontak.
import type { AgentKey } from './types'

export type ActStatus = 'ok' | 'gagal' | 'tunggu' | 'batal'

export interface Activity {
  id: string
  at: string
  agent: AgentKey
  status: ActStatus
  title: string
  input: string
  output: string
  conversationId: string | null
  contact: string | null
  /** Bukti: pesan yang dikirim agent (teks persis seperti terkirim, gambar bila ada) dan tujuannya. */
  message?: { text: string; imageUrl: string | null; to: string }
  /** Pesan tamu yang dijawab (khusus Balas pesan). */
  inbound?: string
  /** Keterangan bila tidak ada percakapan di Inbox (mis. dikirim ke grup). */
  chatNote?: string
  /** Rujukan booking dari kunci idempotensi pengirim (legacy: "<template>:<booking>:<tanggal>"). */
  bookingRef?: string
}

/**
 * Nomor booking dari kunci idempotensi pesan sistem. Legacy menulis "<template>:<bookingId>[:...]" atau
 * "<template>:booking-<id>:<tanggal>"; "addon-<id>" bukan booking. Hanya angka yang diterima.
 */
export function bookingRefOf(key: string | null | undefined): string | undefined {
  const seg = (key ?? '').split(':')[1] ?? ''
  const m = /^(?:booking-)?(\d{1,10})$/.exec(seg)
  return m ? m[1] : undefined
}

/** Template pesan sistem yang dikirim agent reminder (tamu), crew, dan vendor. */
export const TEMPLATE_AGENT: Record<string, AgentKey> = {
  payment_reminder_balance: 'reminder',
  trip_information: 'reminder',
  trip_information_airport: 'reminder',
  trip_information_station: 'reminder',
  trip_information_hotel: 'reminder',
  trip_payment_arrangement: 'reminder',
  trip_concluded: 'reminder',
  guest_data_followup_portal: 'reminder',
  crew_reminder_personal: 'crew',
  crew_reminder_group: 'crew',
  crew_trip_media: 'crew',
  crew_pickup_change: 'crew',
  crew_chat_unreplied_reminder: 'crew',
  internal_bali_transport_reminder: 'vendor',
  internal_bali_transport_update: 'vendor',
  internal_tshirt_update: 'vendor',
  vendor_tshirt_size_update: 'vendor',
  vendor_booking_change: 'vendor',
  hotel_booking_change: 'vendor',
}

const TARGET: Record<AgentKey, string> = {
  balas: 'tamu', poin: 'tim', note: 'booking', ringkas: 'tim', reminder: 'tamu', crew: 'crew', vendor: 'vendor', lead: 'calon tamu',
}

const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

export interface RunRow { id: string; conversationId: string; status: string; inboundText: string; replyText: string | null; error: string | null; startedAt: Date }
const RUN: Record<string, [ActStatus, string]> = {
  REPLIED: ['ok', 'Membalas pesan tamu'],
  CLARIFIED: ['ok', 'Bertanya balik ke tamu'],
  HANDOFF: ['tunggu', 'Menyerahkan chat ke tim'],
  FAILED: ['gagal', 'Gagal menjawab'],
}
export function fromRun(r: RunRow, contact: string | null): Activity | null {
  const m = RUN[r.status]
  if (!m) return null
  return {
    id: 'run:' + r.id, at: r.startedAt.toISOString(), agent: 'balas', status: m[0], title: m[1],
    input: 'Pesan tamu: "' + clip(r.inboundText, 200) + '"',
    output: r.status === 'FAILED' ? 'Galat: ' + clip(r.error, 200) : r.status === 'HANDOFF' ? 'Chat diteruskan ke tim' + (r.replyText ? '; balasan: "' + clip(r.replyText, 240) + '"' : '') : 'Balasan: "' + clip(r.replyText, 300) + '"',
    conversationId: r.conversationId, contact,
    inbound: r.inboundText,
    ...(r.replyText ? { message: { text: r.replyText, imageUrl: null, to: 'Tamu' + (contact ? ' · ' + contact : '') } } : {}),
  }
}

/** Nomor hanya 4 digit akhir; grup ditandai sebagai grup. */
export function targetLabel(target: string | null, agent: AgentKey, contact: string | null): string {
  const who = agent === 'crew' ? 'Crew' : agent === 'vendor' ? 'Vendor' : 'Tamu'
  if (!target) return who + (contact ? ' · ' + contact : '')
  if (target.startsWith('grup:')) return 'Grup WhatsApp ' + who.toLowerCase()
  const d = target.replace(/\D/g, '')
  return who + (contact ? ' · ' + contact : '') + (d ? ' · ••• ' + d.slice(-4) : '')
}

export interface JobPayload { text?: unknown; media?: { url?: unknown } | null }

export interface JobRow { id: string; conversationId: string | null; templateKey: string | null; status: string; lastError: string | null; createdAt: Date; target?: string | null; payload?: unknown; idempotencyKey?: string | null }
export function fromJob(j: JobRow, contact: string | null, templateName: string | undefined, chatId: string | null = j.conversationId): Activity | null {
  const agent = j.templateKey ? TEMPLATE_AGENT[j.templateKey] : undefined
  if (!agent) return null
  const status: ActStatus = j.status === 'SENT' ? 'ok' : j.status === 'FAILED' ? 'gagal' : j.status === 'CANCELLED' ? 'batal' : 'tunggu'
  return {
    id: 'job:' + j.id, at: j.createdAt.toISOString(), agent, status,
    title: templateName || j.templateKey!,
    input: 'Template ' + j.templateKey + ' ke ' + TARGET[agent],
    output: status === 'ok' ? 'Terkirim' : status === 'gagal' ? 'Gagal terkirim' + (j.lastError ? ': ' + clip(j.lastError, 200) : '') : status === 'batal' ? 'Dibatalkan' : 'Dalam antrean (' + j.status.toLowerCase() + ')',
    conversationId: chatId, contact,
    ...messageOf(j, agent, contact),
    ...(bookingRefOf(j.idempotencyKey) ? { bookingRef: bookingRefOf(j.idempotencyKey) } : {}),
    ...(!chatId ? { chatNote: j.target?.startsWith('grup:') ? 'Dikirim ke grup WhatsApp; grup tidak tampil di Inbox.' : 'Nomor tujuan belum punya percakapan di Inbox.' } : {}),
  }
}

function messageOf(j: JobRow, agent: AgentKey, contact: string | null): Pick<Activity, 'message'> {
  const p = (j.payload ?? {}) as JobPayload
  if (typeof p.text !== 'string' || !p.text) return {}
  const img = p.media && typeof p.media.url === 'string' ? p.media.url : null
  return { message: { text: p.text, imageUrl: img, to: targetLabel(j.target ?? null, agent, contact) } }
}

export interface EventRow { id: string; conversationId: string; event: string; actor: string; reason: string | null; createdAt: Date }
const FIELD_TEXT: Record<string, string> = {
  pickup_point: 'titik jemput', pickup_detail: 'detail jemput', pickup_arrival: 'kedatangan jemput', pickup_time: 'jam jemput',
  drop_point: 'titik antar', drop_detail: 'detail antar', drop_arrival: 'kedatangan antar', drop_time: 'jam antar',
  tshirt_sizes: 'ukuran kaos', note: 'catatan', travel_date: 'tanggal trip', total_pax: 'jumlah pax', hotel: 'hotel',
}
export function fromEvent(e: EventRow, contact: string | null, field: string | undefined): Activity | null {
  const f = field ? FIELD_TEXT[field] || field : 'data booking'
  const base = { id: 'ev:' + e.id, at: e.createdAt.toISOString(), conversationId: e.conversationId, contact }
  const auto = e.actor === 'SYSTEM' || e.actor === 'BOT'
  switch (e.event) {
    case 'EXECUTED':
      return auto ? { ...base, agent: 'note', status: 'ok', title: 'Booking diperbarui dari chat: ' + f, input: 'Permintaan tamu di chat', output: 'Ditulis ke backoffice' } : null
    case 'EXECUTE_FAILED':
      return { ...base, agent: 'note', status: 'gagal', title: 'Gagal memperbarui ' + f, input: 'Permintaan tamu di chat', output: clip(e.reason, 200) || 'Backoffice menolak atau tidak bisa dihubungi' }
    case 'GUEST_ACK_SENT':
      return { ...base, agent: 'balas', status: 'ok', title: 'Tanda terima permintaan ke tamu', input: 'Tamu meminta perubahan booking', output: '"Permintaan sudah kami terima" terkirim' }
    case 'GUEST_NOTICE_SENT':
      return { ...base, agent: 'balas', status: 'ok', title: 'Kabar ke tamu: booking sudah diperbarui', input: 'Perubahan ' + f + ' tertulis', output: 'Kabar terkirim' }
    case 'GUEST_NOTICE_FAILED':
      return { ...base, agent: 'balas', status: 'gagal', title: 'Kabar ke tamu gagal terkirim', input: 'Perubahan ' + f + ' tertulis', output: clip(e.reason, 200) || 'Kabari tamu manual' }
    case 'VENDOR_NOTICE_FAILED':
      return { ...base, agent: 'vendor', status: 'gagal', title: 'Kabar ke vendor gagal', input: 'Perubahan ' + f, output: clip(e.reason, 200) || 'Vendor perlu dikabari manual' }
    default:
      return null
  }
}

export function fromReview(c: { id: string; chatReviewAt: Date; points: number; open: boolean }, contact: string | null): Activity {
  return {
    id: 'rev:' + c.id + ':' + c.chatReviewAt.getTime(), at: c.chatReviewAt.toISOString(), agent: 'poin', status: 'ok',
    title: 'Poin penting diperbarui', input: 'Transkrip chat terbaru',
    output: c.points + ' poin penting' + (c.open ? ' · masih perlu tindakan' : ' · selesai'),
    conversationId: c.id, contact,
  }
}

export function fromSummary(d: { id: string; date: string; status: string; error: string | null; startedAt: Date }): Activity {
  const status: ActStatus = d.status === 'DONE' ? 'ok' : d.status === 'FAILED' ? 'gagal' : d.status === 'PARTIAL' ? 'ok' : 'tunggu'
  return {
    id: 'sum:' + d.id, at: d.startedAt.toISOString(), agent: 'ringkas', status,
    title: 'Ringkasan harian ' + d.date, input: 'Semua percakapan aktif hari itu',
    output: d.status === 'FAILED' ? 'Gagal: ' + clip(d.error, 200) : d.status === 'PARTIAL' ? 'Sebagian percakapan gagal diringkas' : d.status === 'DONE' ? 'Selesai' : 'Sedang berjalan',
    conversationId: null, contact: 'Semua percakapan',
  }
}

export function sortActivities(a: Activity[]): Activity[] {
  return [...a].sort((x, y) => y.at.localeCompare(x.at))
}
