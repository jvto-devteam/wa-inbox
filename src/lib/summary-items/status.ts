/**
 * Status tindak lanjut satu `SummaryItem` sebagaimana dikirim ke klien, plus kalimat status yang
 * ditampilkan. Dipakai tab "Ringkasan chat" di Inbox dan tampilan per tanggal di /summary --
 * satu modul supaya label "Belum dijawab"/"Dilepas"/dst. tidak bisa berbeda di dua tempat.
 *
 * Aman untuk klien: tidak mengimpor prisma atau modul server apa pun.
 */

/**
 * Jenis item antrean. REPLY = pelanggan menunggu balasan; FOLLOW_UP = pelanggan diam sesudah
 * pesan kita; PROMISE = tim menjanjikan sesuatu yang menurut ringkasan belum ditepati.
 */
export const SUMMARY_ITEM_KINDS = ['REPLY', 'FOLLOW_UP', 'PROMISE'] as const
export type SummaryItemKind = (typeof SUMMARY_ITEM_KINDS)[number]

const KIND_LABEL: Record<SummaryItemKind, string> = {
  REPLY: 'Belum dibalas',
  FOLLOW_UP: 'Follow up',
  PROMISE: 'Janji tim',
}

/** Label jenis item; jenis yang tidak dikenal tampil apa adanya. */
export function summaryItemKindLabel(kind: string): string {
  return (KIND_LABEL as Record<string, string>)[kind] ?? kind
}

export type SummaryItemStatus = {
  id: string
  kind: string
  state: string
  dueAt: string | null
  closedReason: string | null
  note: string | null
  closedAt: string | null
}

export type SummaryItemStatusRow = {
  id: string
  kind: string
  state: string
  dueAt: Date | null
  closedReason: string | null
  note: string | null
  closedAt: Date | null
}

export function toSummaryItemStatus(row: SummaryItemStatusRow): SummaryItemStatus {
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    closedReason: row.closedReason,
    note: row.note,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
  }
}

/**
 * Waktu ISO sebagai hari, tanggal, dan jam WIB, mis. "Sen, 19 Okt, 09.00 WIB". `compact` membuang
 * hari dan akhiran: "19 Okt 09.00". `hourCycle: 'h23'` agar tengah malam tampil "00.xx", bukan "24.xx".
 */
export function wibDateTimeLabel(iso: string, opts: { compact?: boolean } = {}): string {
  const text = new Date(iso).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    ...(opts.compact ? {} : { weekday: 'short' }),
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  return opts.compact ? text.replace(',', '') : `${text} WIB`
}

const CLOSED_REASON_LABEL: Record<string, string> = {
  REPLIED: 'dibalas',
  REMINDER_DONE: 'pengingat selesai',
  STAGE_ADVANCED: 'tahap pipeline naik',
  PROMISE_KEPT: 'janji ditepati',
  JUDGED_DONE: 'dinilai selesai',
}

export type FollowUpStatus = {
  label: string
  detail: string | null
  variant: 'destructive' | 'warning' | 'success' | 'muted'
}

/** Satu kalimat status untuk item antrean sebuah percakapan (null = tidak pernah masuk antrean). */
export function followUpStatus(item: SummaryItemStatus | null): FollowUpStatus {
  if (!item) return { label: 'Tidak ada di antrean', detail: null, variant: 'muted' }
  switch (item.state) {
    case 'OPEN':
      if (item.kind === 'REPLY') return { label: 'Belum dijawab', detail: null, variant: 'destructive' }
      if (item.kind === 'PROMISE') return { label: 'Janji belum ditepati', detail: null, variant: 'warning' }
      return { label: 'Perlu follow up', detail: null, variant: 'warning' }
    case 'SCHEDULED':
      return { label: item.dueAt ? `Dijadwalkan ${wibDateTimeLabel(item.dueAt)}` : 'Dijadwalkan', detail: null, variant: 'muted' }
    case 'DONE':
      return {
        label: 'Sudah ditindaklanjuti',
        detail: item.closedReason ? (CLOSED_REASON_LABEL[item.closedReason] ?? item.closedReason) : null,
        variant: 'success',
      }
    case 'DROPPED':
      return { label: 'Dilepas', detail: item.note, variant: 'muted' }
    default:
      return { label: item.state, detail: null, variant: 'muted' }
  }
}

/** Item yang masih bisa diingatkan atau dilepas. */
export function isActionable(item: SummaryItemStatus | null): item is SummaryItemStatus {
  return item !== null && (item.state === 'OPEN' || item.state === 'SCHEDULED')
}
