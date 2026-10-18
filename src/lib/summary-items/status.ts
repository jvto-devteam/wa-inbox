/**
 * Status tindak lanjut satu `SummaryItem` sebagaimana dikirim ke klien, plus kalimat status yang
 * ditampilkan. Dipakai tab "Ringkasan chat" di Inbox dan tampilan per tanggal di /summary --
 * satu modul supaya label "Belum dijawab"/"Dilepas"/dst. tidak bisa berbeda di dua tempat.
 *
 * Aman untuk klien: tidak mengimpor prisma atau modul server apa pun.
 */

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

/** Waktu ISO sebagai hari, tanggal, dan jam WIB, mis. "Sen, 19 Okt, 09.00 WIB". */
export function wibDateTimeLabel(iso: string): string {
  const text = new Date(iso).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${text} WIB`
}

const CLOSED_REASON_LABEL: Record<string, string> = {
  REPLIED: 'dibalas',
  REMINDER_DONE: 'pengingat selesai',
  STAGE_ADVANCED: 'tahap pipeline naik',
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
      return item.kind === 'REPLY'
        ? { label: 'Belum dijawab', detail: null, variant: 'destructive' }
        : { label: 'Perlu follow up', detail: null, variant: 'warning' }
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
