// Template pesan sistem untuk pratinjau /new. Isi awalnya teks seed asli
// (src/lib/system-templates/seed-data.ts) -- bukan versi yang sudah diedit operator di DB.
// Perubahan di /new hanya tersimpan di browser.
import { SYSTEM_TEMPLATE_SEEDS } from '@/lib/system-templates/seed-data'
import type { AgentKey, Tpl } from './types'

export const TPL_CATS = ['Reminder', 'Konfirmasi', 'Trip', 'Kabar perubahan', 'Internal'] as const
export type TplCat = (typeof TPL_CATS)[number] | 'Lainnya'

const CAT: Record<string, TplCat> = {
  payment_reminder_balance: 'Reminder',
  trip_information: 'Reminder',
  trip_information_airport: 'Reminder',
  trip_information_station: 'Reminder',
  trip_information_hotel: 'Reminder',
  trip_payment_arrangement: 'Reminder',
  crew_reminder_personal: 'Reminder',
  crew_reminder_group: 'Reminder',
  crew_trip_media: 'Reminder',
  internal_bali_transport_reminder: 'Reminder',
  guest_data_followup_portal: 'Reminder',
  booking_pending_payment: 'Konfirmasi',
  payment_method_confirmed_cash: 'Konfirmasi',
  payment_method_confirmed_card: 'Konfirmasi',
  payment_method_confirmed_wise: 'Konfirmasi',
  payment_received_first: 'Konfirmasi',
  payment_received_balance: 'Konfirmasi',
  booking_confirmed_backoffice_jvto: 'Konfirmasi',
  booking_confirmed_backoffice_klook: 'Konfirmasi',
  booking_confirmed_klook_email: 'Konfirmasi',
  guest_data_update_confirmation: 'Konfirmasi',
  trip_concluded: 'Trip',
  trip_daily_itinerary: 'Trip',
  internal_bali_transport_update: 'Kabar perubahan',
  internal_tshirt_update: 'Kabar perubahan',
  vendor_tshirt_size_update: 'Kabar perubahan',
  vendor_booking_change: 'Kabar perubahan',
  hotel_booking_change: 'Kabar perubahan',
  crew_pickup_change: 'Kabar perubahan',
  internal_new_booking: 'Internal',
  internal_bali_transport: 'Internal',
  hotel_room_reservation: 'Internal',
  internal_consent_completed: 'Internal',
}

/** Template yang dikirim agent reminder (sama dengan AGT di mock-data). */
const AGENT: Record<string, AgentKey> = {
  payment_reminder_balance: 'reminder',
  trip_information: 'reminder',
  trip_information_airport: 'reminder',
  trip_information_station: 'reminder',
  trip_information_hotel: 'reminder',
  trip_payment_arrangement: 'reminder',
  trip_concluded: 'reminder',
  crew_reminder_personal: 'crew',
  crew_reminder_group: 'crew',
  internal_bali_transport_reminder: 'vendor',
}

export function tplCategory(key: string): TplCat {
  return CAT[key] || 'Lainnya'
}

export function tplAgent(key: string): AgentKey | undefined {
  return AGENT[key]
}

export function initialTemplates(): Tpl[] {
  return SYSTEM_TEMPLATE_SEEDS.map((t) => ({
    key: t.key,
    name: t.name,
    description: t.description,
    audience: t.audience,
    body: t.body,
    imageUrl: t.imageUrl,
    variables: t.variables.map((v) => ({ ...v })),
    isActive: true,
  }))
}

export function exampleValues(t: Pick<Tpl, 'variables'>): Record<string, string> {
  return Object.fromEntries(t.variables.map((v) => [v.name, v.example ?? '']))
}
