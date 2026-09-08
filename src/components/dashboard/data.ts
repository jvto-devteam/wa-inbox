import { isHandoffLogMessage } from '@/lib/message-display'

/**
 * Semua tipe dan semua perhitungan murni milik Beranda, di satu tempat.
 *
 * Panel-panelnya adalah komponen terpisah, tapi keputusan tentang APA yang masuk antrean dan
 * BAGAIMANA lama menunggu dibaca tidak boleh ikut terpecah bersama mereka: tiga panel membaca
 * daftar percakapan yang sama, dan tiga salinan aturan "siapa yang sedang menunggu" adalah tiga
 * kesempatan untuk berbeda pendapat di layar yang sama.
 */

export type Summary = {
  openCount: number
  handoffTodayCount: number
  officialTokenValid: boolean
  unofficialConfigured: boolean
  needsAttention: Array<{ id: string; contactName: string | null; reason: string }>
  remindersDue: Array<{ id: string; note: string; contactName: string | null }>
}

/** Bentuk baris dari GET /api/conversations — hanya field yang dipakai Beranda. */
export type ConversationRow = {
  id: string
  contactName: string | null
  contactPhone: string
  avatarUrl: string | null
  lastMessage: string | null
  lastMessageSentBy: string | null
  lastMessageAt: string
  botEnabled: boolean
  status: string
  isTest: boolean
}

export type DueReminder = {
  id: string
  note: string
  dueAt: string
  contactId: string
  contactName: string | null
}

export type WaitingRow = {
  id: string
  name: string
  avatarUrl: string | null
  preview: string
  /** ISO — waktu pesan terakhir, yaitu titik mulai penantian pelanggan. */
  since: string
  /** Bot sudah menyerah dan belum ada agen yang memegangnya. */
  handedOff: boolean
}

/** Lebih dari sehari tanpa jawaban bukan lagi "antrean", itu masalah. Satu-satunya ambang di sini. */
const STALE_MS = 24 * 60 * 60 * 1000

/**
 * "Menunggu manusia" = tidak ada apa pun yang dikatakan ke pelanggan sejak ia terakhir menulis.
 *
 * Dua bentuk, bukan satu: pesan terakhir milik pelanggan, ATAU pesan terakhir adalah baris log
 * handoff (sentBy BOT, content null — lihat src/lib/message-display.ts). Tanpa cabang kedua,
 * percakapan yang BARU SAJA diserahkan bot — justru yang paling mendesak — akan hilang dari
 * antrean ini, karena baris log itu tercatat sesudah pesan pelanggan.
 */
function awaitsHuman(c: ConversationRow): boolean {
  return (
    c.lastMessageSentBy === 'CUSTOMER' ||
    isHandoffLogMessage({ sentBy: c.lastMessageSentBy, content: c.lastMessage })
  )
}

/**
 * Antrean yang sebenarnya, diurut dari yang paling lama menunggu.
 *
 * `botEnabled` sengaja jadi syarat: kalau bot masih aktif di percakapan itu, ia yang menjawab
 * dalam hitungan detik, dan menaruhnya di sini berarti memanggil agen untuk pekerjaan yang tidak
 * ada. Konsekuensinya jujur dan disebut di strip konteks ("Dipegang bot"), bukan disembunyikan.
 *
 * Percakapan sandbox (`isTest`) dikecualikan — di seberangnya bukan pelanggan, melainkan admin
 * yang sedang menguji bot, dan ia dipin ke atas selamanya sehingga akan menetap di antrean ini.
 */
export function buildWaitingList(summary: Summary, conversations: ConversationRow[]): WaitingRow[] {
  const handedOffIds = new Set(summary.needsAttention.map((n) => n.id))

  return conversations
    .filter((c) => !c.isTest && c.status === 'OPEN' && !c.botEnabled && awaitsHuman(c))
    .map((c) => ({
      id: c.id,
      name: c.contactName ?? c.contactPhone,
      avatarUrl: c.avatarUrl,
      // /api/conversations tidak mengembalikan `type` pesan terakhir, jadi pesan tanpa teks
      // (gambar, stiker, lokasi) tidak bisa diberi penanda "[image]" seperti di Inbox. Lebih
      // baik mengaku daripada menampilkan baris kosong yang terbaca sebagai kerusakan.
      preview: isHandoffLogMessage({ sentBy: c.lastMessageSentBy, content: c.lastMessage })
        ? 'Bot menyerahkan ke agen'
        : (c.lastMessage ?? 'Pesan tanpa teks'),
      since: c.lastMessageAt,
      handedOff: handedOffIds.has(c.id),
    }))
    .sort((a, b) => new Date(a.since).getTime() - new Date(b.since).getTime())
}

/** Percakapan terbuka yang masih dipegang bot — konteks, bukan pekerjaan agen. */
export function countBotHeld(conversations: ConversationRow[]): number {
  return conversations.filter((c) => !c.isTest && c.status === 'OPEN' && c.botEnabled).length
}

/**
 * Lama menunggu, dibaca sekilas: "baru saja" / "12 menit" / "4 jam" / "2 hari".
 *
 * Satu satuan saja, tidak pernah "4 jam 12 menit" — yang dipakai operator untuk memutuskan siapa
 * dibalas duluan adalah besaran kasarnya, dan angka yang lebih pendek membuat kolom kanan tidak
 * bergoyang dari baris ke baris. Selisih negatif (jam mesin melenceng dari jam server) jatuh ke
 * "baru saja", bukan angka minus.
 */
export function formatWait(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 60_000) return 'baru saja'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} menit`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} jam`
  return `${Math.floor(hours / 24)} hari`
}

export function isStale(iso: string, now: Date): boolean {
  return now.getTime() - new Date(iso).getTime() >= STALE_MS
}

/** Reminder: "Pukul 14.00" kalau belum lewat, "Terlambat 2 hari" kalau sudah. */
export function formatDue(iso: string, now: Date): { text: string; late: boolean } {
  const due = new Date(iso)
  if (Number.isNaN(due.getTime())) return { text: '', late: false }
  if (due.getTime() <= now.getTime()) {
    const overdue = formatWait(iso, now)
    // formatWait mengembalikan "baru saja" di bawah satu menit; "Terlambat baru saja" bukan
    // kalimat, jadi menit pertama disebut apa adanya.
    return {
      text: overdue === 'baru saja' ? 'Jatuh tempo sekarang' : `Terlambat ${overdue}`,
      late: true,
    }
  }
  return {
    text: `Pukul ${due.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`,
    late: false,
  }
}

/** "1.240 ms" -> "1,2 dtk". Latensi bot dibaca sebagai rasa sabar pelanggan, bukan sebagai angka mesin. */
export function formatLatency(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} dtk`
}

/** "2026-09-08" -> "8 Sep". Label sumbu grafik harian. */
export function formatDayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00`)
  if (Number.isNaN(d.getTime())) return day
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
}

export function formatNumber(n: number): string {
  return n.toLocaleString('id-ID')
}
