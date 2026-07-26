import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ComposeBox } from './ComposeBox'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

describe('ComposeBox — Ambil Alih dari Bot toggle', () => {
  it('renders the "Ambil Alih dari Bot" button when botEnabled is true', () => {
    render(
      <ComposeBox conversationId="conv_1" botEnabled={true} onSent={() => {}} onBotToggled={() => {}} />
    )

    expect(screen.getByText('Ambil Alih dari Bot')).toBeInTheDocument()
  })

  it('does not render the "Ambil Alih dari Bot" button when botEnabled is false', () => {
    render(
      <ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />
    )

    expect(screen.queryByText('Ambil Alih dari Bot')).not.toBeInTheDocument()
  })

  it('calls the toggle-bot endpoint and reports the new value on click', async () => {
    vi.mocked(fetch).mockResolvedValue({ json: () => Promise.resolve({ botEnabled: false }) } as Response)
    const onBotToggled = vi.fn()

    render(
      <ComposeBox conversationId="conv_1" botEnabled={true} onSent={() => {}} onBotToggled={onBotToggled} />
    )

    fireEvent.click(screen.getByText('Ambil Alih dari Bot'))

    expect(fetch).toHaveBeenCalledWith('/api/conversations/conv_1/toggle-bot', { method: 'POST' })
    await waitFor(() => expect(onBotToggled).toHaveBeenCalledWith(false))
  })
})

describe('ComposeBox quick replies', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/templates')
          return Promise.resolve({
            json: async () => [
              { id: 'tpl_1', name: 'Cara Booking', type: 'QUICK_REPLY', category: 'Cara Booking', body: 'Ikuti panduan booking di link ini...' },
            ],
          })
        return Promise.resolve({ ok: true, json: async () => ({ id: 'm1', deliveryStatus: 'SENT' }) })
      })
    )
  })

  it('fills the text input when a quick reply is selected', async () => {
    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)
    fireEvent.click(await screen.findByText('Template'))
    fireEvent.click(await screen.findByText('Cara Booking'))
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Reply on WhatsApp...')).toHaveValue('Ikuti panduan booking di link ini...')
    })
  })

  it('closes the picker after a template is selected', async () => {
    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)
    fireEvent.click(await screen.findByText('Template'))
    fireEvent.click(await screen.findByText('Cara Booking'))
    await waitFor(() => {
      expect(screen.queryByText('Ikuti panduan booking di link ini...')).not.toBeInTheDocument()
    })
  })

  it('groups templates by category and excludes OFFICIAL templates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/templates')
          return Promise.resolve({
            json: async () => [
              { id: 'tpl_1', name: 'Cara Booking', type: 'QUICK_REPLY', category: 'Panduan', body: 'Ikuti panduan booking...' },
              { id: 'tpl_2', name: 'Harga Paket', type: 'QUICK_REPLY', category: 'Paket & Harga', body: 'Berikut harga paket kami...' },
              { id: 'tpl_official', name: 'booking_confirmation', type: 'OFFICIAL', category: 'UTILITY', body: 'Booking Anda dikonfirmasi.' },
            ],
          })
        return Promise.resolve({ ok: true, json: async () => ({ id: 'm1', deliveryStatus: 'SENT' }) })
      })
    )
    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)
    fireEvent.click(await screen.findByText('Template'))

    expect(await screen.findByRole('heading', { name: /panduan/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /paket & harga/i })).toBeInTheDocument()
    expect(screen.getByText('Cara Booking')).toBeInTheDocument()
    expect(screen.getByText('Harga Paket')).toBeInTheDocument()
    expect(screen.queryByText('booking_confirmation')).not.toBeInTheDocument()
  })
})
