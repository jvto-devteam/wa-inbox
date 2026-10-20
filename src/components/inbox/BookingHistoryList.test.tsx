import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BookingHistoryList } from './BookingHistoryList'
import type { BookingActionEventView } from '@/lib/booking-actions/view'

const ev = (over: Partial<BookingActionEventView>): BookingActionEventView => ({
  id: 'e1', event: 'RESOLVED', actor: 'SYSTEM', accountName: null, reason: null, oldValue: null, newValue: null, createdAt: '2026-10-20T03:00:00Z', ...over,
})

describe('BookingHistoryList (final review cheap minor)', () => {
  it('labels VENDOR_NOTICE_FAILED, translates reason codes and renders object values as text', () => {
    render(
      <BookingHistoryList
        events={[
          ev({ id: 'e1', event: 'VENDOR_NOTICE_FAILED', reason: 'Kabar ke vendor Bali gagal (CANCELLED)' }),
          ev({ id: 'e2', event: 'RESOLVED', reason: 'MATCHED_IN_BACKOFFICE', oldValue: { field: 'pickup_time', value: '09:00' } }),
          ev({ id: 'e3', event: 'CREATED', actor: 'BOT', newValue: { type: 'CHANGE', field: 'pickup_point', value: 'Surabaya Hotel' } }),
        ]}
      />
    )
    expect(screen.getByText('Kabar vendor gagal')).toBeTruthy()
    expect(screen.getByText('Sudah sesuai di backoffice')).toBeTruthy()
    expect(screen.getByText('Jam pickup: 09:00 → -')).toBeTruthy()
    expect(screen.getByText('- → Pickup: Surabaya Hotel')).toBeTruthy()
    expect(document.body.textContent).not.toContain('{"')
    expect(document.body.textContent).not.toContain('MATCHED_IN_BACKOFFICE')
  })
})
