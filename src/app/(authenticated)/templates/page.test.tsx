import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TemplatesPage from './page'

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => body } as Response)
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => jsonResponse([])))
})

describe('TemplatesPage — carousel builder', () => {
  it('only shows the format toggle and carousel builder on the OFFICIAL tab', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Nama template')).toBeInTheDocument())

    expect(screen.getByLabelText('Format template')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Balasan Cepat'))
    expect(screen.queryByLabelText('Format template')).not.toBeInTheDocument()
  })

  it('shows the card builder only when format is switched to CAROUSEL', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Format template')).toBeInTheDocument())

    expect(screen.queryByText(/Kartu Carousel/)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Format template'), { target: { value: 'CAROUSEL' } })

    expect(screen.getByText('Kartu Carousel (1/10)')).toBeInTheDocument()
    expect(screen.getByLabelText('URL media kartu 1')).toBeInTheDocument()
  })

  it('adds and removes cards, capping the "+ Kartu" action out of view at 10', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Format template')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Format template'), { target: { value: 'CAROUSEL' } })

    fireEvent.click(screen.getByText('+ Kartu'))
    expect(screen.getByText('Kartu Carousel (2/10)')).toBeInTheDocument()
    expect(screen.getByLabelText('URL media kartu 2')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Hapus kartu 2'))
    expect(screen.getByText('Kartu Carousel (1/10)')).toBeInTheDocument()
    expect(screen.queryByLabelText('URL media kartu 2')).not.toBeInTheDocument()
  })

  it('does not offer to remove the last remaining card', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Format template')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Format template'), { target: { value: 'CAROUSEL' } })

    expect(screen.queryByLabelText('Hapus kartu 1')).not.toBeInTheDocument()
  })

  it('adds a button to a card and shows the URL field only for a URL button', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Format template')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Format template'), { target: { value: 'CAROUSEL' } })

    fireEvent.click(screen.getByText('+ Tombol'))
    expect(screen.getByLabelText('Label tombol 1 kartu 1')).toBeInTheDocument()
    expect(screen.queryByLabelText('URL tombol 1 kartu 1')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Tipe tombol 1 kartu 1'), { target: { value: 'URL' } })
    expect(screen.getByLabelText('URL tombol 1 kartu 1')).toBeInTheDocument()
  })

  it('caps buttons per card at 2, hiding "+ Tombol" once reached', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Format template')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Format template'), { target: { value: 'CAROUSEL' } })

    fireEvent.click(screen.getByText('+ Tombol'))
    fireEvent.click(screen.getByText('+ Tombol'))

    expect(screen.getByLabelText('Label tombol 1 kartu 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Label tombol 2 kartu 1')).toBeInTheDocument()
    expect(screen.queryByText('+ Tombol')).not.toBeInTheDocument()
  })

  it('disables submission until every card has a media URL and body', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Format template')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Format template'), { target: { value: 'CAROUSEL' } })
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
    await waitFor(() => expect(screen.getByLabelText('Format template')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Format template'), { target: { value: 'CAROUSEL' } })
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

  it('shows a 🎠 marker next to a carousel template in the list', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse([
      { id: 't1', name: 'katalog_paket', type: 'OFFICIAL', format: 'CAROUSEL', metaStatus: 'APPROVED', category: null, body: 'Halo', variables: [], cards: [], createdAt: new Date().toISOString() },
    ])))

    render(<TemplatesPage />)

    expect(await screen.findByText(/katalog_paket/)).toHaveTextContent('katalog_paket 🎠')
  })
})

describe('TemplatesPage — LTO builder', () => {
  it('shows the offer title field only when format is switched to LTO', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Format template')).toBeInTheDocument())

    expect(screen.queryByLabelText('Judul penawaran')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Format template'), { target: { value: 'LTO' } })

    expect(screen.getByLabelText('Judul penawaran')).toBeInTheDocument()
  })

  it('disables submission until the offer title is filled in', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Format template')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Format template'), { target: { value: 'LTO' } })
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
    await waitFor(() => expect(screen.getByLabelText('Format template')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Format template'), { target: { value: 'LTO' } })
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

  it('shows a ⏳ marker next to an LTO template in the list', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse([
      { id: 't1', name: 'promo_akhir_tahun', type: 'OFFICIAL', format: 'LTO', metaStatus: 'APPROVED', category: 'MARKETING', body: 'Halo', variables: [], cards: null, offerTitle: 'Diskon 25%', buttons: [], couponButtonText: null, couponExampleCode: null, createdAt: new Date().toISOString() },
    ])))

    render(<TemplatesPage />)

    expect(await screen.findByText(/promo_akhir_tahun/)).toHaveTextContent('promo_akhir_tahun ⏳')
  })
})

