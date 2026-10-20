/**
 * Tipe bentuk-JSON yang dipakai UI tindakan booking (panel Inbox dan antrean /summary).
 * Sengaja tanpa impor Prisma/server supaya aman masuk bundel klien. Bentuknya mengikuti
 * `GET /api/conversations/[id]/booking-actions` dan `GET /api/booking-actions`.
 */
export type BookingActionType = 'CHANGE' | 'TASK' | 'MISMATCH' | 'DATA_REQUEST'

export type BookingImpactView = {
  crewClashes: string[]
  hotelNights: string[]
  medicalCheckupDate: { from: string | null; to: string | null } | null
  unavailable?: true
}

export type BookingActionView = {
  id: string
  conversationId: string
  type: BookingActionType
  field: string
  tier: string
  proposedValue: unknown
  oldValue: string | null
  sourceMessageId: string | null
  createdAt: string
  /** Galat eksekusi terakhir (Task 11); null/undefined bila belum pernah gagal. */
  lastError?: string | null
  /** DATA_REQUEST (Task 12): teks draf ke tamu. */
  draftText?: string | null
  /** DATA_REQUEST: jendela 24 jam tertutup -> tidak boleh kirim teks bebas ("Butuh template"). */
  windowClosed?: boolean
  impact?: BookingImpactView
}

export type BookingActionEventView = {
  id: string
  event: string
  actor: 'BOT' | 'SYSTEM' | 'ACCOUNT'
  accountName: string | null
  reason: string | null
  sourceMessageId?: string | null
  oldValue: unknown
  newValue: unknown
  createdAt: string
}

/** Butir "Disematkan" di tab Ringkasan chat: aksi OPEN CHANGE/TASK/MISMATCH dalam booking saat ini. */
export type PinnedBookingAction = Pick<
  BookingActionView,
  'id' | 'type' | 'field' | 'proposedValue' | 'sourceMessageId' | 'createdAt'
>

/**
 * Aksi CHANGE yang baru diterapkan (manual atau otomatis) dan masih bisa "Batalkan" (Task 11b).
 * Aturan tampil: state EXECUTED dengan `closedAt` dalam `EXECUTED_VISIBLE_MS` terakhir, di booking saat ini.
 */
export const EXECUTED_VISIBLE_MS = 24 * 60 * 60 * 1000

export type BookingExecutedView = {
  id: string
  conversationId: string
  field: string
  tier: string
  /** Nilai yang ditulis. */
  newValue: string | null
  /** Nilai sebelum ditulis (yang akan dikembalikan saat Batalkan); null = tidak diketahui/kosong. */
  oldValue: string | null
  /** EXECUTED = disetujui orang; AUTO_APPLIED = diterapkan otomatis. */
  closedReason: string | null
  closedAt: string | null
  /** false = server akan menolak Batalkan (nilai lama kosong/jam palsu/detail lama kosong): UI tampilkan "Ubah di backoffice". */
  revertable: boolean
}

export type BookingActionsResponse = {
  booking: { id: string; code: string | null; start: string | null; end: string | null } | null
  actions: BookingActionView[]
  /** Baru diterapkan, bisa dibatalkan. Opsional: respons lama tanpa kolom ini tetap dibaca. */
  executed?: BookingExecutedView[]
  history: BookingActionEventView[]
  writeEnabled: boolean
}

/** Baris ringkas antrean /summary: aksi OPEN lintas percakapan. */
export type BookingQueueItem = {
  id: string
  conversationId: string
  contactName: string | null
  type: BookingActionType
  field: string
  proposedValue: unknown
  createdAt: string
}

export const FIELD_LABELS: Record<string, string> = {
  pickup_point: 'Pickup',
  pickup_detail: 'Detail pickup',
  pickup_arrival: 'Kedatangan pickup',
  pickup_time: 'Jam pickup',
  drop_point: 'Drop-off',
  drop_detail: 'Detail drop-off',
  drop_arrival: 'Kedatangan drop-off',
  drop_time: 'Jam drop-off',
  tshirt_sizes: 'Ukuran kaos',
  note: 'Catatan',
  data_request: 'Minta data tamu',
  travel_date: 'Tanggal trip',
  total_pax: 'Jumlah tamu',
  hotel: 'Hotel',
}

/** Ringkasan butir yang diminta pada kartu DATA_REQUEST (`proposedValue` = daftar field), mis. "Jam pickup, Jam drop-off". */
export function dataRequestSummary(proposedValue: unknown): string {
  if (!Array.isArray(proposedValue)) return '-'
  const labels = proposedValue.filter((f): f is string => typeof f === 'string').map((f) => fieldLabel(f))
  return labels.length > 0 ? labels.join(', ') : '-'
}

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field
}

/** Nilai JSON apa pun jadi teks tampil; kosong = tanda pisah. */
export function valueText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '-'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

/**
 * Nilai lama/baru sebuah EVENT riwayat jadi teks terbaca. Selain string polos, event menyimpan objek:
 * `{ field, value }` (penutupan kartu), `{ type, field, value }` (CREATED), `{ type: 'DATA_REQUEST', fields, forDay }`
 * dan `{ messageId, auto }` (DRAFT_SENT). Tidak pernah menampilkan JSON mentah.
 */
