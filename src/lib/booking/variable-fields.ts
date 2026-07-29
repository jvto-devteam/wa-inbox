import type { BookingData } from './client'
import { formatIDR } from '@/lib/contact-format'

export type VariableField = { label: string; value: string }

// Friendly Indonesian labels for the well-known top-level/nested fields the real JVTO booking
// API returns (see BookingData's header comment) -- everything else still shows up (see
// flattenUnknown below), just under a machine-derived label, so a field JVTO adds later is
// still pickable without a code change here.
const KNOWN_LABELS: Record<string, string> = {
  guest: 'Nama Kontak (Booking)',
  package: 'Nama Paket',
  total_pax: 'Jumlah Pax',
  duration: 'Durasi',
  booking_date: 'Tanggal Booking',
  orderChannel: 'Channel Order',
  'date.start': 'Tanggal Mulai',
  'date.end': 'Tanggal Selesai',
  'pickup.text': 'Titik Jemput',
  'dropoff.text': 'Titik Antar',
  'guestDetails.email': 'Email',
  'guestDetails.country': 'Negara Asal',
  'guestDetails.phone': 'Telepon (Booking)',
}

function humanizePath(path: string): string {
  return path
    .split('.')
    .map((seg) => seg.replace(/_/g, ' '))
    .join(' — ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// Generic fallback for anything not covered by the known-array/known-label handling below --
// this is what keeps the picker "dinamis" (the user's own word): a field the JVTO API adds
// tomorrow shows up here today, labeled from its own path rather than needing a code change.
function flattenUnknown(value: unknown, path: string, skip: Set<string>, out: VariableField[]) {
  if (skip.has(path.split('.')[0])) return
  if (value == null) return
  if (typeof value === 'string' || typeof value === 'number') {
    if (String(value).trim() === '') return
    out.push({ label: KNOWN_LABELS[path] ?? humanizePath(path), value: String(value) })
    return
  }
  if (Array.isArray(value)) return // arrays without bespoke handling aren't a single insertable value
  if (typeof value === 'object') {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      flattenUnknown(v, path ? `${path}.${key}` : key, skip, out)
    }
  }
}

/**
 * Flattens a conversation's contact name + real booking payload into a picklist of
 * {label, value} pairs an agent can insert into a template variable or a quick-reply body --
 * covers both OFFICIAL (Cloud API {{n}} params) and QUICK_REPLY (plain-text {{n}}) templates,
 * since both just need a string value per placeholder.
 */
export function bookingVariableFields(contactName: string | null, bookingData: BookingData | null): VariableField[] {
  const out: VariableField[] = []
  if (contactName) out.push({ label: 'Nama Kontak (WhatsApp)', value: contactName })
  if (!bookingData) return out

  const balance = bookingData.financial?.balance
  if (balance != null) out.push({ label: 'Sisa Tagihan', value: formatIDR(balance) })
  const payment = bookingData.financial?.payment
  if (payment != null) out.push({ label: 'Sudah Dibayar', value: formatIDR(payment) })

  for (const stay of bookingData.hotels ?? []) {
    if (stay.hotel) out.push({ label: `Nama Hotel (Hari ${stay.day ?? '-'})`, value: stay.hotel })
  }
  for (const guide of bookingData.guides ?? []) {
    const name = guide.name
    if (typeof name === 'string' && name.trim()) out.push({ label: 'Nama Kru', value: name })
  }
  for (const driver of bookingData.drivers ?? []) {
    const name = driver.name
    if (typeof name === 'string' && name.trim()) out.push({ label: 'Nama Transportasi/Sopir', value: name })
  }

  // financial/hotels/guides/drivers already handled above with bespoke labels -- skip them in
  // the generic pass so every field doesn't show twice under two different labels.
  flattenUnknown(bookingData, '', new Set(['financial', 'hotels', 'guides', 'drivers', 'itinerary']), out)

  return out
}
