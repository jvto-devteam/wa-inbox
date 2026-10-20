/** @vitest-environment node */
import { afterEach, describe, expect, it } from 'vitest'
import {
  blockedByIndonesianGate,
  bookingActionsRollout,
  bookingActionsTestPhones,
  bookingAutomationAllowed,
  isBookingTestConversation,
} from './rollout'

const WHITELIST = '6282143403501'

afterEach(() => {
  delete process.env.BOOKING_ACTIONS_ROLLOUT
  delete process.env.BOOKING_ACTIONS_TEST_PHONES
})

describe('final review Important 7 (R25): rollout + test phones', () => {
  it("rollout defaults to 'test' (unset, empty, unknown); only exact 'all' opens it", () => {
    expect(bookingActionsRollout()).toBe('test')
    process.env.BOOKING_ACTIONS_ROLLOUT = ''
    expect(bookingActionsRollout()).toBe('test')
    process.env.BOOKING_ACTIONS_ROLLOUT = 'everyone'
    expect(bookingActionsRollout()).toBe('test')
    process.env.BOOKING_ACTIONS_ROLLOUT = ' ALL '
    expect(bookingActionsRollout()).toBe('all')
  })

  it('test phones are a comma list normalized to E.164 digits (+, spaces, dashes, leading 0)', () => {
    process.env.BOOKING_ACTIONS_TEST_PHONES = '+62 821-4340-3501, 0812 3456 789 ,, abc'
    expect([...bookingActionsTestPhones()]).toEqual([WHITELIST, '628123456789'])
  })

  it('a test phone counts as a test conversation; sandbox isTest too; others not', () => {
    process.env.BOOKING_ACTIONS_TEST_PHONES = WHITELIST
    expect(isBookingTestConversation({ isTest: false, phone: WHITELIST })).toBe(true)
    expect(isBookingTestConversation({ isTest: true, phone: '__bot_test__' })).toBe(true)
    expect(isBookingTestConversation({ isTest: false, phone: '6281111111111' })).toBe(false)
    expect(isBookingTestConversation({ isTest: false, phone: null })).toBe(false)
  })

  it('Indonesian gate: 62 numbers blocked unless test conversation/phone; foreign never blocked', () => {
    expect(blockedByIndonesianGate({ isTest: false, phone: WHITELIST })).toBe(true)
    process.env.BOOKING_ACTIONS_TEST_PHONES = WHITELIST
    expect(blockedByIndonesianGate({ isTest: false, phone: WHITELIST })).toBe(false)
    expect(blockedByIndonesianGate({ isTest: false, phone: '6281111111111' })).toBe(true)
    expect(blockedByIndonesianGate({ isTest: false, phone: '4915112345678' })).toBe(false)
    expect(blockedByIndonesianGate({ isTest: true, phone: '6281111111111' })).toBe(false)
  })

  it("automation: while 'test' only test conversations; 'all' = everyone", () => {
    process.env.BOOKING_ACTIONS_TEST_PHONES = WHITELIST
    expect(bookingAutomationAllowed({ isTest: false, phone: '4915112345678' })).toBe(false)
    expect(bookingAutomationAllowed({ isTest: false, phone: WHITELIST })).toBe(true)
    expect(bookingAutomationAllowed({ isTest: true, phone: null })).toBe(true)
    process.env.BOOKING_ACTIONS_ROLLOUT = 'all'
    expect(bookingAutomationAllowed({ isTest: false, phone: '4915112345678' })).toBe(true)
  })
})
