/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/bot/llm', () => ({ callLLM: vi.fn() }))

import { callLLM } from '@/lib/bot/llm'
import { bookingContextForLLM, extractBookingSignals, parseExtraction } from './extract'

const ids = ['m1', 'm2', 'm3']

beforeEach(() => {
  vi.mocked(callLLM).mockReset()
})

describe('parseExtraction', () => {
  it('drops unknown field and keeps the rest', () => {
    const raw = JSON.stringify({
      changes: [
        { field: 'wifi_password', value: 'x', pesan: 1 },
        { field: 'pickup_time', value: '9 pagi', pesan: 2 },
      ],
      facts: [{ field: 'total_pax', value: 5, pesan: '#3' }],
    })
    expect(parseExtraction(raw, ids)).toEqual({
      changes: [{ field: 'pickup_time', value: '09:00', messageId: 'm2' }],
      facts: [{ field: 'total_pax', value: '5', messageId: 'm3' }],
    })
  })
  it('drops pickup_point outside POINT_VALUES', () => {
    const raw = JSON.stringify({ changes: [{ field: 'pickup_point', value: 'Malang Station', pesan: 1 }], facts: [] })
    expect(parseExtraction(raw, ids).changes).toEqual([])
  })
  it('drops total_pax "0" and "abc"', () => {
    const raw = JSON.stringify({
      changes: [],
      facts: [
        { field: 'total_pax', value: '0', pesan: 1 },
        { field: 'total_pax', value: 'abc', pesan: 2 },
      ],
    })
    expect(parseExtraction(raw, ids).facts).toEqual([])
  })
  it('maps #N to messageId and drops invalid N', () => {
    const raw = JSON.stringify({
      changes: [],
      facts: [
        { field: 'note', value: 'a', pesan: 1 },
        { field: 'note', value: 'b', pesan: 9 },
        { field: 'note', value: 'c', pesan: 0 },
        { field: 'note', value: 'd' },
      ],
    })
    expect(parseExtraction(raw, ids).facts).toEqual([{ field: 'note', value: 'a', messageId: 'm1' }])
  })
  it('returns empty on non-JSON and tolerates a code fence and missing arrays', () => {
    expect(parseExtraction('maaf tidak bisa', ids)).toEqual({ changes: [], facts: [] })
    expect(parseExtraction('[]', ids)).toEqual({ changes: [], facts: [] })
    const fenced = '```json\n' + JSON.stringify({ facts: [{ field: 'note', value: 'a', pesan: 1 }] }) + '\n```'
    expect(parseExtraction(fenced, ids)).toEqual({ changes: [], facts: [{ field: 'note', value: 'a', messageId: 'm1' }] })
  })
})

const WHITELIST = ['pickup', 'dropoff', 'date', 'total_pax', 'hotels', 'tshirtSize']

describe('bookingContextForLLM', () => {
  it('never includes financial/guestDetails', () => {
    const ctx = bookingContextForLLM({
      guest: 'Budi',
      financial: { payment: 1, balance: 2 },
      guestDetails: { email: 'a@b.c', phone: '62812' },
      expense: { total: 1 },
      paymentHistory: [],
      total_pax: 2,
      pickup: { meeting_point: 'Surabaya Airport', text: 'x' },
      hotels: [{ day: '1', checkIn: '3 Nov', hotel: 'H', rooms: [{ roomName: 'Deluxe' }], hotelId: 5 }],
    })
    for (const k of Object.keys(ctx)) expect(WHITELIST).toContain(k)
    expect(JSON.stringify(ctx)).not.toMatch(/a@b\.c|62812|Deluxe|Budi/)
    expect(ctx.hotels).toEqual([{ day: '1', checkIn: '3 Nov', hotel: 'H' }])
  })
})

describe('extractBookingSignals', () => {
  const input = { transcript: { text: '#1 Tamu: kami berlima', ids: ['m1'] }, booking: { total_pax: 2 } }

  it('calls the LLM with a timeout and parses the answer', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ changes: [], facts: [{ field: 'total_pax', value: '5', pesan: 1 }] }))
    const out = await extractBookingSignals(input)
    expect(out?.facts).toEqual([{ field: 'total_pax', value: '5', messageId: 'm1' }])
    const opts = vi.mocked(callLLM).mock.calls[0][1]
    expect(opts?.timeoutMs).toBe(20_000)
    expect(opts?.system).toBeTruthy()
  })
  it('returns null on technical failure', async () => {
    vi.mocked(callLLM).mockRejectedValue(new Error('timeout'))
    expect(await extractBookingSignals(input)).toBeNull()
  })
})
