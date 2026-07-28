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
    expect(screen.queryByText('Belum ada template.')).not.toBeInTheDocument()
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

    expect(await screen.findByText('Belum ada template.')).toBeInTheDocument()
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

describe('ComposeBox attachments', () => {
  function mockFetch(routes: { uploads?: unknown; send?: unknown } = {}) {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/uploads') {
          const r = routes.uploads ?? { ok: true, json: async () => ({ url: 'https://x.test/uploads/f.jpg', type: 'image', mimeType: 'image/jpeg', fileName: 'foto.jpg' }) }
          return typeof r === 'function' ? (r as () => unknown)() : Promise.resolve(r)
        }
        if (url === '/api/send') {
          const r = routes.send ?? { ok: true, status: 200, json: async () => ({ id: 'msg_1', deliveryStatus: 'SENT' }) }
          return typeof r === 'function' ? (r as () => unknown)() : Promise.resolve(r)
        }
        return Promise.resolve({ ok: true, json: async () => ({ defaultChannel: 'OFFICIAL' }) })
      })
    )
  }

  function selectFile(file: File) {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
  }

  it('uploads a selected file and shows an attachment preview chip with its filename', async () => {
    mockFetch()
    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)

    selectFile(new File(['x'], 'foto.jpg', { type: 'image/jpeg' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/uploads', expect.objectContaining({ method: 'POST' })))
    expect(await screen.findByAltText(/foto\.jpg/)).toBeInTheDocument()
  })

  it('sends a media-only message (no caption) with the uploaded attachment', async () => {
    mockFetch()
    const onSent = vi.fn()
    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={onSent} onBotToggled={() => {}} />)

    selectFile(new File(['x'], 'foto.jpg', { type: 'image/jpeg' }))
    await screen.findByAltText(/foto\.jpg/)

    fireEvent.click(screen.getByText('Kirim'))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/send', expect.objectContaining({ method: 'POST' })))
    const [, options] = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/send')!
    expect(JSON.parse((options as RequestInit).body as string)).toEqual(
      expect.objectContaining({
        media: { url: 'https://x.test/uploads/f.jpg', type: 'image', mimeType: 'image/jpeg', fileName: 'foto.jpg' },
      })
    )
    await waitFor(() => expect(onSent).toHaveBeenCalledWith(expect.objectContaining({ mediaUrl: 'https://x.test/uploads/f.jpg', type: 'image' })))
  })

  it('removes the staged attachment when its cancel button is clicked, without sending media', async () => {
    mockFetch()
    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)

    selectFile(new File(['x'], 'foto.jpg', { type: 'image/jpeg' }))
    await screen.findByAltText(/foto\.jpg/)

    fireEvent.click(screen.getByLabelText('Batalkan lampiran'))

    expect(screen.queryByText(/foto\.jpg/)).not.toBeInTheDocument()
  })

  it('shows an error and stages nothing when the upload itself fails', async () => {
    mockFetch({ uploads: { ok: false, json: async () => ({ error: 'Ukuran file melebihi batas 5MB untuk image' }) } })
    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)

    selectFile(new File(['x'], 'foto.jpg', { type: 'image/jpeg' }))

    expect(await screen.findByText('Ukuran file melebihi batas 5MB untuk image')).toBeInTheDocument()
    expect(screen.queryByText(/foto\.jpg/)).not.toBeInTheDocument()
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

describe('ComposeBox reply preview', () => {
  const replyingTo = {
    id: 'm_parent', direction: 'INBOUND' as const, content: 'Paketnya yang 3D2N kan?', channel: 'OFFICIAL',
    sentBy: 'CUSTOMER', deliveryStatus: 'DELIVERED', createdAt: new Date().toISOString(), botTrace: null,
  }

  it('shows the quoted preview bar when replyingTo is set', () => {
    render(
      <ComposeBox
        conversationId="conv_1"
        botEnabled={false}
        replyingTo={replyingTo}
        onCancelReply={() => {}}
        onSent={() => {}}
        onBotToggled={() => {}}
      />
    )
    expect(screen.getByText('Membalas Pelanggan')).toBeInTheDocument()
    expect(screen.getByText('Paketnya yang 3D2N kan?')).toBeInTheDocument()
  })

  it('does not show the preview bar when replyingTo is null', () => {
    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)
    expect(screen.queryByText(/^Membalas /)).not.toBeInTheDocument()
  })

  it('calls onCancelReply when the cancel button is clicked', () => {
    const onCancelReply = vi.fn()
    render(
      <ComposeBox
        conversationId="conv_1"
        botEnabled={false}
        replyingTo={replyingTo}
        onCancelReply={onCancelReply}
        onSent={() => {}}
        onBotToggled={() => {}}
      />
    )
    fireEvent.click(screen.getByLabelText('Batalkan balasan'))
    expect(onCancelReply).toHaveBeenCalled()
  })

  it('sends replyToId in the /api/send body and includes replyTo in the sent message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/send') return Promise.resolve({ ok: true, json: async () => ({ id: 'msg_1', deliveryStatus: 'SENT' }) })
        return Promise.resolve({ ok: true, json: async () => ({ defaultChannel: 'OFFICIAL' }) })
      })
    )
    const onSent = vi.fn()

    render(
      <ComposeBox
        conversationId="conv_1"
        botEnabled={false}
        replyingTo={replyingTo}
        onCancelReply={() => {}}
        onSent={onSent}
        onBotToggled={() => {}}
      />
    )
    fireEvent.change(await screen.findByLabelText('Pesan'), { target: { value: 'Iya benar' } })
    fireEvent.click(screen.getByText('Kirim'))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/send',
        expect.objectContaining({ body: JSON.stringify({ conversationId: 'conv_1', text: 'Iya benar', channel: 'OFFICIAL', replyToId: 'm_parent' }) })
      )
    )
    await waitFor(() =>
      expect(onSent).toHaveBeenCalledWith(
        expect.objectContaining({ replyTo: { id: 'm_parent', content: 'Paketnya yang 3D2N kan?', type: 'text', sentBy: 'CUSTOMER' } })
      )
    )
  })
})

