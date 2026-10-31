/** Tipe dan perhitungan murni milik Beranda, di satu tempat. */

export type ChannelStatus = {
  officialTokenValid: boolean
  unofficialConfigured: boolean
}

export type DueReminder = {
  id: string
  note: string
  dueAt: string
  contactId: string
  contactName: string | null
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

export function formatNumber(n: number): string {
  return n.toLocaleString('id-ID')
}
