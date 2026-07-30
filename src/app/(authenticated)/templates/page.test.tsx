import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import TemplatesPage from './page'

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => body } as Response)
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => jsonResponse([])))
})

afterEach(() => vi.restoreAllMocks())

describe('TemplatesPage — type selector', () => {
  it('only shows the type selector on the OFFICIAL tab', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Nama template')).toBeInTheDocument())

    expect(screen.getByRole('radiogroup')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Balasan Cepat'))
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
  })
})

describe('TemplatesPage — carousel builder', () => {
  it('shows the card builder only when format is switched to CAROUSEL', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())

    expect(screen.queryByText(/Kartu Carousel/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Carousel'))

    expect(screen.getByText('Kartu Carousel (1/10)')).toBeInTheDocument()
    expect(screen.getByLabelText('URL media kartu 1')).toBeInTheDocument()
  })

  it('adds and removes cards, capping the "+ Kartu" action out of view at 10', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Carousel'))

    fireEvent.click(screen.getByText('+ Kartu'))
    expect(screen.getByText('Kartu Carousel (2/10)')).toBeInTheDocument()
    expect(screen.getByLabelText('URL media kartu 2')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Hapus kartu 2'))
    expect(screen.getByText('Kartu Carousel (1/10)')).toBeInTheDocument()
    expect(screen.queryByLabelText('URL media kartu 2')).not.toBeInTheDocument()
  })

  it('does not offer to remove the last remaining card', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Carousel'))

    expect(screen.queryByLabelText('Hapus kartu 1')).not.toBeInTheDocument()
  })

  it('adds a button to a card and shows the URL field only for a URL button', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Carousel'))

    fireEvent.click(screen.getByText('+ Tombol'))
    expect(screen.getByLabelText('Label tombol 1 kartu 1')).toBeInTheDocument()
    expect(screen.queryByLabelText('URL tombol 1 kartu 1')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Tipe tombol 1 kartu 1'), { target: { value: 'URL' } })
    expect(screen.getByLabelText('URL tombol 1 kartu 1')).toBeInTheDocument()
  })

  it('caps buttons per card at 2, hiding "+ Tombol" once reached', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Carousel'))

    fireEvent.click(screen.getByText('+ Tombol'))
    fireEvent.click(screen.getByText('+ Tombol'))

    expect(screen.getByLabelText('Label tombol 1 kartu 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Label tombol 2 kartu 1')).toBeInTheDocument()
    expect(screen.queryByText('+ Tombol')).not.toBeInTheDocument()
  })

  it('disables submission until every card has a media URL and body', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Carousel'))
    fireEvent.change(screen.getByLabelText('Nama template'), { target: { value: 'katalog_paket' } })
    fireEvent.change(screen.getByLabelText('Isi pesan'), { target: { value: 'Halo, rekomendasi untuk Anda:' } })

    expect(screen.getByText('Ajukan ke Meta')).toBeDisabled()

    fireEvent.change(screen.getByLabelText('URL media kartu 1'), { target: { value: 'https://example.com/ijen.jpg' } })
    fireEvent.change(screen.getByLabelText('Isi kartu 1'), { target: { value: 'Paket Ijen 3D2N' } })

    await waitFor(() => expect(screen.getByText('Ajukan ke Meta')).not.toBeDisabled())
  })

  it('submits a CAROUSEL template with the built cards in the request body', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/templates' && init?.method === 'POST') {
        return jsonResponse({ id: 't1', metaStatus: 'PENDING', format: 'CAROUSEL' })
      }
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Carousel'))
    fireEvent.change(screen.getByLabelText('Nama template'), { target: { value: 'katalog_paket' } })
    fireEvent.change(screen.getByLabelText('Isi pesan'), { target: { value: 'Halo, rekomendasi untuk Anda:' } })
    fireEvent.change(screen.getByLabelText('URL media kartu 1'), { target: { value: 'https://example.com/ijen.jpg' } })
    fireEvent.change(screen.getByLabelText('Isi kartu 1'), { target: { value: 'Paket Ijen 3D2N' } })
    fireEvent.click(screen.getByText('+ Tombol'))
    fireEvent.change(screen.getByLabelText('Label tombol 1 kartu 1'), { target: { value: 'Pesan Sekarang' } })

    fireEvent.click(screen.getByText('Ajukan ke Meta'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/templates', expect.objectContaining({ method: 'POST' })))
    const [, options] = fetchMock.mock.calls.find(([url, init]) => url === '/api/templates' && init?.method === 'POST')!
    const payload = JSON.parse((options as RequestInit).body as string)
    expect(payload).toEqual(expect.objectContaining({
      name: 'katalog_paket',
      type: 'OFFICIAL',
      format: 'CAROUSEL',
      cards: [{
        mediaType: 'IMAGE',
        mediaUrl: 'https://example.com/ijen.jpg',
        bodyText: 'Paket Ijen 3D2N',
        buttons: [{ type: 'QUICK_REPLY', text: 'Pesan Sekarang' }],
      }],
    }))
  })

  it('shows a live carousel thumbnail in the template list', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse([
      {
        id: 't1', name: 'katalog_paket', type: 'OFFICIAL', format: 'CAROUSEL', metaStatus: 'APPROVED', category: null,
        body: 'Halo', variables: [],
        cards: [{ mediaType: 'IMAGE', mediaUrl: 'https://example.com/ijen.jpg', bodyText: 'Ijen', buttons: [] }],
        createdAt: new Date().toISOString(),
      },
    ])))

    render(<TemplatesPage />)

    expect(await screen.findByText('katalog_paket')).toBeInTheDocument()
    expect(screen.getByAltText('Ijen')).toHaveAttribute('src', 'https://example.com/ijen.jpg')
  })
})

