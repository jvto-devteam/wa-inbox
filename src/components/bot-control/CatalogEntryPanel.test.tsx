import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { CatalogEntryPanel, type CatalogEntryRow } from './CatalogEntryPanel'

afterEach(cleanup)

function entry(overrides: Partial<CatalogEntryRow> = {}): CatalogEntryRow {
  return {
    id: 'general-modules.json#policy_ijen_health',
    sourceFile: 'general-modules.json',
    topic: 'policy',
    title: 'Ijen Health Screening',
    body: 'Setiap tamu wajib membawa surat sehat.',
    links: [],
    prices: [],
    tags: ['ijen_scoped'],
    ...overrides,
  }
}

describe('CatalogEntryPanel', () => {
  it('names the file on disk, because that is where a change has to be made', () => {
    render(<CatalogEntryPanel entries={[entry()]} total={1} loading={false} error={null} />)
    expect(screen.getByText('catalog/general-modules.json')).toBeInTheDocument()
    expect(screen.getByText('Ijen Health Screening')).toBeInTheDocument()
    expect(screen.getByText('policy')).toBeInTheDocument()
  })

  it('renders prices and links as text, never as anchors', () => {
    // These are grounding values the bot may cite; a relative catalog path is not a route in
    // this app, so an anchor would send an operator to a 404 inside wa-inbox.
    render(
      <CatalogEntryPanel
        entries={[entry({ prices: [2_450_000], links: ['https://javavolcano-touroperator.com/tours/x'] })]}
        total={1}
        loading={false}
        error={null}
      />
    )
    expect(screen.getByText(/Rp 2\.450\.000/)).toBeInTheDocument()
    expect(screen.getByText('https://javavolcano-touroperator.com/tours/x')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('collapses a long body and expands it on request', () => {
    const long = 'x'.repeat(900)
    render(<CatalogEntryPanel entries={[entry({ body: long })]} total={1} loading={false} error={null} />)

    expect(screen.getByText(`${'x'.repeat(400)}…`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Tampilkan selengkapnya' }))
    expect(screen.getByText(long)).toBeInTheDocument()
  })

  it('shows how many of the total are on screen', () => {
    render(<CatalogEntryPanel entries={[entry()]} total={93} loading={false} error={null} />)
    expect(screen.getByText('Menampilkan 1 dari 93 entri katalog.')).toBeInTheDocument()
  })

  it('distinguishes loading, empty and failed instead of collapsing them to "nothing found"', () => {
    // A failure rendered as "no results" would have an operator conclude the bot knows nothing
    // about a topic when in fact the read never completed.
    const { rerender } = render(<CatalogEntryPanel entries={[]} total={0} loading error={null} />)
    expect(screen.getByText('Memuat isi katalog...')).toBeInTheDocument()

    rerender(<CatalogEntryPanel entries={[]} total={0} loading={false} error={null} />)
    expect(screen.getByText('Tidak ada isi katalog yang cocok.')).toBeInTheDocument()

    rerender(<CatalogEntryPanel entries={[]} total={0} loading={false} error="Gagal membaca isi katalog dari disk" />)
    expect(screen.getByText('Gagal membaca isi katalog dari disk')).toBeInTheDocument()
  })
})
