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

  it('renders a compact day-by-day hotel list when present, including the room type', () => {
    render(
      <BookingSummary
        bookingData={{
          ...realBooking,
          hotels: [
            { day: '1', hotel: 'Baratha Hotel and Resto', rooms: [{ roomId: 9, roomName: 'Deluxe Double', quantity: '1' }] },
            { day: '2', hotel: 'Joglo Kecombrang Bromo', rooms: [{ roomId: 24, roomName: 'Double', quantity: '1' }] },
          ],
        }}
        tripBrief={null}
      />
    )
    expect(screen.getByText('Hotel')).toBeInTheDocument()
    expect(screen.getByText('Hari 1')).toBeInTheDocument()
    expect(screen.getByText('Baratha Hotel and Resto (Deluxe Double)')).toBeInTheDocument()
    expect(screen.getByText('Hari 2')).toBeInTheDocument()
    expect(screen.getByText('Joglo Kecombrang Bromo (Double)')).toBeInTheDocument()
  })

  it('omits the hotel section entirely when the payload carries none', () => {
    render(<BookingSummary bookingData={realBooking} tripBrief={null} />)
    expect(screen.queryByText('Hotel')).not.toBeInTheDocument()
  })

  it('hides Dibayar and Sisa, and shows Kru/Transportasi instead of Hotel, for a KLOOK booking', () => {
    render(
      <BookingSummary
        bookingData={{
          ...realBooking,
          orderChannel: 'KLOOK',
          hotels: [{ day: '1', hotel: 'Should not render' }],
          guides: [{ name: 'Budi Guide' }],
          drivers: [{ name: 'Agus Driver' }],
        }}
        tripBrief={null}
      />
    )
    expect(screen.queryByText('Dibayar')).not.toBeInTheDocument()
    expect(screen.queryByText('Sisa')).not.toBeInTheDocument()
    expect(screen.queryByText('Hotel')).not.toBeInTheDocument()
    expect(screen.queryByText('Should not render')).not.toBeInTheDocument()
    expect(screen.getByText('Kru')).toBeInTheDocument()
    expect(screen.getByText('Budi Guide')).toBeInTheDocument()
    expect(screen.getByText('Transportasi')).toBeInTheDocument()
    expect(screen.getByText('Agus Driver')).toBeInTheDocument()
  })

  it('still shows Status for a KLOOK booking even though Dibayar/Sisa are hidden', () => {
    render(<BookingSummary bookingData={{ ...realBooking, orderChannel: 'KLOOK' }} tripBrief={null} />)
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Belum lunas')).toBeInTheDocument()
  })

  it('shows a portal link when customer_portal is present, pointing at the real URL', () => {
    render(
      <BookingSummary
        bookingData={{
          ...realBooking,
          customer_portal: 'https://javavolcano-touroperator.com/my-booking/752b6477206e7d45d79b74d936cb3448',
        }}
        tripBrief={null}
      />
    )
    const link = screen.getByRole('link', { name: 'Lihat Portal' })
    expect(link).toHaveAttribute('href', 'https://javavolcano-touroperator.com/my-booking/752b6477206e7d45d79b74d936cb3448')
  })

  it('omits the portal link when customer_portal is absent', () => {
    render(<BookingSummary bookingData={realBooking} tripBrief={null} />)
    expect(screen.queryByRole('link', { name: 'Lihat Portal' })).not.toBeInTheDocument()
  })
})

describe('BookingSummary — other states', () => {
  it('shows the funnel-only card when there is a trip brief but no booking', () => {
    render(<BookingSummary bookingData={null} tripBrief={{ destination: 'Bali', pax: 4 }} />)

    expect(screen.getByText('Info dari percakapan (belum booking)')).toBeInTheDocument()
    expect(screen.getByText('Bali')).toBeInTheDocument()
    expect(screen.queryByText('Booking Ada')).not.toBeInTheDocument()
  })

  it('shows the neutral empty state when there is neither', () => {
    render(<BookingSummary bookingData={null} tripBrief={null} />)
    expect(screen.getByText('Belum ada data booking atau brief perjalanan.')).toBeInTheDocument()
  })
})