describe('TemplatesPage — LTO builder', () => {
  it('shows the offer title field only when format is switched to LTO', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())

    expect(screen.queryByLabelText('Judul penawaran')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Penawaran Waktu Terbatas'))

    expect(screen.getByLabelText('Judul penawaran')).toBeInTheDocument()
  })

  it('disables submission until the offer title is filled in', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Penawaran Waktu Terbatas'))
    fireEvent.change(screen.getByLabelText('Nama template'), { target: { value: 'promo_akhir_tahun' } })
    fireEvent.change(screen.getByLabelText('Isi pesan'), { target: { value: 'Nikmati diskon spesial!' } })

    expect(screen.getByText('Ajukan ke Meta')).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Judul penawaran'), { target: { value: 'Diskon 25%' } })

    await waitFor(() => expect(screen.getByText('Ajukan ke Meta')).not.toBeDisabled())
  })

  it('submits an LTO template with format, offerTitle, and buttons in the request body', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/templates' && init?.method === 'POST') {
        return jsonResponse({ id: 't_lto', metaStatus: 'PENDING', format: 'LTO' })
      }
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Penawaran Waktu Terbatas'))
    fireEvent.change(screen.getByLabelText('Nama template'), { target: { value: 'promo_akhir_tahun' } })
    fireEvent.change(screen.getByLabelText('Isi pesan'), { target: { value: 'Nikmati diskon spesial!' } })
    fireEvent.change(screen.getByLabelText('Judul penawaran'), { target: { value: 'Diskon 25%' } })
    fireEvent.click(screen.getByText('+ Tombol'))
    fireEvent.change(screen.getByLabelText('Tipe tombol 1'), { target: { value: 'URL' } })
    fireEvent.change(screen.getByLabelText('Label tombol 1'), { target: { value: 'Lihat Promo' } })
    fireEvent.change(screen.getByLabelText('URL tombol 1'), { target: { value: 'https://example.com/promo' } })

    fireEvent.click(screen.getByText('Ajukan ke Meta'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/templates', expect.objectContaining({ method: 'POST' })))
    const [, options] = fetchMock.mock.calls.find(([url, init]) => url === '/api/templates' && init?.method === 'POST')!
    const payload = JSON.parse((options as RequestInit).body as string)
    expect(payload).toEqual(expect.objectContaining({
      name: 'promo_akhir_tahun',
      format: 'LTO',
      offerTitle: 'Diskon 25%',
      buttons: [{ type: 'URL', text: 'Lihat Promo', url: 'https://example.com/promo' }],
    }))
  })

  it('shows the LTO offer banner in the template list', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse([
      { id: 't1', name: 'promo_akhir_tahun', type: 'OFFICIAL', format: 'LTO', metaStatus: 'APPROVED', category: 'MARKETING', body: 'Halo', variables: [], cards: null, offerTitle: 'Diskon 25%', buttons: [], couponButtonText: null, couponExampleCode: null, createdAt: new Date().toISOString() },
    ])))

    render(<TemplatesPage />)

    expect(await screen.findByText(/Diskon 25%/)).toBeInTheDocument()
  })
})

