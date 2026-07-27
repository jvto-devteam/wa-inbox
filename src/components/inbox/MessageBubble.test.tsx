import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MessageBubble } from './MessageBubble'

describe('MessageBubble', () => {
  it('shows bot-sent messages with a Bot badge', () => {
    render(<MessageBubble message={{ id: 'm1', direction: 'OUTBOUND', content: 'Info paket Ijen...', channel: 'OFFICIAL', sentBy: 'BOT', deliveryStatus: 'SENT', createdAt: new Date().toISOString(), botTrace: { mode: 'faq', draft: 'Info paket Ijen...', sourceTopic: 'inclusions' } }} />)
    expect(screen.getByText('Info paket Ijen...')).toBeInTheDocument()
    expect(screen.getByText('Bot')).toBeInTheDocument()
  })

  it('shows a retry button for failed messages', () => {
    render(<MessageBubble message={{ id: 'm2', direction: 'OUTBOUND', content: 'Halo', channel: 'OFFICIAL', sentBy: 'AGENT', deliveryStatus: 'FAILED', createdAt: new Date().toISOString(), botTrace: null }} />)
    expect(screen.getByRole('button', { name: /kirim ulang/i })).toBeInTheDocument()
  })

  it('toggles the bot trace popover open and closed when clicking a bot message with a trace', () => {
    render(
      <MessageBubble
        message={{
          id: 'm3',
          direction: 'OUTBOUND',
          content: 'Info paket Ijen...',
          channel: 'OFFICIAL',
          sentBy: 'BOT',
          deliveryStatus: 'SENT',
          createdAt: new Date().toISOString(),
          botTrace: { mode: 'faq', draft: 'Info paket Ijen...', sourceTopic: 'inclusions' },
        }}
      />
    )
    expect(screen.queryByText(/sumber topik/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Info paket Ijen...'))
    expect(screen.getByText(/sumber topik/i)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Info paket Ijen...'))
    expect(screen.queryByText(/sumber topik/i)).not.toBeInTheDocument()
  })

  it('does not show a popover when clicking a bot message with no botTrace', () => {
    render(
      <MessageBubble
        message={{
          id: 'm4',
          direction: 'OUTBOUND',
          content: 'Halo dari bot',
          channel: 'OFFICIAL',
          sentBy: 'BOT',
          deliveryStatus: 'SENT',
          createdAt: new Date().toISOString(),
          botTrace: null,
        }}
      />
    )
    fireEvent.click(screen.getByText('Halo dari bot'))
    expect(screen.queryByText(/mode:/i)).not.toBeInTheDocument()
  })

  it('shows a clear handoff placeholder instead of a blank bubble for a logged handoff decision', () => {
    // Task 34 logs a handoff decision as a Message row with content: null, sentBy: 'BOT'. Without
    // a placeholder, the bubble would render empty, reading as a broken bot reply instead of a
    // silent handoff to a human agent.
    render(
      <MessageBubble
        message={{
          id: 'm6',
          direction: 'OUTBOUND',
          content: null,
          channel: 'OFFICIAL',
          sentBy: 'BOT',
          deliveryStatus: 'SENT',
          createdAt: new Date().toISOString(),
          botTrace: { mode: 'handoff', reason: 'Kata kunci eskalasi terdeteksi' },
        }}
      />
    )
    expect(screen.getByText('Bot menyerahkan ke agen — lihat alasan')).toBeInTheDocument()
  })

  it('shows a channel badge and time for every message', () => {
    render(<MessageBubble message={{ id: 'm7', direction: 'OUTBOUND', content: 'Halo', channel: 'UNOFFICIAL', sentBy: 'AGENT', deliveryStatus: 'SENT', createdAt: new Date('2026-01-01T10:30:00Z').toISOString(), botTrace: null }} />)
    expect(screen.getByText('Unofficial')).toBeInTheDocument()
  })

  it('shows a single tick for a sent outbound message and a blue double tick once read', () => {
    const { rerender } = render(
      <MessageBubble message={{ id: 'm8', direction: 'OUTBOUND', content: 'Halo', channel: 'OFFICIAL', sentBy: 'AGENT', deliveryStatus: 'SENT', createdAt: new Date().toISOString(), botTrace: null }} />
    )
    expect(screen.getByRole('img', { name: 'Terkirim' })).toBeInTheDocument()

    rerender(
      <MessageBubble message={{ id: 'm8', direction: 'OUTBOUND', content: 'Halo', channel: 'OFFICIAL', sentBy: 'AGENT', deliveryStatus: 'READ', createdAt: new Date().toISOString(), botTrace: null }} />
    )
    expect(screen.getByRole('img', { name: 'Dibaca' })).toBeInTheDocument()
  })

  it('does not show a delivery tick for inbound messages', () => {
    render(<MessageBubble message={{ id: 'm9', direction: 'INBOUND', content: 'Halo', channel: 'OFFICIAL', sentBy: 'CUSTOMER', deliveryStatus: 'DELIVERED', createdAt: new Date().toISOString(), botTrace: null }} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders an inbound image inline, with its caption below', () => {
    render(
      <MessageBubble
        message={{
          id: 'm10', direction: 'INBOUND', content: 'Ini paketnya', channel: 'OFFICIAL', sentBy: 'CUSTOMER',
          deliveryStatus: 'DELIVERED', createdAt: new Date().toISOString(), botTrace: null,
          type: 'image', mediaUrl: '/api/media/m10', mimeType: 'image/jpeg', fileName: null,
        }}
      />
    )
    const img = screen.getByRole('img', { name: 'Ini paketnya' })
    expect(img).toHaveAttribute('src', '/api/media/m10')
    expect(screen.getByText('Ini paketnya')).toBeInTheDocument()
  })

  it('renders an inbound document as a download link with its filename', () => {
    render(
      <MessageBubble
        message={{
          id: 'm11', direction: 'INBOUND', content: null, channel: 'OFFICIAL', sentBy: 'CUSTOMER',
          deliveryStatus: 'DELIVERED', createdAt: new Date().toISOString(), botTrace: null,
          type: 'document', mediaUrl: '/api/media/m11', mimeType: 'application/pdf', fileName: 'itinerary.pdf',
        }}
      />
    )
    const link = screen.getByRole('link', { name: /itinerary\.pdf/ })
    expect(link).toHaveAttribute('href', '/api/media/m11')
  })

  it('falls back to a bracketed type placeholder for a content-less, non-media message type', () => {
    render(
      <MessageBubble
        message={{
          id: 'm12', direction: 'INBOUND', content: null, channel: 'OFFICIAL', sentBy: 'CUSTOMER',
          deliveryStatus: 'DELIVERED', createdAt: new Date().toISOString(), botTrace: null,
          type: 'location', mediaUrl: null, mimeType: null, fileName: null,
        }}
      />
    )
    expect(screen.getByText('[location]')).toBeInTheDocument()
  })

  it('shows a quoted preview of the message being replied to', () => {
    render(
      <MessageBubble
        message={{
          id: 'm13', direction: 'INBOUND', content: 'Iya benar, paket 3D2N', channel: 'OFFICIAL', sentBy: 'CUSTOMER',
          deliveryStatus: 'DELIVERED', createdAt: new Date().toISOString(), botTrace: null,
          replyTo: { id: 'm_parent', content: 'Paketnya yang 3D2N kan?', type: 'text', sentBy: 'AGENT' },
        }}
      />
    )
    expect(screen.getByText('Paketnya yang 3D2N kan?')).toBeInTheDocument()
    expect(screen.getByText('Agen')).toBeInTheDocument()
    expect(screen.getByText('Iya benar, paket 3D2N')).toBeInTheDocument()
  })

  it('shows a bracketed type label in the quoted preview when the parent had no text content', () => {
    render(
      <MessageBubble
        message={{
          id: 'm14', direction: 'INBOUND', content: 'Ya itu', channel: 'OFFICIAL', sentBy: 'CUSTOMER',
          deliveryStatus: 'DELIVERED', createdAt: new Date().toISOString(), botTrace: null,
          replyTo: { id: 'm_parent2', content: null, type: 'image', sentBy: 'CUSTOMER' },
        }}
      />
    )
    expect(screen.getByText('[image]')).toBeInTheDocument()
  })

  it('calls onReply with the message when the reply button is clicked', () => {
    const onReply = vi.fn()
    const message = {
      id: 'm15', direction: 'OUTBOUND' as const, content: 'Halo', channel: 'OFFICIAL', sentBy: 'AGENT',
      deliveryStatus: 'SENT', createdAt: new Date().toISOString(), botTrace: null,
    }
    render(<MessageBubble message={message} onReply={onReply} />)

    fireEvent.click(screen.getByRole('button', { name: 'Balas pesan ini' }))

    expect(onReply).toHaveBeenCalledWith(message)
  })

  it('does not show a reply button when onReply is not provided', () => {
    render(
      <MessageBubble
        message={{
          id: 'm16', direction: 'OUTBOUND', content: 'Halo', channel: 'OFFICIAL', sentBy: 'AGENT',
          deliveryStatus: 'SENT', createdAt: new Date().toISOString(), botTrace: null,
        }}
      />
    )
    expect(screen.queryByRole('button', { name: 'Balas pesan ini' })).not.toBeInTheDocument()
  })

  it('does not show a reply button on a handoff log placeholder', () => {
    render(
      <MessageBubble
        message={{
          id: 'm17', direction: 'OUTBOUND', content: null, channel: 'OFFICIAL', sentBy: 'BOT',
          deliveryStatus: 'SENT', createdAt: new Date().toISOString(),
          botTrace: { mode: 'handoff', reason: 'x' },
        }}
        onReply={() => {}}
      />
    )
    expect(screen.queryByRole('button', { name: 'Balas pesan ini' })).not.toBeInTheDocument()
  })

  it('renders a sent carousel template with its cards, media, body, and buttons', () => {
    render(
      <MessageBubble
        message={{
          id: 'm18', direction: 'OUTBOUND', content: 'Halo, rekomendasi untuk Anda:', channel: 'OFFICIAL', sentBy: 'AGENT',
          deliveryStatus: 'SENT', createdAt: new Date().toISOString(), botTrace: null, type: 'template',
          templatePayload: {
            templateName: 'katalog_paket',
            bodyText: 'Halo, rekomendasi untuk Anda:',
            cards: [
              {
                mediaType: 'IMAGE', mediaUrl: 'https://example.com/ijen.jpg', bodyText: 'Paket Ijen 3D2N',
                buttons: [{ type: 'URL', text: 'Lihat Detail', url: 'https://jvto.com/ijen' }],
              },
            ],
          },
        }}
      />
    )
    expect(screen.getByText('Halo, rekomendasi untuk Anda:')).toBeInTheDocument()
    expect(screen.getByText('Template')).toBeInTheDocument()
    expect(screen.getByText('Paket Ijen 3D2N')).toBeInTheDocument()
    const img = screen.getByAltText('Paket Ijen 3D2N')
    expect(img).toHaveAttribute('src', 'https://example.com/ijen.jpg')
    const link = screen.getByRole('link', { name: 'Lihat Detail' })
    expect(link).toHaveAttribute('href', 'https://jvto.com/ijen')
  })

  it('renders a quick-reply button in a carousel card as inert text, not a link', () => {
    render(
      <MessageBubble
        message={{
          id: 'm19', direction: 'OUTBOUND', content: 'Halo', channel: 'OFFICIAL', sentBy: 'AGENT',
          deliveryStatus: 'SENT', createdAt: new Date().toISOString(), botTrace: null, type: 'template',
          templatePayload: {
            templateName: 'katalog_paket',
            bodyText: 'Halo',
            cards: [{ mediaType: 'IMAGE', mediaUrl: 'https://example.com/x.jpg', bodyText: 'Kartu', buttons: [{ type: 'QUICK_REPLY', text: 'Pesan Sekarang' }] }],
          },
        }}
      />
    )
    expect(screen.getByText('Pesan Sekarang')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Pesan Sekarang' })).not.toBeInTheDocument()
  })

  it('does not show a Template badge or carousel row for a plain message', () => {
    render(
      <MessageBubble
        message={{
          id: 'm20', direction: 'OUTBOUND', content: 'Halo biasa', channel: 'OFFICIAL', sentBy: 'AGENT',
          deliveryStatus: 'SENT', createdAt: new Date().toISOString(), botTrace: null,
        }}
      />
    )
    expect(screen.queryByText('Template')).not.toBeInTheDocument()
  })

  it('does not show a popover when clicking a non-bot message', () => {
    render(
      <MessageBubble
        message={{
          id: 'm5',
          direction: 'OUTBOUND',
          content: 'Halo dari agen',
          channel: 'OFFICIAL',
          sentBy: 'AGENT',
          deliveryStatus: 'SENT',
          createdAt: new Date().toISOString(),
          botTrace: null,
        }}
      />
    )
    fireEvent.click(screen.getByText('Halo dari agen'))
    expect(screen.queryByText(/mode:/i)).not.toBeInTheDocument()
  })
})
