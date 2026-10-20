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
  travel_date: 'Tanggal trip',
  total_pax: 'Jumlah tamu',
  hotel: 'Hotel',
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

/** `pickup_point` -> `pickup_detail`; null untuk field selain titik (R19: detail opsional saat eksekusi). */
export function detailFieldOf(field: string): 'pickup_detail' | 'drop_detail' | null {
  if (field === 'pickup_point') return 'pickup_detail'
  if (field === 'drop_point') return 'drop_detail'
  return null
}
