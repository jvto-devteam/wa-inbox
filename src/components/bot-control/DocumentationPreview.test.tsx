import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { DocumentationPreview } from './DocumentationPreview'

const MARKDOWN = '# Dokumentasi Bot WhatsApp — wa-inbox\n\n## Ringkasan Bot\n\n| Hal | Kondisi |'

function stubExport(body = MARKDOWN) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => body,
    json: async () => ({}),
  }) as unknown as Response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.stubGlobal('location', { href: '/bot-control/docs', pathname: '/bot-control/docs' })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('DocumentationPreview', () => {
  it('starts with nothing generated and the export actions disabled', () => {
    stubExport()
    render(<DocumentationPreview />)

    expect(screen.getByText(/Belum ada dokumen/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unduh Markdown' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Salin' })).toBeDisabled()
  })

  it('generates the document and previews it verbatim', async () => {
    // Rendered as raw Markdown on purpose: what the operator previews must be byte-for-byte
    // what the recipient gets as a file.
    stubExport()
    render(<DocumentationPreview />)

    fireEvent.click(screen.getByRole('button', { name: 'Buat dokumentasi' }))

    await waitFor(() => expect(screen.getByText(/## Ringkasan Bot/)).toBeInTheDocument())
    expect(screen.getByText(/\| Hal \| Kondisi \|/)).toBeInTheDocument()
  })

  it('shows when the document was generated', async () => {
    stubExport()
    render(<DocumentationPreview />)

    fireEvent.click(screen.getByRole('button', { name: 'Buat dokumentasi' }))
    await waitFor(() => expect(screen.getByText(/^Dibuat: /)).toBeInTheDocument())
  })

  it('enables download and copy once a document exists', async () => {
    stubExport()
    render(<DocumentationPreview />)

    fireEvent.click(screen.getByRole('button', { name: 'Buat dokumentasi' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unduh Markdown' })).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Salin' })).toBeEnabled()
  })

  it('copies the document to the clipboard', async () => {
    stubExport()
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(<DocumentationPreview />)

    fireEvent.click(screen.getByRole('button', { name: 'Buat dokumentasi' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salin' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Salin' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(MARKDOWN))
    expect(await screen.findByRole('button', { name: 'Tersalin' })).toBeInTheDocument()
  })

  it('says so when the browser blocks the clipboard, rather than doing nothing', async () => {
    stubExport()
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => { throw new Error('denied') }) } })
    render(<DocumentationPreview />)

    fireEvent.click(screen.getByRole('button', { name: 'Buat dokumentasi' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salin' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Salin' }))

    await waitFor(() => expect(screen.getByText(/clipboard diblokir/)).toBeInTheDocument())
  })

  it('releases the object URL after a download so repeated exports do not leak', async () => {
    stubExport()
    const createObjectURL = vi.fn(() => 'blob:doc')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    render(<DocumentationPreview />)

    fireEvent.click(screen.getByRole('button', { name: 'Buat dokumentasi' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unduh Markdown' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Unduh Markdown' }))

    expect(createObjectURL).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:doc')
  })

  it('surfaces the server error instead of previewing an empty document', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Hanya admin yang bisa mengekspor dokumentasi' }) }) as unknown as Response)
    )
    render(<DocumentationPreview />)

    fireEvent.click(screen.getByRole('button', { name: 'Buat dokumentasi' }))
    await waitFor(() => expect(screen.getByText('Hanya admin yang bisa mengekspor dokumentasi')).toBeInTheDocument())
  })

  it('offers to regenerate once a document is on screen', async () => {
    stubExport()
    render(<DocumentationPreview />)

    fireEvent.click(screen.getByRole('button', { name: 'Buat dokumentasi' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Buat ulang' })).toBeInTheDocument())
  })
})
