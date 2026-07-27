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