describe('TemplatesPage — Coupon builder', () => {
  it('shows the coupon fields only when format is switched to COUPON', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())

    expect(screen.queryByLabelText('Label tombol kupon')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Kode Kupon'))

    expect(screen.getByLabelText('Label tombol kupon')).toBeInTheDocument()
    expect(screen.getByLabelText('Contoh kode kupon')).toBeInTheDocument()
  })

  it('disables submission until both coupon fields are filled in', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Kode Kupon'))
    fireEvent.change(screen.getByLabelText('Nama template'), { target: { value: 'kode_diskon' } })
    fireEvent.change(screen.getByLabelText('Isi pesan'), { target: { value: 'Gunakan kode ini.' } })

    expect(screen.getByText('Ajukan ke Meta')).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Label tombol kupon'), { target: { value: 'Salin Kode' } })
    expect(screen.getByText('Ajukan ke Meta')).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Contoh kode kupon'), { target: { value: 'PROMO25' } })
    await waitFor(() => expect(screen.getByText('Ajukan ke Meta')).not.toBeDisabled())
  })

  it('submits a COUPON template with format, couponButtonText, couponExampleCode, and an optional footer', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/templates' && init?.method === 'POST') {
        return jsonResponse({ id: 't_coupon', metaStatus: 'PENDING', format: 'COUPON' })
      }
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Kode Kupon'))
    fireEvent.change(screen.getByLabelText('Nama template'), { target: { value: 'kode_diskon' } })
    fireEvent.change(screen.getByLabelText('Isi pesan'), { target: { value: 'Gunakan kode ini.' } })
    fireEvent.change(screen.getByLabelText('Label tombol kupon'), { target: { value: 'Salin Kode' } })
    fireEvent.change(screen.getByLabelText('Contoh kode kupon'), { target: { value: 'PROMO25' } })
    fireEvent.change(screen.getByLabelText('Footer'), { target: { value: 'JVTO Tour' } })

    fireEvent.click(screen.getByText('Ajukan ke Meta'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/templates', expect.objectContaining({ method: 'POST' })))
    const [, options] = fetchMock.mock.calls.find(([url, init]) => url === '/api/templates' && init?.method === 'POST')!
    const payload = JSON.parse((options as RequestInit).body as string)
    expect(payload).toEqual(expect.objectContaining({
      name: 'kode_diskon',
      format: 'COUPON',
      couponButtonText: 'Salin Kode',
      couponExampleCode: 'PROMO25',
      footer: 'JVTO Tour',
    }))
  })

  it('shows the coupon button label in the template list', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse([
      { id: 't1', name: 'kode_diskon', type: 'OFFICIAL', format: 'COUPON', metaStatus: 'APPROVED', category: 'UTILITY', body: 'Halo', variables: [], cards: null, offerTitle: null, buttons: null, couponButtonText: 'Salin Kode', couponExampleCode: 'PROMO25', createdAt: new Date().toISOString() },
    ])))

    render(<TemplatesPage />)

    expect(await screen.findByText(/Salin Kode/)).toBeInTheDocument()
  })
})

