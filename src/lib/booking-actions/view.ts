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
  impact?: BookingImpactView
}

export type BookingActionEventView = {
  id: string
  event: string
  actor: 'BOT' | 'SYSTEM' | 'ACCOUNT'
  accountName: string | null
  reason: string | null
  oldValue: unknown
  newValue: unknown
  createdAt: string
}

export type BookingActionsResponse = {
  booking: { id: string; code: string | null; start: string | null; end: string | null } | null
  actions: BookingActionView[]
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
