import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { ContactTable } from './ContactTable'

const contacts = [
  {
    id: 'contact_1',
    name: 'Bruno Figarola',
    phone: '6281234567890',
    pipelineStage: 'nego',
    lastContactAt: '2026-07-20T03:00:00.000Z',
    labels: ['Hot Lead'],
  },
]

const labels = [{ id: 'lbl_1', name: 'Hot Lead', color: '#C4622D' }]

// Routes by URL so the label list and the contact list can be answered independently.
function mockFetch(rows = contacts) {
  vi.mocked(fetch).mockImplementation((input) => {
    const url = String(input)
    const body = url.startsWith('/api/labels') ? labels : rows
    return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response)
  })
}

function contactRequestUrls() {
  return vi
    .mocked(fetch)
    .mock.calls.map((c) => String(c[0]))
    .filter((u) => u.startsWith('/api/contacts'))
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  vi.stubGlobal('location', { pathname: '/contacts', href: 'http://localhost/contacts' })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ContactTable filters', () => {
  it('loads the unfiltered list with a bare /api/contacts on first render', async () => {
    mockFetch()
    render(<ContactTable />)

    expect(await screen.findByText('Bruno Figarola')).toBeInTheDocument()
    expect(contactRequestUrls()).toEqual(['/api/contacts'])
  })

  // GET /api/contacts has implemented ?stage= since the pipeline feature landed, but no
  // UI ever sent it — the "dropdown + filter" task only ever shipped the dropdown.
  it('re-fetches with ?stage= when a pipeline stage is selected', async () => {
    mockFetch()
    render(<ContactTable />)
    await screen.findByText('Bruno Figarola')

    fireEvent.change(screen.getByLabelText('Filter tahap pipeline'), { target: { value: 'nego' } })

    await waitFor(() => expect(contactRequestUrls()).toContain('/api/contacts?stage=nego'))
  })

  it('re-fetches with ?labelId= when a label is selected', async () => {
    mockFetch()
    render(<ContactTable />)
    await screen.findByText('Bruno Figarola')

    fireEvent.change(await screen.findByLabelText('Filter label'), { target: { value: 'lbl_1' } })

    await waitFor(() => expect(contactRequestUrls()).toContain('/api/contacts?labelId=lbl_1'))
  })

  it('combines both filters into a single query', async () => {
    mockFetch()
    render(<ContactTable />)
    await screen.findByText('Bruno Figarola')

    fireEvent.change(screen.getByLabelText('Filter tahap pipeline'), { target: { value: 'booked' } })
    fireEvent.change(await screen.findByLabelText('Filter label'), { target: { value: 'lbl_1' } })

    await waitFor(() => expect(contactRequestUrls()).toContain('/api/contacts?stage=booked&labelId=lbl_1'))
  })

  it('drops the query again when the filter is reset to "Semua tahap"', async () => {
    mockFetch()
    render(<ContactTable />)
    await screen.findByText('Bruno Figarola')

    const select = screen.getByLabelText('Filter tahap pipeline')
    fireEvent.change(select, { target: { value: 'nego' } })
    await waitFor(() => expect(contactRequestUrls()).toContain('/api/contacts?stage=nego'))

    fireEvent.change(select, { target: { value: '' } })
    await waitFor(() => expect(contactRequestUrls().filter((u) => u === '/api/contacts')).toHaveLength(2))
  })

  it('offers every pipeline stage as an option', async () => {
    mockFetch()
    render(<ContactTable />)

    const select = await screen.findByLabelText('Filter tahap pipeline')
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Semua tahap',
      'Baru',
      'Negosiasi',
      'Booked',
      'Lunas',
      'Selesai',
    ])
  })

  it('distinguishes an empty filter result from an empty contact book', async () => {
    mockFetch([])
    render(<ContactTable />)

    expect(await screen.findByText('Belum ada kontak.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Filter tahap pipeline'), { target: { value: 'lunas' } })

    expect(await screen.findByText('Tidak ada kontak untuk filter ini.')).toBeInTheDocument()
  })

  it('keeps the table usable when the label list fails to load', async () => {
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input)
      if (url.startsWith('/api/labels')) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) } as Response)
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => contacts } as Response)
    })

    render(<ContactTable />)

    expect(await screen.findByText('Bruno Figarola')).toBeInTheDocument()
    const select = screen.getByLabelText('Filter label')
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Semua label'])
    expect(location.href).toBe('http://localhost/contacts')
  })
})
