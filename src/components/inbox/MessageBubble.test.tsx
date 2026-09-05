import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

  it('toggles the bot trace popover open and closed via the dedicated 🧠 icon, not the message text', () => {
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

    const icon = screen.getByLabelText('Lihat alasan bot')
    fireEvent.click(icon)
    expect(screen.getByText(/sumber topik/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Sembunyikan alasan bot')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Sembunyikan alasan bot'))
    expect(screen.queryByText(/sumber topik/i)).not.toBeInTheDocument()
  })

  // Behaviour deliberately changed in Phase 3 (guidebook §12): the trigger now appears on
  // EVERY bot message, including one with no stored trace. A bot reply nobody can explain is
  // exactly the case an agent most needs to ask about, and hiding the button there left them
  // with no way to ask at all. The popover answers honestly instead of not existing.
  it('shows the trace trigger for a bot message with no botTrace, and says the trace is missing', () => {
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

    fireEvent.click(screen.getByLabelText('Lihat alasan bot'))
    expect(screen.getByText('Trace tidak tersedia untuk pesan ini')).toBeInTheDocument()
  })

  it('does not show a 🧠 trace icon on a non-bot message even if botTrace were somehow set', () => {
    render(
      <MessageBubble
        message={{
          id: 'm4b',
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
    expect(screen.queryByLabelText('Lihat alasan bot')).not.toBeInTheDocument()
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
    expect(screen.getByText('Bot menyerahkan ke agen')).toBeInTheDocument()
  })

  it('renders a handoff placeholder as a plain centered divider, not a chat bubble with badge/time/reply', () => {
    render(
      <MessageBubble
        message={{
          id: 'm6b', direction: 'OUTBOUND', content: null, channel: 'OFFICIAL', sentBy: 'BOT',
          deliveryStatus: 'SENT', createdAt: new Date().toISOString(),
          botTrace: { mode: 'handoff', reason: 'Kata kunci eskalasi terdeteksi' },
        }}
        onReply={() => {}}
      />
    )
    expect(screen.queryByText('Bot')).not.toBeInTheDocument()
    expect(screen.queryByText('Official')).not.toBeInTheDocument()
    expect(screen.queryByText('Unofficial')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Balas pesan ini' })).not.toBeInTheDocument()
    // No formatted time string rendered anywhere for this row.
    expect(screen.queryByText(/^\d{2}\.\d{2}$/)).not.toBeInTheDocument()
  })

  it('opens the reasoning popover with the handoff reason when the divider is clicked', () => {
    render(
      <MessageBubble
        message={{
          id: 'm6c', direction: 'OUTBOUND', content: null, channel: 'OFFICIAL', sentBy: 'BOT',
          deliveryStatus: 'SENT', createdAt: new Date().toISOString(),
          botTrace: { mode: 'handoff', reason: 'Gerbang persetujuan belum terbuka: catalog belum pernah disinkron' },
        }}
      />
    )
    expect(screen.getByText('Bot menyerahkan ke agen').closest('button')).toBeInTheDocument()
    expect(screen.queryByText(/Gerbang persetujuan/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Bot menyerahkan ke agen'))
    expect(screen.getByText(/Gerbang persetujuan/)).toBeInTheDocument()
  })

  it('clicking the divider is a no-op when the row has no trace to show', () => {
    render(
      <MessageBubble
        message={{
          id: 'm6d', direction: 'OUTBOUND', content: null, channel: 'OFFICIAL', sentBy: 'BOT',
          deliveryStatus: 'SENT', createdAt: new Date().toISOString(),
          botTrace: null,
        }}
      />
    )
    fireEvent.click(screen.getByText('Bot menyerahkan ke agen'))
    expect(screen.getByText('Bot menyerahkan ke agen')).toBeInTheDocument()
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

  it('shows a tap-to-load placeholder for an inbound image instead of fetching it immediately', () => {
    render(
      <MessageBubble
        message={{
          id: 'm10', direction: 'INBOUND', content: 'Ini paketnya', channel: 'OFFICIAL', sentBy: 'CUSTOMER',
          deliveryStatus: 'DELIVERED', createdAt: new Date().toISOString(), botTrace: null,
          type: 'image', mediaUrl: '/api/media/m10', mimeType: 'image/jpeg', fileName: null,
        }}
      />
    )
    expect(screen.queryByRole('img', { name: 'Ini paketnya' })).not.toBeInTheDocument()
    expect(screen.getByText('Ketuk untuk memuat gambar')).toBeInTheDocument()
    expect(screen.getByText('Ini paketnya')).toBeInTheDocument()
  })

  it('renders the real image, with its caption below, once the placeholder is tapped', () => {
    render(
      <MessageBubble
        message={{
          id: 'm10', direction: 'INBOUND', content: 'Ini paketnya', channel: 'OFFICIAL', sentBy: 'CUSTOMER',
          deliveryStatus: 'DELIVERED', createdAt: new Date().toISOString(), botTrace: null,
          type: 'image', mediaUrl: '/api/media/m10', mimeType: 'image/jpeg', fileName: null,
        }}
      />
    )
    fireEvent.click(screen.getByText('Ketuk untuk memuat gambar'))
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

  it('shows the LTO countdown banner with the real per-send expiration time', () => {
    render(
      <MessageBubble
        message={{
          id: 'm_lto', direction: 'OUTBOUND', content: 'Nikmati diskon spesial!', channel: 'OFFICIAL', sentBy: 'AGENT',
          deliveryStatus: 'SENT', createdAt: new Date().toISOString(), botTrace: null, type: 'template',
          templatePayload: {
            templateName: 'promo_akhir_tahun', bodyText: 'Nikmati diskon spesial!',
            limitedTimeOffer: { text: 'Diskon 25%', expirationTimeMs: new Date('2026-12-31T23:59:00').getTime() },
          },
        }}
      />
    )
    expect(screen.getByText(/Diskon 25%/)).toBeInTheDocument()
    expect(screen.getByText(/berakhir/)).toBeInTheDocument()
  })

  it('shows the coupon code chip with the real per-send code', () => {
    render(
      <MessageBubble
        message={{
          id: 'm_coupon', direction: 'OUTBOUND', content: 'Gunakan kode ini.', channel: 'OFFICIAL', sentBy: 'AGENT',
          deliveryStatus: 'SENT', createdAt: new Date().toISOString(), botTrace: null, type: 'template',
          templatePayload: {
            templateName: 'kode_diskon', bodyText: 'Gunakan kode ini.',
            coupon: { buttonText: 'Salin Kode', code: 'PROMO25' },
          },
        }}
      />
    )
    expect(screen.getByText('PROMO25')).toBeInTheDocument()
    expect(screen.getByText('Salin Kode')).toBeInTheDocument()
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

describe('MessageBubble retry (Phase 6)', () => {
  const failed = {
    id: 'msg_failed',
    direction: 'OUTBOUND' as const,
    content: 'Halo',
    channel: 'UNOFFICIAL',
    sentBy: 'AGENT',
    deliveryStatus: 'FAILED',
    createdAt: new Date().toISOString(),
    botTrace: null,
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('re-queues the message when Kirim Ulang is pressed', async () => {
    // This button shipped with no onClick at all: it looked like a working recovery path and
    // did nothing.
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) as Response)
    vi.stubGlobal('fetch', fetchMock)

    render(<MessageBubble message={failed} />)
    fireEvent.click(screen.getByLabelText('Kirim ulang'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/outbound-jobs/retry')
    expect(JSON.parse(init.body as string)).toEqual({ messageId: 'msg_failed' })
  })

  it('does not claim the message was sent — the worker broadcasts the real outcome', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) as Response))

    render(<MessageBubble message={failed} />)
    fireEvent.click(screen.getByLabelText('Kirim ulang'))

    // The bubble is replaced from the `message.updated` event, not optimistically here.
    await waitFor(() => expect(screen.getByText('FAILED')).toBeInTheDocument())
  })

  it('surfaces a retry failure instead of failing silently', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: 'Pengiriman ini sedang diproses' }) }) as Response)
    )

    render(<MessageBubble message={failed} />)
    fireEvent.click(screen.getByLabelText('Kirim ulang'))

    await waitFor(() => expect(screen.getByText('Pengiriman ini sedang diproses')).toBeInTheDocument())
  })

  it('shows no retry control on a message that did not fail', () => {
    render(<MessageBubble message={{ ...failed, deliveryStatus: 'SENT' }} />)
    expect(screen.queryByLabelText('Kirim ulang')).toBeNull()
  })
})
