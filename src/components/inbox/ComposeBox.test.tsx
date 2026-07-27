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
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: () => Promise.resolve({ botEnabled: false }) } as Response)
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
            ok: true,
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
            ok: true,
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

  it('shows an inline error and does not open the picker when the templates request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: async () => ({ error: 'Internal error' }) })))
    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)

    fireEvent.click(await screen.findByText('Template'))

    expect(await screen.findByText('Gagal memuat template')).toBeInTheDocument()
    expect(screen.queryByText('Belum ada template quick reply.')).not.toBeInTheDocument()
  })

  it('shows an inline error when the templates request throws (network failure)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Network error'))))
    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)

    fireEvent.click(await screen.findByText('Template'))

    expect(await screen.findByText('Gagal memuat template')).toBeInTheDocument()
  })

  it('shows the empty state when there are no quick-reply templates', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })))
    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)

    fireEvent.click(await screen.findByText('Template'))

    expect(await screen.findByText('Belum ada template quick reply.')).toBeInTheDocument()
  })
})

// A half-written reply to a live customer only exists in this input. `send()` used to read
// any /api/send response as if it were a Message: on a 401 or 500 it appended a bubble with
// `id: undefined` and an empty delivery badge, then cleared the box — destroying what the
// agent had actually typed.
describe('ComposeBox send failures', () => {
  const TYPED = 'Halo kak, untuk tanggal 12 masih tersedia ya'

  function mockSend(sendResponse: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/send') {
          return typeof sendResponse === 'function'
            ? (sendResponse as () => unknown)()
            : Promise.resolve(sendResponse)
        }
        return Promise.resolve({ ok: true, json: async () => ({ defaultChannel: 'OFFICIAL' }) })
      })
    )
  }

  async function type(text: string) {
    const input = await screen.findByLabelText('Pesan')
    fireEvent.change(input, { target: { value: text } })
    return input
  }

  it('keeps the typed message, shows an error, and does not call onSent when the send fails', async () => {
    mockSend({ ok: false, status: 500, json: async () => ({ error: 'Internal error' }) })
    const onSent = vi.fn()

    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={onSent} onBotToggled={() => {}} />)
    const input = await type(TYPED)
    fireEvent.click(screen.getByText('Kirim'))

    expect(await screen.findByText('Gagal mengirim pesan — coba lagi')).toBeInTheDocument()
    expect(input).toHaveValue(TYPED)
    expect(onSent).not.toHaveBeenCalled()
  })

  it('tells the agent their session expired on a 401, and still keeps the draft', async () => {
    mockSend({ ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) })
    const onSent = vi.fn()

    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={onSent} onBotToggled={() => {}} />)
    const input = await type(TYPED)
    fireEvent.click(screen.getByText('Kirim'))

    expect(await screen.findByText('Sesi berakhir — masuk kembali lalu kirim ulang')).toBeInTheDocument()
    expect(input).toHaveValue(TYPED)
    expect(onSent).not.toHaveBeenCalled()
  })

  it('keeps the draft when the send request itself rejects (network failure)', async () => {
    mockSend(() => Promise.reject(new Error('Network error')))
    const onSent = vi.fn()

    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={onSent} onBotToggled={() => {}} />)
    const input = await type(TYPED)
    fireEvent.click(screen.getByText('Kirim'))

    expect(await screen.findByText('Gagal mengirim pesan — coba lagi')).toBeInTheDocument()
    expect(input).toHaveValue(TYPED)
    expect(onSent).not.toHaveBeenCalled()
  })

  it('re-enables the Kirim button after a failure so the agent can retry the same text', async () => {
    mockSend({ ok: false, status: 500, json: async () => ({ error: 'Internal error' }) })

    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)
    await type(TYPED)
    fireEvent.click(screen.getByText('Kirim'))

    await screen.findByText('Gagal mengirim pesan — coba lagi')
    await waitFor(() => expect(screen.getByText('Kirim')).not.toBeDisabled())
  })

  it('still clears the input and reports the message on a successful send', async () => {
    mockSend({ ok: true, status: 200, json: async () => ({ id: 'msg_1', deliveryStatus: 'SENT' }) })
    const onSent = vi.fn()

    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={onSent} onBotToggled={() => {}} />)
    const input = await type(TYPED)
    fireEvent.click(screen.getByText('Kirim'))

    await waitFor(() =>
      expect(onSent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'msg_1', content: TYPED, deliveryStatus: 'SENT', sentBy: 'AGENT' })
      )
    )
    await waitFor(() => expect(input).toHaveValue(''))
    expect(screen.queryByText('Gagal mengirim pesan — coba lagi')).not.toBeInTheDocument()
  })

  it('clears a previous send error once a retry succeeds', async () => {
    let ok = false
    mockSend(() =>
      Promise.resolve(
        ok
          ? { ok: true, status: 200, json: async () => ({ id: 'msg_1', deliveryStatus: 'SENT' }) }
          : { ok: false, status: 500, json: async () => ({ error: 'Internal error' }) }
      )
    )

    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)
    await type(TYPED)
    fireEvent.click(screen.getByText('Kirim'))
    await screen.findByText('Gagal mengirim pesan — coba lagi')

    ok = true
    fireEvent.click(screen.getByText('Kirim'))

    await waitFor(() => expect(screen.queryByText('Gagal mengirim pesan — coba lagi')).not.toBeInTheDocument())
  })
})