describe('TemplatesPage — Coupon builder', () => {
  it('shows the coupon fields only when format is switched to COUPON', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Format template')).toBeInTheDocument())

    expect(screen.queryByLabelText('Label tombol kupon')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Format template'), { target: { value: 'COUPON' } })

    expect(screen.getByLabelText('Label tombol kupon')).toBeInTheDocument()
    expect(screen.getByLabelText('Contoh kode kupon')).toBeInTheDocument()
  })

  it('disables submission until both coupon fields are filled in', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Format template')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Format template'), { target: { value: 'COUPON' } })
    fireEvent.change(screen.getByLabelText('Nama template'), { target: { value: 'kode_diskon' } })
    fireEvent.change(screen.getByLabelText('Isi pesan'), { target: { value: 'Gunakan kode ini.' } })

    expect(screen.getByText('Ajukan ke Meta')).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Label tombol kupon'), { target: { value: 'Salin Kode' } })
    expect(screen.getByText('Ajukan ke Meta')).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Contoh kode kupon'), { target: { value: 'PROMO25' } })
    await waitFor(() => expect(screen.getByText('Ajukan ke Meta')).not.toBeDisabled())
  })

  it('submits a COUPON template with format, couponButtonText, and couponExampleCode in the request body', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/templates' && init?.method === 'POST') {
        return jsonResponse({ id: 't_coupon', metaStatus: 'PENDING', format: 'COUPON' })
      }
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Format template')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Format template'), { target: { value: 'COUPON' } })
    fireEvent.change(screen.getByLabelText('Nama template'), { target: { value: 'kode_diskon' } })
    fireEvent.change(screen.getByLabelText('Isi pesan'), { target: { value: 'Gunakan kode ini.' } })
    fireEvent.change(screen.getByLabelText('Label tombol kupon'), { target: { value: 'Salin Kode' } })
    fireEvent.change(screen.getByLabelText('Contoh kode kupon'), { target: { value: 'PROMO25' } })

    fireEvent.click(screen.getByText('Ajukan ke Meta'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/templates', expect.objectContaining({ method: 'POST' })))
    const [, options] = fetchMock.mock.calls.find(([url, init]) => url === '/api/templates' && init?.method === 'POST')!
    const payload = JSON.parse((options as RequestInit).body as string)
    expect(payload).toEqual(expect.objectContaining({
      name: 'kode_diskon',
      format: 'COUPON',
      couponButtonText: 'Salin Kode',
      couponExampleCode: 'PROMO25',
    }))
  })

  it('shows a 🎟️ marker next to a coupon template in the list', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse([
      { id: 't1', name: 'kode_diskon', type: 'OFFICIAL', format: 'COUPON', metaStatus: 'APPROVED', category: 'UTILITY', body: 'Halo', variables: [], cards: null, offerTitle: null, buttons: null, couponButtonText: 'Salin Kode', couponExampleCode: 'PROMO25', createdAt: new Date().toISOString() },
    ])))

    render(<TemplatesPage />)

    expect(await screen.findByText(/kode_diskon/)).toHaveTextContent('kode_diskon 🎟️')
  })
})

// Adds one named variable row at a time via the single "+ Tambah Variabel" button (which also
// drops the {{n}} placeholder into the body) -- mirrors how an agent actually builds the list.
function addNamedVariables(names: string[]) {
  names.forEach((name, i) => {
    fireEvent.click(screen.getByText('+ Tambah Variabel'))
    fireEvent.change(screen.getByLabelText(`Nama variabel ${i + 1}`), { target: { value: name } })
  })
}

describe('TemplatesPage — variable create/edit/delete', () => {
  it('has no variable rows until "+ Tambah Variabel" is clicked', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByText('+ Tambah Variabel')).toBeInTheDocument())

    expect(screen.queryByLabelText('Nama variabel 1')).not.toBeInTheDocument()
  })

  it('adds a new editable row per click, and edits are reflected immediately', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByText('+ Tambah Variabel')).toBeInTheDocument())

    addNamedVariables(['nama', 'paket'])

    expect(screen.getByLabelText('Nama variabel 1')).toHaveValue('nama')
    expect(screen.getByLabelText('Nama variabel 2')).toHaveValue('paket')

    fireEvent.change(screen.getByLabelText('Nama variabel 1'), { target: { value: 'nama_pelanggan' } })
    expect(screen.getByLabelText('Nama variabel 1')).toHaveValue('nama_pelanggan')
  })

  it('drops the next {{n}} placeholder into the body textarea on each click, in order', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByText('+ Tambah Variabel')).toBeInTheDocument())

    fireEvent.click(screen.getByText('+ Tambah Variabel'))
    expect(screen.getByLabelText('Isi pesan')).toHaveValue('{{1}}')

    fireEvent.click(screen.getByText('+ Tambah Variabel'))
    expect(screen.getByLabelText('Isi pesan')).toHaveValue('{{1}} {{2}}')
  })

  it('appends the placeholder after any existing body text, with a separating space', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByText('+ Tambah Variabel')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Isi pesan'), { target: { value: 'Halo,' } })
    fireEvent.click(screen.getByText('+ Tambah Variabel'))

    expect(screen.getByLabelText('Isi pesan')).toHaveValue('Halo, {{1}}')
  })

  it('deletes a variable row', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByText('+ Tambah Variabel')).toBeInTheDocument())
    addNamedVariables(['nama', 'paket'])

    fireEvent.click(screen.getByLabelText('Hapus variabel 1'))

    expect(screen.queryByLabelText('Nama variabel 2')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Nama variabel 1')).toHaveValue('paket')
  })
})

