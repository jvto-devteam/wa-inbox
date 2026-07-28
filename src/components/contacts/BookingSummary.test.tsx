import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { BookingSummary } from './BookingSummary'
import type { BookingData } from '@/lib/booking/client'

afterEach(cleanup)

// Realistic payload, shaped like the fixtures in src/lib/booking/client.test.ts.
// lookupBooking does NO field mapping — this is the raw upstream JVTO object,
// index signature and all.
const realBooking: BookingData = {
  id: 'B1',
  guest: 'Jane Doe',
  package: 'Ijen Blue Fire Trekking',
  date: { start: '01 Aug 2026', end: '02 Aug 2026', start_ymd: '2026-08-01', end_ymd: '2026-08-02' },
  orderChannel: 'JVTO',
  total_pax: 4,
  duration: '2D1N',
  booking_date: '2026-07-01',
  financial: { payment: 500000, balance: 350000 },
  guestDetails: { email: 'jane@example.com', country: 'AU', phone: '+6281234567890' },
}

describe('BookingSummary — confirmed booking', () => {
  // Regression: the component used to declare its own guessed shape
  // (destination/dateRange/pax/amountPaid/amountDue/status). None of those keys exist
  // on a real booking, so the badge rendered but the detail list was completely empty
  // for every real production booking.
  it('renders the real booking fields, not an empty card', () => {
    render(<BookingSummary bookingData={realBooking} tripBrief={null} />)

    expect(screen.getByText('Booking Ada')).toBeInTheDocument()
    expect(screen.getByText('Paket')).toBeInTheDocument()
    expect(screen.getByText('Ijen Blue Fire Trekking')).toBeInTheDocument()
    expect(screen.getByText('01 Aug 2026 – 02 Aug 2026')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    // formatIDR renders a non-breaking space after "Rp", so match loosely.
    expect(screen.getByText(/Rp\s?500\.000/)).toBeInTheDocument()
    expect(screen.getByText(/Rp\s?350\.000/)).toBeInTheDocument()
  })

  it('derives "Belum lunas" from an outstanding financial.balance', () => {
    render(<BookingSummary bookingData={realBooking} tripBrief={null} />)
    expect(screen.getByText('Belum lunas')).toBeInTheDocument()
  })

  it('derives "Lunas" when the balance is zero', () => {
    render(
      <BookingSummary
        bookingData={{ ...realBooking, financial: { payment: 850000, balance: 0 } }}
        tripBrief={null}
      />
    )
    expect(screen.getByText('Lunas')).toBeInTheDocument()
  })

  it('omits the status row entirely when the payload carries no financial block', () => {
    render(<BookingSummary bookingData={{ ...realBooking, financial: undefined }} tripBrief={null} />)

    expect(screen.getByText('Ijen Blue Fire Trekking')).toBeInTheDocument()
    expect(screen.queryByText('Status')).not.toBeInTheDocument()
    expect(screen.queryByText('Dibayar')).not.toBeInTheDocument()
    expect(screen.queryByText('Sisa')).not.toBeInTheDocument()
  })

  it('falls back to the ymd date fields when the human-readable range is absent', () => {
    render(
      <BookingSummary
        bookingData={{ ...realBooking, date: { start_ymd: '2026-08-01', end_ymd: '2026-08-02' } }}
        tripBrief={null}
      />
    )
    expect(screen.getByText('2026-08-01 – 2026-08-02')).toBeInTheDocument()
  })

  it('shows a single date rather than an empty range when only a start date exists', () => {
    render(
      <BookingSummary bookingData={{ ...realBooking, date: { start: '01 Aug 2026' } }} tripBrief={null} />
    )
    expect(screen.getByText('01 Aug 2026')).toBeInTheDocument()
  })

  // The badge is driven by hasAnyValue over the raw object, which passes for any
  // non-empty payload — including one carrying only fields this card does not show.
  it('still shows the confirmed badge for a sparse booking payload', () => {
    render(<BookingSummary bookingData={{ id: 'B9' }} tripBrief={null} />)
    expect(screen.getByText('Booking Ada')).toBeInTheDocument()
  })

  it('shows pickup and dropoff points when present', () => {
    render(
      <BookingSummary
        bookingData={{
          ...realBooking,
          pickup: { text: 'Surabaya Hotel  Surabaya Suites Hotel Powered by Archipelago' },
          dropoff: { text: 'Surabaya Hotel  ' },
        }}
        tripBrief={null}
      />
    )
    // RTL's default text matching normalizes whitespace (collapses the API's double
    // spaces to one), so match on the normalized form.
    expect(screen.getByText('Surabaya Hotel Surabaya Suites Hotel Powered by Archipelago')).toBeInTheDocument()
    expect(screen.getByText('Surabaya Hotel')).toBeInTheDocument()
  })

  it('renders a compact day-by-day itinerary when present', () => {
    render(
      <BookingSummary
        bookingData={{
          ...realBooking,
          itinerary: [
            { day: '1', activity: 'Ijen Crater Hike' },
            { day: '2', activity: 'Bromo Sunrise Tour' },
          ],
        }}
        tripBrief={null}
      />
    )
    expect(screen.getByText('Itinerary')).toBeInTheDocument()
    expect(screen.getByText('Hari 1')).toBeInTheDocument()
    expect(screen.getByText('Ijen Crater Hike')).toBeInTheDocument()
    expect(screen.getByText('Hari 2')).toBeInTheDocument()
    expect(screen.getByText('Bromo Sunrise Tour')).toBeInTheDocument()
  })

  it('omits the itinerary section entirely when the payload carries none', () => {
    render(<BookingSummary bookingData={realBooking} tripBrief={null} />)
    expect(screen.queryByText('Itinerary')).not.toBeInTheDocument()
  })

  it('shows an invoice link when one is present, pointing at the real URL', () => {
    render(
      <BookingSummary
        bookingData={{
          ...realBooking,
          financial: { ...realBooking.financial, invoice: { total: 6200000, invoiceLink: ['https://new-backoffice.javavolcano-touroperator.com/preview-file?url=x.pdf'] } },
        }}
        tripBrief={null}
      />
    )
    const link = screen.getByRole('link', { name: 'Lihat Invoice' })
    expect(link).toHaveAttribute('href', 'https://new-backoffice.javavolcano-touroperator.com/preview-file?url=x.pdf')
  })

  it('omits the invoice link when none is present', () => {
    render(<BookingSummary bookingData={realBooking} tripBrief={null} />)
    expect(screen.queryByRole('link', { name: 'Lihat Invoice' })).not.toBeInTheDocument()
  })
})

describe('BookingSummary — other states', () => {
  it('shows the funnel-only card when there is a trip brief but no booking', () => {
    render(<BookingSummary bookingData={null} tripBrief={{ destination: 'Bali', pax: 4 }} />)

    expect(screen.getByText('Dari Funnel (belum booking)')).toBeInTheDocument()
    expect(screen.getByText('Bali')).toBeInTheDocument()
    expect(screen.queryByText('Booking Ada')).not.toBeInTheDocument()
  })

  it('shows the neutral empty state when there is neither', () => {
    render(<BookingSummary bookingData={null} tripBrief={null} />)
    expect(screen.getByText('Belum ada data booking atau brief perjalanan.')).toBeInTheDocument()
  })
})
