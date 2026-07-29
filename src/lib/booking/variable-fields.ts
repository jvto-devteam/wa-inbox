import type { BookingData } from './client'
import { formatIDR } from '@/lib/contact-format'

export type VariableFieldContext = { contactName: string | null; bookingData: BookingData | null }
export type VariableFieldDef = { key: string; label: string; resolve: (ctx: VariableFieldContext) => string | null }
export type VariableField = { key: string; label: string; value: string }

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

const MAX_HOTEL_DAYS = 10
const MAX_CREW = 3

// A fixed, stable-keyed registry of every field a template variable can be bound to -- "columns
// that exist in the booking API response," per the user's own framing -- rather than a per-
// conversation ad-hoc flatten. Stability matters: a binding is chosen ONCE, at template-creation
// time (see /templates), and must resolve correctly against a DIFFERENT conversation's data
// every time that template is later sent, so the key has to mean the same thing across bookings
// even though the actual value differs per customer.
export const VARIABLE_FIELD_DEFS: VariableFieldDef[] = [
  { key: 'contactName', label: 'Nama Kontak (WhatsApp)', resolve: (c) => str(c.contactName) },
  { key: 'guest', label: 'Nama Kontak (Booking)', resolve: (c) => str(c.bookingData?.guest) },
  { key: 'package', label: 'Nama Paket', resolve: (c) => str(c.bookingData?.package) },
  { key: 'totalPax', label: 'Jumlah Pax', resolve: (c) => (c.bookingData?.total_pax != null ? String(c.bookingData.total_pax) : null) },
  { key: 'duration', label: 'Durasi', resolve: (c) => str(c.bookingData?.duration) },
  { key: 'bookingDate', label: 'Tanggal Booking', resolve: (c) => str(c.bookingData?.booking_date) },
  { key: 'dateStart', label: 'Tanggal Mulai', resolve: (c) => str(c.bookingData?.date?.start) ?? str(c.bookingData?.date?.start_ymd) },
  { key: 'dateEnd', label: 'Tanggal Selesai', resolve: (c) => str(c.bookingData?.date?.end) ?? str(c.bookingData?.date?.end_ymd) },
  { key: 'pickupText', label: 'Titik Jemput', resolve: (c) => str(c.bookingData?.pickup?.text) },
  { key: 'dropoffText', label: 'Titik Antar', resolve: (c) => str(c.bookingData?.dropoff?.text) },
  {
    key: 'financialPayment',
    label: 'Sudah Dibayar',
    resolve: (c) => (c.bookingData?.financial?.payment != null ? formatIDR(c.bookingData.financial.payment) : null),
  },
  {
    key: 'financialBalance',
    label: 'Sisa Tagihan',
    resolve: (c) => (c.bookingData?.financial?.balance != null ? formatIDR(c.bookingData.financial.balance) : null),
  },
  ...Array.from({ length: MAX_HOTEL_DAYS }, (_, i) => ({
    key: `hotel:${i + 1}`,
    label: `Nama Hotel (Hari ${i + 1})`,
    resolve: (c: VariableFieldContext) => str(c.bookingData?.hotels?.[i]?.hotel),
  })),
  ...Array.from({ length: MAX_CREW }, (_, i) => ({
    key: `guide:${i + 1}`,
    label: `Nama Kru ${i + 1}`,
    resolve: (c: VariableFieldContext) => str(c.bookingData?.guides?.[i]?.name),
  })),
  ...Array.from({ length: MAX_CREW }, (_, i) => ({
    key: `driver:${i + 1}`,
    label: `Nama Transportasi/Sopir ${i + 1}`,
    resolve: (c: VariableFieldContext) => str(c.bookingData?.drivers?.[i]?.name),
  })),
]

const DEFS_BY_KEY = new Map(VARIABLE_FIELD_DEFS.map((d) => [d.key, d]))

/** Send-time lookup: resolves a binding chosen at template-creation time against THIS conversation's data. */
export function resolveVariableField(key: string, contactName: string | null, bookingData: BookingData | null): string | null {
  return DEFS_BY_KEY.get(key)?.resolve({ contactName, bookingData }) ?? null
}

/**
 * Every field that actually has a value for this conversation, as {key, label, value} --
 * backs the manual "Isi dari data..." picker for a variable that was left unbound at
 * template-creation time (see ComposeBox).
 */
export function bookingVariableFields(contactName: string | null, bookingData: BookingData | null): VariableField[] {
  const out: VariableField[] = []
  for (const def of VARIABLE_FIELD_DEFS) {
    const value = def.resolve({ contactName, bookingData })
    if (value != null) out.push({ key: def.key, label: def.label, value })
  }
  return out
}
