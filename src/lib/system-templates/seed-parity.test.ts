import { describe, it, expect } from 'vitest'
import { SYSTEM_TEMPLATE_SEEDS } from './seed-data'
import { renderSystemTemplate, validateTemplateBody } from './render'
import fixtures from './parity-fixtures.json'

/**
 * Replays what the original PHP produced (captured by scripts/check-system-template-parity.ts
 * --write) against the seed bodies, so parity stays checked on machines without PHP.
 */
const byKey = fixtures as Record<string, { variables: Record<string, string | number | null>; text: string }[]>

/**
 * The contract with the calling programs. A key missing here is a send site that has nothing
 * to migrate to; an extra one is a template no caller knows about.
 */
const EXPECTED_KEYS = [
  'booking_confirmed_backoffice_jvto',
  'booking_confirmed_backoffice_klook',
  'booking_confirmed_klook_email',
  'booking_pending_payment',
  'crew_reminder_group',
  'crew_reminder_personal',
  'crew_trip_media',
  'hotel_room_reservation',
  'internal_bali_transport',
  'internal_bali_transport_reminder',
  'internal_consent_completed',
  'internal_new_booking',
  'payment_method_confirmed_card',
  'payment_method_confirmed_cash',
  'payment_method_confirmed_wise',
  'payment_received_balance',
  'payment_received_first',
  'payment_reminder_balance',
  'trip_concluded',
  'trip_daily_itinerary',
  'trip_information',
  'trip_information_airport',
  'trip_information_hotel',
  'trip_information_station',
  'trip_payment_arrangement',
  'vendor_tshirt_size_update',
]

/**
 * Template yang TIDAK pernah ada di PHP, jadi tidak ada keluaran asli untuk dibandingkan.
 * Ditulis di sini supaya "tidak ada fixture" berarti keputusan, bukan fixture yang lupa dibuat:
 * ketiganya lahir 2026-09-23 sebagai varian trip_information per tipe jemput (bandara / stasiun /
 * hotel). Sisa aturan (badan template valid, kunci unik) tetap berlaku untuk mereka.
 */
const KEYS_WITHOUT_PHP_ORIGIN = new Set(['trip_information_airport', 'trip_information_station', 'trip_information_hotel'])

describe('system template seeds', () => {
  it('cover exactly the planned keys', () => {
    expect(SYSTEM_TEMPLATE_SEEDS.map((seed) => seed.key).sort()).toEqual(EXPECTED_KEYS)
  })

  it('have unique keys', () => {
    const keys = SYSTEM_TEMPLATE_SEEDS.map((seed) => seed.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it.each(SYSTEM_TEMPLATE_SEEDS.map((seed) => [seed.key, seed] as const))('%s is a valid template', (_key, seed) => {
    expect(validateTemplateBody(seed.body, seed.variables)).toEqual([])
    expect(seed.key).toMatch(/^[a-z][a-z0-9_]*$/)
  })

  it.each(SYSTEM_TEMPLATE_SEEDS.map((seed) => [seed.key, seed] as const))(
    '%s renders exactly what its PHP original sent',
    (key, seed) => {
      const cases = byKey[key]
      if (KEYS_WITHOUT_PHP_ORIGIN.has(key)) {
        expect(cases, `${key} tidak punya asal PHP, jadi tidak boleh punya fixture paritas`).toBeUndefined()
        return
      }
      expect(cases, `tidak ada fixture paritas untuk ${key}`).toBeDefined()
      for (const c of cases) {
        expect(renderSystemTemplate(seed, c.variables)).toEqual({ ok: true, text: c.text })
      }
    }
  )

  it('has no fixture left over for a template that no longer exists', () => {
    const keys = new Set(SYSTEM_TEMPLATE_SEEDS.map((seed) => seed.key))
    expect(Object.keys(byKey).filter((key) => !keys.has(key))).toEqual([])
  })
})