describe('ComposeBox official template dispatch', () => {
  const quickReply = { id: 'tpl_qr', name: 'Cara Booking', type: 'QUICK_REPLY', category: 'Cara Booking', body: 'Ikuti panduan booking...', metaStatus: 'NOT_APPLICABLE', format: 'TEXT', variables: null }
  const simpleOfficial = { id: 'tpl_simple', name: 'sapaan', type: 'OFFICIAL', category: null, body: 'Halo, ada yang bisa dibantu?', metaStatus: 'APPROVED', format: 'TEXT', variables: [] }
  const paramOfficial = { id: 'tpl_param', name: 'booking_confirmation', type: 'OFFICIAL', category: null, body: 'Halo {{1}}, paket {{2}} dikonfirmasi.', metaStatus: 'APPROVED', format: 'TEXT', variables: ['nama', 'paket'] }
  const pendingOfficial = { id: 'tpl_pending', name: 'belum_disetujui', type: 'OFFICIAL', category: null, body: 'x', metaStatus: 'PENDING', format: 'TEXT', variables: [] }

  function mockFetch(templates: unknown[], sendResponse?: unknown) {
    return vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/templates') return Promise.resolve({ ok: true, json: async () => templates })
      if (url === '/api/send/template') {
        return Promise.resolve(
          sendResponse ?? { ok: true, json: async () => ({ id: 'msg_1', deliveryStatus: 'SENT', content: 'Halo, ada yang bisa dibantu?', templatePayload: { templateName: 'sapaan', bodyText: 'Halo, ada yang bisa dibantu?' } }) }
        )
      }
      return Promise.resolve({ ok: true, json: async () => ({ defaultChannel: 'OFFICIAL' }) })
    })
  }

  it('only lists APPROVED official templates, not PENDING ones', async () => {
    vi.stubGlobal('fetch', mockFetch([quickReply, simpleOfficial, pendingOfficial]))
    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)

    fireEvent.click(await screen.findByText('Template'))

    expect(await screen.findByText('sapaan')).toBeInTheDocument()
    expect(screen.queryByText('belum_disetujui')).not.toBeInTheDocument()
  })

  it('sends a variable-less official template immediately on click', async () => {
    const fetchMock = mockFetch([simpleOfficial])
    vi.stubGlobal('fetch', fetchMock)
    const onSent = vi.fn()
    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={onSent} onBotToggled={() => {}} />)

    fireEvent.click(await screen.findByText('Template'))
    fireEvent.click(await screen.findByText('sapaan'))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/send/template',
        expect.objectContaining({ body: JSON.stringify({ conversationId: 'conv_1', templateId: 'tpl_simple', bodyParams: [] }) })
      )
    )
    await waitFor(() =>
      expect(onSent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'template', content: 'Halo, ada yang bisa dibantu?', channel: 'OFFICIAL' })
      )
    )
  })

  it('opens a parameter form for a template with variables instead of sending immediately', async () => {
    vi.stubGlobal('fetch', mockFetch([paramOfficial]))
    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)

    fireEvent.click(await screen.findByText('Template'))
    fireEvent.click(await screen.findByText('booking_confirmation'))

    expect(await screen.findByText('Kirim Template: booking_confirmation')).toBeInTheDocument()
    expect(screen.getByLabelText('nama')).toBeInTheDocument()
    expect(screen.getByLabelText('paket')).toBeInTheDocument()
  })

  it('sends the filled-in parameters in order when the form is submitted', async () => {
    const fetchMock = mockFetch([paramOfficial])
    vi.stubGlobal('fetch', fetchMock)
    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)

    fireEvent.click(await screen.findByText('Template'))
    fireEvent.click(await screen.findByText('booking_confirmation'))
    fireEvent.change(await screen.findByLabelText('nama'), { target: { value: 'Bruno' } })
    fireEvent.change(screen.getByLabelText('paket'), { target: { value: 'Ijen 3D2N' } })
    fireEvent.click(screen.getByText('Kirim Template'))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/send/template',
        expect.objectContaining({ body: JSON.stringify({ conversationId: 'conv_1', templateId: 'tpl_param', bodyParams: ['Bruno', 'Ijen 3D2N'] }) })
      )
    )
  })

  it('closes the param form and returns to the list on Batal', async () => {
    vi.stubGlobal('fetch', mockFetch([paramOfficial]))
    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)

    fireEvent.click(await screen.findByText('Template'))
    fireEvent.click(await screen.findByText('booking_confirmation'))
    expect(await screen.findByText('Kirim Template: booking_confirmation')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Batal'))

    expect(screen.queryByText('Kirim Template: booking_confirmation')).not.toBeInTheDocument()
    expect(screen.getByText('booking_confirmation')).toBeInTheDocument()
  })

  it('shows an inline error and does not call onSent when the template send fails', async () => {
    const fetchMock = mockFetch([simpleOfficial], { ok: false, json: async () => ({ error: 'Template belum disetujui Meta' }) })
    vi.stubGlobal('fetch', fetchMock)
    const onSent = vi.fn()
    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={onSent} onBotToggled={() => {}} />)

    fireEvent.click(await screen.findByText('Template'))
    fireEvent.click(await screen.findByText('sapaan'))

    expect(await screen.findByText('Template belum disetujui Meta')).toBeInTheDocument()
    expect(onSent).not.toHaveBeenCalled()
  })

  const ltoOfficial = { id: 'tpl_lto', name: 'promo_akhir_tahun', type: 'OFFICIAL', category: null, body: 'Nikmati diskon spesial!', metaStatus: 'APPROVED', format: 'LTO', variables: [] }
  const couponOfficial = { id: 'tpl_coupon', name: 'kode_diskon', type: 'OFFICIAL', category: null, body: 'Gunakan kode ini.', metaStatus: 'APPROVED', format: 'COUPON', variables: [] }

  it('opens the param form for an LTO template even with zero body variables, and requires an expiration', async () => {
    vi.stubGlobal('fetch', mockFetch([ltoOfficial]))
    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)

    fireEvent.click(await screen.findByText('Template'))
    fireEvent.click(await screen.findByText('promo_akhir_tahun ⏳'))

    expect(await screen.findByText('Kirim Template: promo_akhir_tahun')).toBeInTheDocument()
    expect(screen.getByLabelText('Waktu kadaluarsa penawaran')).toBeInTheDocument()
    expect(screen.getByText('Kirim Template')).toBeDisabled()
  })

  it('sends an LTO template with the expiration converted to epoch milliseconds', async () => {
    const fetchMock = mockFetch([ltoOfficial])
    vi.stubGlobal('fetch', fetchMock)
    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)

    fireEvent.click(await screen.findByText('Template'))
    fireEvent.click(await screen.findByText('promo_akhir_tahun ⏳'))
    fireEvent.change(await screen.findByLabelText('Waktu kadaluarsa penawaran'), { target: { value: '2026-12-31T23:59' } })
    fireEvent.click(screen.getByText('Kirim Template'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/send/template', expect.anything()))
    const [, options] = fetchMock.mock.calls.find(([url]) => url === '/api/send/template')!
    const payload = JSON.parse((options as RequestInit).body as string)
    expect(payload.templateId).toBe('tpl_lto')
    expect(payload.expirationTimeMs).toBe(new Date('2026-12-31T23:59').getTime())
  })

  it('opens the param form for a COUPON template even with zero body variables, and requires a code', async () => {
    vi.stubGlobal('fetch', mockFetch([couponOfficial]))
    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)

    fireEvent.click(await screen.findByText('Template'))
    fireEvent.click(await screen.findByText('kode_diskon 🎟️'))

    expect(await screen.findByText('Kirim Template: kode_diskon')).toBeInTheDocument()
    expect(screen.getByLabelText('Kode kupon')).toBeInTheDocument()
    expect(screen.getByText('Kirim Template')).toBeDisabled()
  })

  it('sends a COUPON template with the real code the agent typed', async () => {
    const fetchMock = mockFetch([couponOfficial])
    vi.stubGlobal('fetch', fetchMock)
    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)

    fireEvent.click(await screen.findByText('Template'))
    fireEvent.click(await screen.findByText('kode_diskon 🎟️'))
    fireEvent.change(await screen.findByLabelText('Kode kupon'), { target: { value: 'PROMO25' } })
    fireEvent.click(screen.getByText('Kirim Template'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/send/template', expect.anything()))
    const [, options] = fetchMock.mock.calls.find(([url]) => url === '/api/send/template')!
    const payload = JSON.parse((options as RequestInit).body as string)
    expect(payload.templateId).toBe('tpl_coupon')
    expect(payload.couponCode).toBe('PROMO25')
  })
})
