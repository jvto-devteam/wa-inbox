// Murni, aman untuk klien: dipakai ComposeBox saat operator tiba dari "Follow up" di antrean
// /summary (`&followup=1`). Satu-satunya impor adalah matriks kanal, yang juga tanpa impor.
import { supportsCapability, type OutboundChannel } from '@/lib/bot-control/channel-capabilities'

/**
 * Jendela layanan pelanggan Meta: 24 jam sejak pesan MASUK terakhir. Di luar jendela itu Cloud
 * API hanya menerima template yang disetujui. Ini bukan setelan JVTO, melainkan aturan Meta yang
 * sama dengan yang ditolak Messenger/Instagram lewat code 10 (`src/lib/meta/messenger-send.ts`).
 */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000

/** Waktu pesan INBOUND terakhir di thread, atau null kalau pelanggan belum pernah menulis. */
export function lastInboundAt(messages: ReadonlyArray<{ direction: string; createdAt: string }>): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].direction === 'INBOUND') return messages[i].createdAt
  }
  return null
}

/** Jendela tertutup: tidak ada pesan masuk sama sekali, atau yang terakhir sudah >= 24 jam. */
export function serviceWindowClosed(lastInbound: string | null, now: Date = new Date()): boolean {
  if (!lastInbound) return true
  const last = new Date(lastInbound).getTime()
  if (Number.isNaN(last)) return true
  return now.getTime() - last >= SERVICE_WINDOW_MS
}

/**
 * Apakah follow up di percakapan ini harus lewat template?
 *
 * Tiga syarat, semuanya fakta yang sudah ada di kode, bukan aturan baru:
 * - Platform WhatsApp. Email tidak berjendela; Messenger/Instagram berjendela, tapi jalur kirim
 *   ComposeBox ke sana hanya teks (`sendMessengerMessage`), jadi tidak ada template yang bisa
 *   dibuka.
 * - Kanal kirim bisa membawa template (`send_template` di matriks kanal). Hanya Official yang
 *   tunduk pada jendela Meta; Unofficial (wa-coexist) tidak punya template dan tidak berjendela.
 * - Jendela tertutup: tidak ada pesan masuk sama sekali, atau yang terakhir sudah >= 24 jam.
 */
export function followUpNeedsTemplate(input: {
  platform: string | null
  channel: OutboundChannel
  lastInboundAt: string | null
  now?: Date
}): boolean {
  if ((input.platform ?? 'WHATSAPP') !== 'WHATSAPP') return false
  if (!supportsCapability(input.channel, 'send_template')) return false
  return serviceWindowClosed(input.lastInboundAt, input.now)
}

/**
 * Messenger/Instagram juga berjendela 24 jam, tapi jalur kirimnya hanya teks -- tidak ada template
 * untuk dibuka. Follow up di sana hanya diberi peringatan (Meta menolak dengan code 10, lihat
 * messenger-send.ts); kirim tidak diblokir, karena hitungan di klien bisa meleset dari Meta.
 */
export function followUpWindowWarning(input: { platform: string | null; lastInboundAt: string | null; now?: Date }): boolean {
  if (input.platform !== 'FACEBOOK' && input.platform !== 'INSTAGRAM') return false
  return serviceWindowClosed(input.lastInboundAt, input.now)
}