// ComposeBox always puts an explicit `channel` in its /api/send body, and
// resolveChannel lets an explicit value win — so a hardcoded initial
// 'OFFICIAL' made the admin-configurable Settings.defaultChannel dead
// configuration for every human-agent send.
describe('ComposeBox default channel from Settings', () => {
  function mockSettings(response: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/settings')
          return typeof response === 'function' ? (response as () => unknown)() : Promise.resolve(response)
        return Promise.resolve({ ok: true, json: async () => ({ id: 'm1', deliveryStatus: 'SENT' }) })
      })
    )
  }

  it('seeds the channel select from Settings.defaultChannel', async () => {
    mockSettings({ ok: true, json: async () => ({ defaultChannel: 'UNOFFICIAL', botKillSwitch: false }) })

    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)

    await waitFor(() => expect(screen.getByLabelText('Channel')).toHaveValue('UNOFFICIAL'))
  })

  it('keeps OFFICIAL when Settings.defaultChannel is OFFICIAL', async () => {
    mockSettings({ ok: true, json: async () => ({ defaultChannel: 'OFFICIAL', botKillSwitch: false }) })

    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/settings'))
    expect(screen.getByLabelText('Channel')).toHaveValue('OFFICIAL')
  })

  it('sends on the seeded channel', async () => {
    mockSettings({ ok: true, json: async () => ({ defaultChannel: 'UNOFFICIAL' }) })

    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('Channel')).toHaveValue('UNOFFICIAL'))

    fireEvent.change(screen.getByLabelText('Pesan'), { target: { value: 'Halo' } })
    fireEvent.click(screen.getByText('Kirim'))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/send', {
        method: 'POST',
        body: JSON.stringify({ conversationId: 'conv_1', text: 'Halo', channel: 'UNOFFICIAL' }),
      })
    )
  })

  it('still lets the agent override the seeded channel for a single message', async () => {
    mockSettings({ ok: true, json: async () => ({ defaultChannel: 'UNOFFICIAL' }) })

    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('Channel')).toHaveValue('UNOFFICIAL'))

    fireEvent.change(screen.getByLabelText('Channel'), { target: { value: 'OFFICIAL' } })

    expect(screen.getByLabelText('Channel')).toHaveValue('OFFICIAL')
  })

  // A late-resolving settings fetch must not silently flip a channel the agent
  // has already chosen for the message they're composing.
  it('does not clobber an override made before the settings fetch resolves', async () => {
    let release: (value: unknown) => void = () => {}
    mockSettings(() => new Promise((resolve) => (release = resolve)))

    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)
    // Override away from the 'OFFICIAL' pre-fetch fallback, then let the
    // settings fetch land with a *different* value — a clobber would be visible.
    fireEvent.change(screen.getByLabelText('Channel'), { target: { value: 'UNOFFICIAL' } })
    expect(screen.getByLabelText('Channel')).toHaveValue('UNOFFICIAL')

    release({ ok: true, json: async () => ({ defaultChannel: 'OFFICIAL' }) })

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/settings'))
    expect(screen.getByLabelText('Channel')).toHaveValue('UNOFFICIAL')
  })

  it('falls back to OFFICIAL when the settings request is not ok', async () => {
    mockSettings({ ok: false, json: async () => ({ error: 'Internal error' }) })

    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/settings'))
    expect(screen.getByLabelText('Channel')).toHaveValue('OFFICIAL')
  })

  it('falls back to OFFICIAL when the settings request throws', async () => {
    mockSettings(() => Promise.reject(new Error('Network error')))

    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/settings'))
    expect(screen.getByLabelText('Channel')).toHaveValue('OFFICIAL')
  })

  it('falls back to OFFICIAL when defaultChannel is missing or unrecognised', async () => {
    mockSettings({ ok: true, json: async () => ({ botKillSwitch: false }) })

    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/settings'))
    expect(screen.getByLabelText('Channel')).toHaveValue('OFFICIAL')
  })
})