describe('TemplatesPage — AUTH builder', () => {
  it('shows an AUTHENTICATION category hint only when AUTH is selected', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())

    expect(screen.queryByText(/AUTHENTICATION/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Autentikasi'))

    expect(screen.getByText(/AUTHENTICATION/)).toBeInTheDocument()
  })

  it('submits an AUTH template via the same TEXT-like fields, locking category to AUTHENTICATION server-side', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/templates' && init?.method === 'POST') {
        return jsonResponse({ id: 't_auth', metaStatus: 'PENDING', format: 'AUTH' })
      }
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Autentikasi'))
    fireEvent.change(screen.getByLabelText('Nama template'), { target: { value: 'kode_otp' } })
    fireEvent.click(screen.getByText('+ Variabel'))

    fireEvent.click(screen.getByText('Ajukan ke Meta'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/templates', expect.objectContaining({ method: 'POST' })))
    const [, options] = fetchMock.mock.calls.find(([url, init]) => url === '/api/templates' && init?.method === 'POST')!
    const payload = JSON.parse((options as RequestInit).body as string)
    expect(payload).toEqual(expect.objectContaining({ name: 'kode_otp', format: 'AUTH', body: '{{1}}' }))
  })
})

describe('TemplatesPage — header, footer, and buttons (TEXT/AUTH)', () => {
  it('shows the header, footer, and buttons fields for TEXT by default, not for CAROUSEL', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())

    expect(screen.getByLabelText('Tipe header')).toBeInTheDocument()
    expect(screen.getByLabelText('Footer')).toBeInTheDocument()
    expect(screen.getByText('Tombol (opsional)')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Carousel'))
    expect(screen.queryByLabelText('Tipe header')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Footer')).not.toBeInTheDocument()
  })

  it('submits a TEXT template with a TEXT header, footer, and a top-level button', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/templates' && init?.method === 'POST') return jsonResponse({ id: 't1', metaStatus: 'PENDING' })
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Nama template'), { target: { value: 'sapaan' } })
    fireEvent.change(screen.getByLabelText('Isi pesan'), { target: { value: 'Halo!' } })
    fireEvent.change(screen.getByLabelText('Tipe header'), { target: { value: 'TEXT' } })
    fireEvent.change(screen.getByLabelText('Teks header'), { target: { value: 'Selamat Datang' } })
    fireEvent.change(screen.getByLabelText('Footer'), { target: { value: 'JVTO Tour' } })
    fireEvent.click(screen.getByText('+ Tombol'))
    fireEvent.change(screen.getByLabelText('Label tombol 1'), { target: { value: 'Ya' } })

    fireEvent.click(screen.getByText('Ajukan ke Meta'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/templates', expect.objectContaining({ method: 'POST' })))
    const [, options] = fetchMock.mock.calls.find(([url, init]) => url === '/api/templates' && init?.method === 'POST')!
    const payload = JSON.parse((options as RequestInit).body as string)
    expect(payload).toEqual(expect.objectContaining({
      name: 'sapaan',
      format: 'TEXT',
      header: { type: 'TEXT', text: 'Selamat Datang' },
      footer: 'JVTO Tour',
      buttons: [{ type: 'QUICK_REPLY', text: 'Ya' }],
    }))
  })

  it('shows a media URL input when the header type is IMAGE', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Tipe header'), { target: { value: 'IMAGE' } })

    expect(screen.getByLabelText('URL media header')).toBeInTheDocument()
  })
})

