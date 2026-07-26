import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ContactPanel } from './ContactPanel'

const baseDetail = {
  botEnabled: true,
  contactName: 'Bruno Figarola',
  avatarUrl: null as string | null,
  source: 'Instagram',
  bookingData: null as unknown,
  tripBrief: null as unknown,
  labels: [{ id: 'lbl_1', name: 'Confirmed Booking', color: '#3C6B42' }],
}

const allLabels = [
  { id: 'lbl_1', name: 'Confirmed Booking', color: '#3C6B42' },
  { id: 'lbl_2', name: 'New Customer', color: '#106877' },
]

function mockFetchWith(detail: typeof baseDetail) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url === '/api/labels') return Promise.resolve({ json: () => Promise.resolve(allLabels) } as Response)
      return Promise.resolve({ json: () => Promise.resolve(detail) } as Response)
    })
  )
}

describe('ContactPanel', () => {
  it('renders contact name, source, and an initial-letter avatar fallback when avatarUrl is null', async () => {
    mockFetchWith(baseDetail)
    render(<ContactPanel conversationId="conv_1" />)

    await screen.findByText('Bruno Figarola')
    expect(screen.getByText('Instagram')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders an <img> avatar when avatarUrl is set', async () => {
    mockFetchWith({ ...baseDetail, avatarUrl: 'https://example.com/a.jpg' })
    render(<ContactPanel conversationId="conv_1" />)

    const img = await screen.findByRole('img')
    expect(img).toHaveAttribute('src', 'https://example.com/a.jpg')
  })

  it('shows a verified "Booking Ada" summary when bookingData is present (Mode 3)', async () => {
    mockFetchWith({
      ...baseDetail,
      bookingData: { destination: 'Bromo', dateRange: '10-12 Aug', pax: 2, amountPaid: 500000, amountDue: 500000, status: 'CONFIRMED' },
      tripBrief: { destination: 'Ignored', pax: 99 },
    })
    render(<ContactPanel conversationId="conv_1" />)

    await screen.findByText('Booking Ada')
    expect(screen.getByText('Bromo')).toBeInTheDocument()
    expect(screen.getByText('CONFIRMED')).toBeInTheDocument()
    expect(screen.queryByText('Dari Funnel (belum booking)')).not.toBeInTheDocument()
  })

  it('shows a "Dari Funnel (belum booking)" summary when only tripBrief is set (Mode 1/2)', async () => {
    mockFetchWith({ ...baseDetail, bookingData: null, tripBrief: { destination: 'Bali', pax: 4 } })
    render(<ContactPanel conversationId="conv_1" />)

    await screen.findByText('Dari Funnel (belum booking)')
    expect(screen.getByText('Bali')).toBeInTheDocument()
    expect(screen.queryByText('Booking Ada')).not.toBeInTheDocument()
  })

  it('shows a neutral empty state for a brand-new conversation with neither bookingData nor tripBrief', async () => {
    mockFetchWith({ ...baseDetail, bookingData: null, tripBrief: null })
    render(<ContactPanel conversationId="conv_1" />)

    await waitFor(() => expect(screen.getByText('Bruno Figarola')).toBeInTheDocument())
    expect(screen.queryByText('Booking Ada')).not.toBeInTheDocument()
    expect(screen.queryByText('Dari Funnel (belum booking)')).not.toBeInTheDocument()
    expect(screen.getByText('Belum ada data booking atau brief perjalanan.')).toBeInTheDocument()
  })

  it('renders the conversation labels', async () => {
    mockFetchWith(baseDetail)
    render(<ContactPanel conversationId="conv_1" />)

    await screen.findByText('Confirmed Booking')
  })
})
