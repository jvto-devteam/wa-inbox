import { afterEach, describe, expect, it } from 'vitest'
import { bookingAutomationAllowed } from '@/lib/booking-actions/rollout'
import { scheduleNoteAllowed, scheduleNoteRolloutAll } from './rollout'

const real = { isTest: false, phone: '6281234567890' }
const whitelisted = { isTest: false, phone: '082143403501' }

afterEach(() => {
  delete process.env.SCHEDULE_NOTE_ROLLOUT
  delete process.env.BOOKING_ACTIONS_ROLLOUT
  delete process.env.BOOKING_ACTIONS_TEST_PHONES
})

describe('scheduleNoteAllowed', () => {
  it('bawaan: hanya percakapan uji/whitelist', () => {
    process.env.BOOKING_ACTIONS_TEST_PHONES = '6282143403501'
    expect(scheduleNoteRolloutAll()).toBe(false)
    expect(scheduleNoteAllowed(real)).toBe(false)
    expect(scheduleNoteAllowed(whitelisted)).toBe(true)
    expect(scheduleNoteAllowed({ isTest: true, phone: null })).toBe(true)
  })

  it('SCHEDULE_NOTE_ROLLOUT=all membuka note untuk semua tanpa membuka rollout aksi booking', () => {
    process.env.SCHEDULE_NOTE_ROLLOUT = ' ALL '
    expect(scheduleNoteAllowed(real)).toBe(true)
    // Rollout aksi booking (ekstraksi, terapkan-otomatis, permintaan data ke tamu) tetap tertutup.
    expect(bookingAutomationAllowed(real)).toBe(false)
  })

  it('bila rollout aksi booking dibuka (all), note ikut terbuka', () => {
    process.env.BOOKING_ACTIONS_ROLLOUT = 'all'
    expect(scheduleNoteAllowed(real)).toBe(true)
  })
})