describe('TemplatesPage — variables', () => {
  it('has no binding section until a {{n}} placeholder exists in the body', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Nama template')).toBeInTheDocument())

    expect(screen.queryByText('Sumber Nilai Variabel')).not.toBeInTheDocument()
  })

  it('clicking + Variabel inserts {{n}} into the body and immediately shows a binding row for it', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Nama template')).toBeInTheDocument())

    fireEvent.click(screen.getByText('+ Variabel'))

    expect(screen.getByLabelText('Isi pesan')).toHaveValue('{{1}}')
    expect(screen.getByText('Sumber Nilai Variabel')).toBeInTheDocument()
    expect(screen.getByLabelText('Sumber nilai untuk {{1}}')).toBeInTheDocument()

    fireEvent.click(screen.getByText('+ Variabel'))
    expect(screen.getByLabelText('Isi pesan')).toHaveValue('{{1}}{{2}}')
    expect(screen.getByLabelText('Sumber nilai untuk {{2}}')).toBeInTheDocument()
  })

  it('derives the binding rows directly from {{n}} placeholders typed into the body, no button needed', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Nama template')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Isi pesan'), { target: { value: 'Halo {{1}}, sisa {{2}}.' } })

    expect(screen.getByLabelText('Sumber nilai untuk {{1}}')).toBeInTheDocument()
    expect(screen.getByLabelText('Sumber nilai untuk {{2}}')).toBeInTheDocument()
  })

  it('shows the same body + bindings behavior on the Balasan Cepat tab too', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Nama template')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Balasan Cepat'))

    fireEvent.click(screen.getByText('+ Variabel'))

    expect(screen.getByLabelText('Isi pesan')).toHaveValue('{{1}}')
    expect(screen.getByText('Sumber Nilai Variabel')).toBeInTheDocument()
  })

  it('submits variableBindings only for positions with a chosen source, omitting "Isi manual" ones', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/templates' && init?.method === 'POST') return jsonResponse({ id: 't1', metaStatus: 'PENDING' })
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Nama template'), { target: { value: 'booking_confirmation' } })
    fireEvent.change(screen.getByLabelText('Isi pesan'), { target: { value: 'Halo {{1}}, sisa {{2}}.' } })
    fireEvent.change(screen.getByLabelText('Sumber nilai untuk {{1}}'), { target: { value: 'contactName' } })
    // {{2}} deliberately left as "Isi manual".

    fireEvent.click(screen.getByText('Ajukan ke Meta'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/templates', expect.objectContaining({ method: 'POST' })))
    const [, options] = fetchMock.mock.calls.find(([url, init]) => url === '/api/templates' && init?.method === 'POST')!
    const payload = JSON.parse((options as RequestInit).body as string)
    expect(payload.variableBindings).toEqual({ '1': 'contactName' })
    expect(payload.variables).toBeUndefined()
  })

  it('drops a stale binding when the body no longer has that many variables before submitting', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/templates' && init?.method === 'POST') return jsonResponse({ id: 't1', metaStatus: 'PENDING' })
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Nama template'), { target: { value: 'booking_confirmation' } })
    fireEvent.change(screen.getByLabelText('Isi pesan'), { target: { value: 'Halo {{1}}, sisa {{2}}.' } })
    fireEvent.change(screen.getByLabelText('Sumber nilai untuk {{2}}'), { target: { value: 'financialBalance' } })

    // Edit the body back down to one variable -- the stale {{2}} binding must not resurrect.
    fireEvent.change(screen.getByLabelText('Isi pesan'), { target: { value: 'Halo {{1}}.' } })

    fireEvent.click(screen.getByText('Ajukan ke Meta'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/templates', expect.objectContaining({ method: 'POST' })))
    const [, options] = fetchMock.mock.calls.find(([url, init]) => url === '/api/templates' && init?.method === 'POST')!
    const payload = JSON.parse((options as RequestInit).body as string)
    expect(payload.variableBindings).toBeUndefined()
  })
})

