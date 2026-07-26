import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ContactPanel } from './ContactPanel'

const baseDetail = {
  botEnabled: true,
  contactId: 'contact_1',
  contactName: 'Bruno Figarola',
  avatarUrl: null as string | null,
  source: 'Instagram',
  bookingData: null as unknown,
  tripBrief: null as unknown,
  labels: [{ id: 'lbl_1', name: 'Confirmed Booking', color: '#3C6B42' }],
  pipelineStage: 'new',
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
      if (url === `/api/contacts/${detail.contactId}/notes`) return Promise.resolve({ json: () => Promise.resolve([]) } as Response)
      if (url === `/api/contacts/${detail.contactId}/reminders`) return Promise.resolve({ json: () => Promise.resolve([]) } as Response)
      return Promise.resolve({ json: () => Promise.resolve(detail) } as Response)
    })
  )
}

function mockFetchWithPipeline(detail: typeof baseDetail, pipelineResponse: { ok: boolean; json: () => Promise<unknown> }) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url === '/api/labels') return Promise.resolve({ json: () => Promise.resolve(allLabels) } as Response)
      if (url === `/api/contacts/${detail.contactId}/notes`) return Promise.resolve({ json: () => Promise.resolve([]) } as Response)
      if (url === `/api/contacts/${detail.contactId}/reminders`) return Promise.resolve({ json: () => Promise.resolve([]) } as Response)
      if (url === `/api/conversations/conv_1/pipeline`) return Promise.resolve(pipelineResponse as Response)
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

  it('fetches notes for the contact (using contactId, not conversationId) and renders the notes section', async () => {
    mockFetchWith(baseDetail)
    render(<ContactPanel conversationId="conv_1" />)

    await screen.findByText('Catatan')
    await screen.findByText('Belum ada catatan.')
    expect(fetch).toHaveBeenCalledWith('/api/contacts/contact_1/notes')
  })

  it('fetches reminders for the contact (using contactId, not conversationId) and renders the reminders section', async () => {
    mockFetchWith(baseDetail)
    render(<ContactPanel conversationId="conv_1" />)

    await screen.findByText('Reminder')
    await screen.findByText('Belum ada reminder.')
    expect(fetch).toHaveBeenCalledWith('/api/contacts/contact_1/reminders')
  })

  it('shows the pipeline stage dropdown pre-selected to the server-provided stage', async () => {
    mockFetchWith({ ...baseDetail, pipelineStage: 'nego' })
    render(<ContactPanel conversationId="conv_1" />)

    await screen.findByText('Bruno Figarola')
    expect(screen.getByLabelText('Tahap pipeline')).toHaveValue('nego')
  })

  it('PATCHes the new pipeline stage on change, only updating the displayed value once the server confirms', async () => {
    mockFetchWithPipeline(baseDetail, { ok: true, json: () => Promise.resolve({ pipelineStage: 'booked' }) })
    render(<ContactPanel conversationId="conv_1" />)

    await screen.findByText('Bruno Figarola')
    expect(screen.getByLabelText('Tahap pipeline')).toHaveValue('new')

    fireEvent.change(screen.getByLabelText('Tahap pipeline'), { target: { value: 'booked' } })

    expect(fetch).toHaveBeenCalledWith('/api/conversations/conv_1/pipeline', {
      method: 'PATCH',
      body: JSON.stringify({ stage: 'booked' }),
    })
    await waitFor(() => expect(screen.getByLabelText('Tahap pipeline')).toHaveValue('booked'))
  })

  it('does not change the displayed pipeline stage when the PATCH responds non-ok, and shows an error', async () => {
    mockFetchWithPipeline(baseDetail, { ok: false, json: () => Promise.resolve({ error: 'nope' }) })
    render(<ContactPanel conversationId="conv_1" />)

    await screen.findByText('Bruno Figarola')

    fireEvent.change(screen.getByLabelText('Tahap pipeline'), { target: { value: 'booked' } })

    await waitFor(() => expect(screen.getByText('Gagal mengubah status pipeline')).toBeInTheDocument())
    expect(screen.getByLabelText('Tahap pipeline')).toHaveValue('new')
  })

  it('does not change the displayed pipeline stage when the PATCH request itself rejects (network failure)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/labels') return Promise.resolve({ json: () => Promise.resolve(allLabels) } as Response)
        if (url === `/api/contacts/${baseDetail.contactId}/notes`) return Promise.resolve({ json: () => Promise.resolve([]) } as Response)
        if (url === `/api/contacts/${baseDetail.contactId}/reminders`) return Promise.resolve({ json: () => Promise.resolve([]) } as Response)
        if (url === '/api/conversations/conv_1/pipeline') return Promise.reject(new Error('network down'))
        return Promise.resolve({ json: () => Promise.resolve(baseDetail) } as Response)
      })
    )
    render(<ContactPanel conversationId="conv_1" />)

    await screen.findByText('Bruno Figarola')

    fireEvent.change(screen.getByLabelText('Tahap pipeline'), { target: { value: 'booked' } })

    await waitFor(() => expect(screen.getByText('Gagal mengubah status pipeline')).toBeInTheDocument())
    expect(screen.getByLabelText('Tahap pipeline')).toHaveValue('new')
  })
})
