import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import KnowledgeExplorerPage from './page'

/**
 * Two halves, one page, and the boundary between them is the point.
 *
 * The catalog half is read from disk through `/api/bot-control/knowledge/catalog`; the managed
 * half is operator-written rows the bot reads from the database. These tests pin that the page
 * asks the disk endpoint for catalog content and NEVER the retired mirror endpoints, and that
 * removing the mirror left the draft/activate flow (item b3) completely intact.
 */
const CATALOG = {
  items: [
    {
      id: 'general-modules.json#policy_ijen_health',
      sourceFile: 'general-modules.json',
      topic: 'policy',
      title: 'Ijen Health Screening',
      body: 'Setiap tamu wajib membawa surat sehat dan memakai masker gas di kawah.',
      links: [],
      prices: [],
      tags: ['ijen_scoped'],
    },
  ],
  page: 1,
  limit: 50,
  total: 1,
  syncedAt: '2026-08-07T00:00:00.000Z',
  topics: ['paket', 'policy'],
}

const SOURCES = {
  items: [
    {
      id: 'ks_1',
      key: 'managed/faq-atv',
      title: 'FAQ Harga ATV',
      type: 'MANUAL',
      status: 'DRAFT',
      summary: 'Jawaban harga ATV Bromo',
      ownerId: 'acc_1',
      managed: true,
      hasDraft: true,
      latestRevision: { id: 'krev_1', version: 1, status: 'DRAFT' },
      topics: [],
    },
  ],
  page: 1,
  limit: 50,
  total: 1,
}

const SOURCE_DETAIL = {
  id: 'ks_1',
  title: 'FAQ Harga ATV',
  summary: 'Jawaban harga ATV Bromo',
  managed: true,
  latestRevision: {
    id: 'krev_1',
    version: 1,
    status: 'DRAFT',
    title: 'FAQ Harga ATV',
    summary: 'Jawaban harga ATV Bromo',
    body: { items: [{ question: 'Berapa harga ATV?', answer: 'Ikut katalog aktif.' }] },
    bodyUnreadable: false,
  },
}

/** Records every URL the page asks for, so the negative assertions have something to read. */
let calls: string[]

function mockFetch(overrides: Record<string, unknown> = {}) {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      calls.push(input)
      const url = input.split('?')[0]
      const bodies: Record<string, unknown> = {
        '/api/session': { role: 'ADMIN' },
        '/api/bot-control/knowledge/catalog': CATALOG,
        '/api/bot-control/knowledge/sources': SOURCES,
        '/api/bot-control/knowledge/sources/ks_1': SOURCE_DETAIL,
        ...overrides,
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => bodies[url] ?? {} })
    })
  )
}

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => cleanup())

describe('Knowledge Explorer page — catalog half', () => {
  it('shows catalog content fetched from the disk-backed endpoint', async () => {
    mockFetch()
    render(<KnowledgeExplorerPage />)

    expect(await screen.findByText('Ijen Health Screening')).toBeInTheDocument()
    expect(screen.getByText(/memakai masker gas/)).toBeInTheDocument()
    // The file, so an operator knows which one to edit.
    expect(screen.getByText('catalog/general-modules.json')).toBeInTheDocument()
    expect(calls.some((c) => c.startsWith('/api/bot-control/knowledge/catalog'))).toBe(true)
  })

  it('never asks for the retired database mirror, and offers no re-index button', async () => {
    mockFetch()
    render(<KnowledgeExplorerPage />)
    await screen.findByText('Ijen Health Screening')

    // Built from parts rather than written out, so the retired route names do not linger in
    // the repo as greppable strings.
    const retired = ['chunks', 'sync'].map((name) => `/knowledge/${name}`)
    expect(calls.some((c) => retired.some((path) => c.includes(path)))).toBe(false)
    expect(screen.queryByRole('button', { name: /Index ulang katalog/ })).not.toBeInTheDocument()
    // And it says so, because the old page told the operator the opposite.
    expect(screen.getByText(/Tidak ada langkah sinkronisasi/)).toBeInTheDocument()
  })

  it('pushes the catalog search term at the server rather than filtering what it already has', async () => {
    mockFetch()
    render(<KnowledgeExplorerPage />)
    await screen.findByText('Ijen Health Screening')

    fireEvent.change(screen.getByLabelText('Cari isi katalog'), { target: { value: 'masker' } })
    await waitFor(() => expect(calls.some((c) => c.includes('/knowledge/catalog?q=masker'))).toBe(true))
  })
})

describe('Knowledge Explorer page — managed knowledge is untouched', () => {
  it('lists managed sources with their draft state and the controls to act on it', async () => {
    mockFetch()
    render(<KnowledgeExplorerPage />)

    expect(await screen.findByText('FAQ Harga ATV')).toBeInTheDocument()
    expect(screen.getByText('v1: DRAFT')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Buat knowledge baru' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit isi' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aktifkan' })).toBeInTheDocument()
  })

  it('still saves a draft and activates it through the b3 endpoints', async () => {
    mockFetch()
    render(<KnowledgeExplorerPage />)
    await screen.findByText('FAQ Harga ATV')

    fireEvent.click(screen.getByRole('button', { name: 'Edit isi' }))
    // The editor opens on the revision body the detail endpoint served.
    expect(await screen.findByDisplayValue('Berapa harga ATV?')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Alasan perubahan'), {
      target: { value: 'Harga ATV naik mulai Oktober' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & aktifkan' }))

    await waitFor(() =>
      expect(calls.some((c) => c === '/api/bot-control/knowledge/sources/ks_1/publish')).toBe(true)
    )
    // Draft first, then activate: two calls, so a failed activation still leaves the text saved.
    expect(calls.indexOf('/api/bot-control/knowledge/sources/ks_1/draft')).toBeGreaterThan(-1)
    expect(calls.indexOf('/api/bot-control/knowledge/sources/ks_1/draft')).toBeLessThan(
      calls.indexOf('/api/bot-control/knowledge/sources/ks_1/publish')
    )
  })

  it('hides the write controls from a reader', async () => {
    mockFetch({ '/api/session': { role: 'AGENT' } })
    render(<KnowledgeExplorerPage />)
    await screen.findByText('FAQ Harga ATV')

    expect(screen.queryByRole('button', { name: 'Buat knowledge baru' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit isi' })).not.toBeInTheDocument()
    // Reading the catalog stays open to everyone.
    expect(screen.getByText('Ijen Health Screening')).toBeInTheDocument()
  })
})