describe('TemplatesPage — live preview', () => {
  it('shows a preview column that updates live as the name and body are typed', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Nama template')).toBeInTheDocument())

    expect(screen.getByText('Preview')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Nama template'), { target: { value: 'sapaan_resmi' } })
    fireEvent.change(screen.getByLabelText('Isi pesan'), { target: { value: 'Halo, ada yang bisa dibantu?' } })

    const preview = within(screen.getByTestId('template-preview'))
    expect(preview.getByText('sapaan_resmi')).toBeInTheDocument()
    expect(preview.getByText('Halo, ada yang bisa dibantu?')).toBeInTheDocument()
  })

  it('reflects the LTO offer title in the preview once that format is selected', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Penawaran Waktu Terbatas'))

    fireEvent.change(screen.getByLabelText('Judul penawaran'), { target: { value: 'Diskon 25%' } })

    expect(within(screen.getByTestId('template-preview')).getByText(/Diskon 25%/)).toBeInTheDocument()
  })

  it('reflects a TEXT header typed into the form', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Tipe header'), { target: { value: 'TEXT' } })
    fireEvent.change(screen.getByLabelText('Teks header'), { target: { value: 'Selamat Datang' } })

    expect(within(screen.getByTestId('template-preview')).getByText('Selamat Datang')).toBeInTheDocument()
  })

  it('also shows a live preview on the Balasan Cepat tab', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Nama template')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Balasan Cepat'))

    fireEvent.change(screen.getByLabelText('Isi pesan'), { target: { value: 'Info harga paket Ijen' } })

    expect(within(screen.getByTestId('template-preview')).getByText('Info harga paket Ijen')).toBeInTheDocument()
  })
})

describe('TemplatesPage — template list', () => {
  it('shows an empty state when there are no templates', async () => {
    render(<TemplatesPage />)
    expect(await screen.findByText('Belum ada template.')).toBeInTheDocument()
  })

  it('shows each template as a live preview card, filtered to the active tab', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse([
      { id: 't1', name: 'sapaan_resmi', type: 'OFFICIAL', format: 'TEXT', metaStatus: 'APPROVED', category: 'UTILITY', body: 'Halo', variables: [], createdAt: new Date().toISOString() },
      { id: 't2', name: 'balasan_cepat', type: 'QUICK_REPLY', format: 'TEXT', metaStatus: 'NOT_APPLICABLE', category: null, body: 'Halo juga', variables: [], createdAt: new Date().toISOString() },
    ])))

    render(<TemplatesPage />)

    expect(await screen.findByText('sapaan_resmi')).toBeInTheDocument()
    expect(screen.queryByText('balasan_cepat')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Balasan Cepat'))
    expect(screen.getByText('balasan_cepat')).toBeInTheDocument()
    expect(screen.queryByText('sapaan_resmi')).not.toBeInTheDocument()
  })

  it('shows the Meta status badge only for OFFICIAL templates', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse([
      { id: 't1', name: 'sapaan_resmi', type: 'OFFICIAL', format: 'TEXT', metaStatus: 'APPROVED', category: 'UTILITY', body: 'Halo', variables: [], createdAt: new Date().toISOString() },
    ])))

    render(<TemplatesPage />)

    expect(await screen.findByText('Disetujui')).toBeInTheDocument()
  })

  it('deletes a template after the confirm dialog is accepted', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/templates/t1' && init?.method === 'DELETE') return jsonResponse({ ok: true })
      if (url === '/api/templates' && !init) {
        return jsonResponse([
          { id: 't1', name: 'sapaan_resmi', type: 'OFFICIAL', format: 'TEXT', metaStatus: 'APPROVED', category: 'UTILITY', body: 'Halo', variables: [], createdAt: new Date().toISOString() },
        ])
      }
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<TemplatesPage />)
    await screen.findByText('sapaan_resmi')

    fireEvent.click(screen.getByText('Hapus'))

    await waitFor(() => expect(screen.queryByText('sapaan_resmi')).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/templates/t1', expect.objectContaining({ method: 'DELETE' }))
  })
})