export function eventValueText(v: unknown): string {
  if (v === null || v === undefined || typeof v !== 'object') return valueText(v)
  if (Array.isArray(v)) return v.map((x) => eventValueText(x)).join(', ') || '-'
  const o = v as Record<string, unknown>
  if (Array.isArray(o.fields)) {
    const day = typeof o.forDay === 'string' ? ` (untuk ${o.forDay})` : ''
    return `Minta: ${dataRequestSummary(o.fields)}${day}`
  }
  if ('value' in o) {
    const value = valueText(o.value)
    return typeof o.field === 'string' ? `${fieldLabel(o.field)}: ${value}` : value
  }
  if (typeof o.auto === 'boolean') return o.auto ? 'Dikirim otomatis' : 'Dikirim manual'
  const parts = Object.entries(o)
    .filter(([, x]) => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean')
    .map(([k, x]) => `${k}: ${String(x)}`)
  return parts.length > 0 ? parts.join(', ') : '-'
}

/** Kode alasan sistem (closedReason / reason event) dalam bahasa Indonesia; teks bebas tetap apa adanya. */
export const REASON_LABELS: Record<string, string> = {
  MATCHED_IN_BACKOFFICE: 'Sudah sesuai di backoffice',
  CHAT_CORRECTED: 'Tamu mengoreksi di chat',
  DISMISSED_CHAT_WRONG: 'Dilepas: chat yang keliru',
  REPLACED: 'Digantikan usulan yang lebih baru',
  DATA_COMPLETE: 'Data booking sudah lengkap',
  TRIP_STARTED: 'Trip sudah mulai',
  BOOKING_CHANGED: 'Booking percakapan berganti',
  OUT_OF_WINDOW: 'Tanggal trip di luar jendela H-7..H-1',
  MARKED_DONE: 'Ditandai selesai',
  NOT_NEEDED: 'Tidak perlu',
  REJECTED: 'Ditolak',
  REVERTED: 'Dibatalkan',
  EXECUTED: 'Diterapkan',
  AUTO_APPLIED: 'Diterapkan otomatis',
  SENT: 'Terkirim',
  SEND_FAILED: 'Pesan gagal dikirim',
  WINDOW_CLOSED: 'Jendela 24 jam tertutup — kabari tamu manual',
}

export function reasonText(reason: string): string {
  return REASON_LABELS[reason.trim()] ?? reason
}

/**
 * Ruling R16: field tanpa jalur tulis legacy. Kartunya tetap ada, tetapi tidak bisa "Setujui";
 * admin mengubah di backoffice lalu menandai Selesai. Dipakai UI dan API eksekusi bersama.
 */
export const NO_WRITE_FIELDS: readonly string[] = ['note', 'pickup_arrival', 'drop_arrival']

export function canExecuteField(field: string): boolean {
  return !NO_WRITE_FIELDS.includes(field)
}

export type SideField = 'pickup_point' | 'pickup_detail' | 'drop_point' | 'drop_detail'

const SIDE_FIELDS: Record<'pickup' | 'drop', readonly SideField[]> = {
  pickup: ['pickup_point', 'pickup_detail'],
  drop: ['drop_point', 'drop_detail'],
}

/**
 * Ruling R17 + R20: kartu titik <-> detail di sisi yang sama ditulis dalam SATU patch saat salah
 * satunya dieksekusi -- backoffice menulis titik + detail sekaligus, dan klien menolak ganti titik
 * tanpa detail baru. Kartu JAM tidak ikut (R20): tiap perubahan jam disetujui sendiri.
 * Field lain: [].
 */
export function companionFields(field: string): SideField[] {
  for (const fields of Object.values(SIDE_FIELDS)) {
    if ((fields as readonly string[]).includes(field)) return fields.filter((f) => f !== field)
  }
  return []
}

/** Jam palsu dari backoffice (R2); salinan dari compare.ts supaya view.ts tetap tanpa impor server. */
const FAKE_TIME = '07:00'

/**
 * Apakah nilai LAMA ini bisa ditulis balik oleh "Batalkan"? Satu predikat untuk server (`revertBookingAction`)
 * dan UI: kosong/null tidak bisa; jam kosong/palsu ('07:00') tidak bisa.
 */
export function canRevertValue(field: string, oldValue: unknown): boolean {
  if (typeof oldValue !== 'string' || oldValue.trim() === '') return false
  if ((field === 'pickup_time' || field === 'drop_time') && oldValue.trim() === FAKE_TIME) return false
  return true
}

/**
 * "Batalkan" untuk satu batch (kartu yang ditulis bersama) hanya bila SEMUA anggota lolos `canRevertValue`
 * dan detail lama yang tertimpa lewat isian detail (`previousDetail`, objek {pickup_detail|drop_detail: nilai})
 * tidak kosong -- titik baru wajib membawa detail lama (klien menolak sebaliknya).
 */
export function canRevertBatch(members: Array<{ field: string; oldValue: unknown }>, previousDetail?: unknown): boolean {
  if (members.length === 0 || !members.every((m) => canRevertValue(m.field, m.oldValue))) return false
  if (typeof previousDetail === 'object' && previousDetail !== null && !Array.isArray(previousDetail)) {
    return Object.values(previousDetail as Record<string, unknown>).every((v) => typeof v === 'string' && v.trim() !== '')
  }
  return true
}

/** `pickup_point` -> `pickup_detail`; null untuk field selain titik (R19: detail opsional saat eksekusi). */
export function detailFieldOf(field: string): 'pickup_detail' | 'drop_detail' | null {
  if (field === 'pickup_point') return 'pickup_detail'
  if (field === 'drop_point') return 'drop_detail'
  return null
}