describe('TemplatesPage — variable source bindings', () => {
  it('shows no binding section until there is at least one variable', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Nama template')).toBeInTheDocument())

    expect(screen.queryByText('Sumber Nilai Variabel')).not.toBeInTheDocument()
  })

  it('shows one binding row per named OFFICIAL variable, labeled with its position and name', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByText('+ Tambah Variabel')).toBeInTheDocument())

    addNamedVariables(['nama', 'paket'])

    expect(screen.getByText('Sumber Nilai Variabel')).toBeInTheDocument()
    expect(screen.getByText('{{1}} nama')).toBeInTheDocument()
    expect(screen.getByText('{{2}} paket')).toBeInTheDocument()
    expect(screen.getByLabelText('Sumber nilai untuk {{1}} nama')).toBeInTheDocument()
  })

  it('shows the same add/edit/delete variable list and binding rows on the Balasan Cepat tab too', async () => {
    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByLabelText('Nama template')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Balasan Cepat'))
    fireEvent.change(screen.getByLabelText('Isi pesan'), { target: { value: 'Halo {{1}}, sisa tagihan {{2}}.' } })

    addNamedVariables(['nama', 'sisa'])

    expect(screen.getByText('Sumber Nilai Variabel')).toBeInTheDocument()
    expect(screen.getByText('{{1}} nama')).toBeInTheDocument()
    expect(screen.getByText('{{2}} sisa')).toBeInTheDocument()
  })

  it('submits variableBindings only for positions with a chosen source, omitting "Isi manual" ones', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/templates' && init?.method === 'POST') return jsonResponse({ id: 't1', metaStatus: 'PENDING' })
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByText('+ Tambah Variabel')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Nama template'), { target: { value: 'booking_confirmation' } })
    fireEvent.change(screen.getByLabelText('Isi pesan'), { target: { value: 'Halo {{1}}, sisa {{2}}.' } })
    addNamedVariables(['nama', 'sisa'])

    fireEvent.change(screen.getByLabelText('Sumber nilai untuk {{1}} nama'), { target: { value: 'contactName' } })
    // {{2}} sisa deliberately left as "Isi manual".

    fireEvent.click(screen.getByText('Ajukan ke Meta'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/templates', expect.objectContaining({ method: 'POST' })))
    const [, options] = fetchMock.mock.calls.find(([url, init]) => url === '/api/templates' && init?.method === 'POST')!
    const payload = JSON.parse((options as RequestInit).body as string)
    expect(payload.variableBindings).toEqual({ '1': 'contactName' })
  })

  it('drops a stale binding when the bound variable is removed from the draft before submitting', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/templates' && init?.method === 'POST') return jsonResponse({ id: 't1', metaStatus: 'PENDING' })
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<TemplatesPage />)
    await waitFor(() => expect(screen.getByText('+ Tambah Variabel')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Nama template'), { target: { value: 'booking_confirmation' } })
    fireEvent.change(screen.getByLabelText('Isi pesan'), { target: { value: 'Halo {{1}}, sisa {{2}}.' } })
    addNamedVariables(['nama', 'sisa'])
    fireEvent.change(screen.getByLabelText('Sumber nilai untuk {{2}} sisa'), { target: { value: 'financialBalance' } })

    // Remove the second variable -- its binding must not resurrect at a now-unrelated position.
    fireEvent.click(screen.getByLabelText('Hapus variabel 2'))

    fireEvent.click(screen.getByText('Ajukan ke Meta'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/templates', expect.objectContaining({ method: 'POST' })))
    const [, options] = fetchMock.mock.calls.find(([url, init]) => url === '/api/templates' && init?.method === 'POST')!
    const payload = JSON.parse((options as RequestInit).body as string)
    expect(payload.variableBindings).toBeUndefined()
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