describe('TemplatesPage — template library', () => {
  it('only shows the library panel on the Resmi (Meta) tab', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Nama template')).toBeInTheDocument())

    expect(screen.getByText('📚 Template Siap Pakai (Meta)')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Balasan Cepat'))
    expect(screen.queryByText('📚 Template Siap Pakai (Meta)')).not.toBeInTheDocument()
  })

  it('fetches and lists library results when opened', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.startsWith('/api/templates/library')) {
          return jsonResponse({
            templates: [
              { id: '1', name: 'booking_confirmation_3', category: 'UTILITY', language: 'en_US', header: null, body: 'Hi {{1}}, your booking is confirmed.', buttons: [] },
            ],
          })
        }
        return jsonResponse([])
      })
    )
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Nama template')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Jelajahi'))

    expect(await screen.findByText('booking_confirmation_3')).toBeInTheDocument()
    expect(screen.getByText('Hi {{1}}, your booking is confirmed.')).toBeInTheDocument()
  })

  it('re-searches with the chosen filters', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith('/api/templates/library')) return jsonResponse({ templates: [] })
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Nama template')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Jelajahi'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/templates/library')))

    fireEvent.change(screen.getByLabelText('Filter kategori'), { target: { value: 'UTILITY' } })
    fireEvent.change(screen.getByLabelText('Filter bahasa'), { target: { value: 'en_US' } })
    fireEvent.click(screen.getByText('Cari'))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/templates/library?category=UTILITY&language=en_US')
    )
  })

  it('pre-fills the form (name, category, body, header, buttons) when a result is picked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.startsWith('/api/templates/library')) {
          return jsonResponse({
            templates: [{
              id: '1', name: 'booking_confirmation_3', category: 'UTILITY', language: 'en_US',
              header: 'Booking Confirmed', body: 'Hi {{1}}, your booking is confirmed.',
              buttons: [{ type: 'URL', text: 'View Booking', url: 'https://example.com' }],
            }],
          })
        }
        return jsonResponse([])
      })
    )
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Nama template')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Jelajahi'))
    await screen.findByText('booking_confirmation_3')

    fireEvent.click(screen.getByText('booking_confirmation_3'))

    expect(screen.getByLabelText('Nama template')).toHaveValue('booking_confirmation_3')
    expect(screen.getByLabelText('Kategori')).toHaveValue('UTILITY')
    expect(screen.getByLabelText('Isi pesan')).toHaveValue('Hi {{1}}, your booking is confirmed.')
    expect(screen.getByLabelText('Teks header')).toHaveValue('Booking Confirmed')
    expect(screen.getByLabelText('Label tombol 1')).toHaveValue('View Booking')
    // The library panel itself closes once a result is picked (its own filter controls are
    // gone) -- the name now legitimately reappears as the live preview's own caption, so that
    // isn't what proves the panel closed.
    expect(screen.queryByLabelText('Filter kategori')).not.toBeInTheDocument()
  })

  it('shows an inline error when the search fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.startsWith('/api/templates/library')) return jsonResponse({ error: 'Meta Graph API error' }, false)
        return jsonResponse([])
      })
    )
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Nama template')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Jelajahi'))

    expect(await screen.findByText('Meta Graph API error')).toBeInTheDocument()
  })
})

describe('TemplatesPage — AI template suggestions', () => {
  it('only shows the suggestion panel on the Balasan Cepat tab, not Resmi (Meta)', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Nama template')).toBeInTheDocument())

    expect(screen.queryByText('✨ Rekomendasi Template (AI)')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Balasan Cepat'))
    expect(screen.getByText('✨ Rekomendasi Template (AI)')).toBeInTheDocument()
  })

  it('fetches and shows suggestions with their variables, bindings, and reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/templates/suggest' && init?.method === 'POST') {
          return jsonResponse({
            suggestions: [
              {
                name: 'info_harga_paket',
                body: 'Halo {{1}}, harga paket kami mulai dari Rp1.500.000.',
                variables: [{ name: 'nama', bindingKey: 'contactName' }],
                reason: 'Banyak pelanggan menanyakan harga paket',
              },
            ],
          })
        }
        return jsonResponse([])
      })
    )
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Nama template')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Balasan Cepat'))

    fireEvent.click(screen.getByText('Buat Rekomendasi'))

    expect(await screen.findByText('info_harga_paket')).toBeInTheDocument()
    expect(screen.getByText('Halo {{1}}, harga paket kami mulai dari Rp1.500.000.')).toBeInTheDocument()
    expect(screen.getByText(/nama \(Nama Kontak \(WhatsApp\)\)/)).toBeInTheDocument()
    expect(screen.getByText('Banyak pelanggan menanyakan harga paket')).toBeInTheDocument()
  })

  it('labels an unbound suggested variable as "isi manual"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/templates/suggest' && init?.method === 'POST') {
          return jsonResponse({ suggestions: [{ name: 'x', body: 'y {{1}}', variables: [{ name: 'catatan', bindingKey: null }], reason: 'z' }] })
        }
        return jsonResponse([])
      })
    )
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Nama template')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Balasan Cepat'))
    fireEvent.click(screen.getByText('Buat Rekomendasi'))

    expect(await screen.findByText(/catatan \(isi manual\)/)).toBeInTheDocument()
  })

  it('shows an empty state when no clear pattern is found', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/templates/suggest' && init?.method === 'POST') return jsonResponse({ suggestions: [] })
        return jsonResponse([])
      })
    )
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Nama template')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Balasan Cepat'))
    fireEvent.click(screen.getByText('Buat Rekomendasi'))

    expect(await screen.findByText('Belum ada pola pertanyaan yang cukup jelas untuk direkomendasikan.')).toBeInTheDocument()
  })

  it('shows an inline error when the suggest request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/templates/suggest' && init?.method === 'POST') return jsonResponse({ error: 'Model tidak mengembalikan JSON yang valid' }, false)
        return jsonResponse([])
      })
    )
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Nama template')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Balasan Cepat'))
    fireEvent.click(screen.getByText('Buat Rekomendasi'))

    expect(await screen.findByText('Model tidak mengembalikan JSON yang valid')).toBeInTheDocument()
  })

  it('saves only the checked suggestions as real QUICK_REPLY templates, carrying their variables and bindings', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/templates/suggest' && init?.method === 'POST') {
        return jsonResponse({
          suggestions: [
            { name: 'info_harga', body: 'Harga {{1}}', variables: [{ name: 'paket', bindingKey: 'package' }], reason: 'a' },
            { name: 'info_jam', body: 'Kami buka jam 8', variables: [], reason: 'b' },
          ],
        })
      }
      if (url === '/api/templates' && init?.method === 'POST') return jsonResponse({ id: 't_new', metaStatus: 'NOT_APPLICABLE' })
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Nama template')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Balasan Cepat'))
    fireEvent.click(screen.getByText('Buat Rekomendasi'))
    await screen.findByText('info_harga')

    fireEvent.click(screen.getByLabelText('Pilih rekomendasi info_harga'))
    fireEvent.click(screen.getByText('Simpan Terpilih (1)'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/templates', expect.objectContaining({ method: 'POST' })))
    const [, options] = fetchMock.mock.calls.find(([url, init]) => url === '/api/templates' && init?.method === 'POST')!
    const payload = JSON.parse((options as RequestInit).body as string)
    expect(payload).toEqual({
      name: 'info_harga',
      type: 'QUICK_REPLY',
      body: 'Harga {{1}}',
      variables: ['paket'],
      variableBindings: { '1': 'package' },
    })
    // Only the checked suggestion was saved -- info_jam was left unchecked.
    expect(fetchMock.mock.calls.filter(([url, init]) => url === '/api/templates' && init?.method === 'POST')).toHaveLength(1)
  })

  it('disables the save button until at least one suggestion is checked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/templates/suggest' && init?.method === 'POST') {
          return jsonResponse({ suggestions: [{ name: 'x', body: 'y', variables: [], reason: 'z' }] })
        }
        return jsonResponse([])
      })
    )
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Nama template')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Balasan Cepat'))
    fireEvent.click(screen.getByText('Buat Rekomendasi'))
    await screen.findByText('x')

    expect(screen.getByText('Simpan Terpilih (0)')).toBeDisabled()

    fireEvent.click(screen.getByLabelText('Pilih rekomendasi x'))
    expect(screen.getByText('Simpan Terpilih (1)')).not.toBeDisabled()
  })
})
