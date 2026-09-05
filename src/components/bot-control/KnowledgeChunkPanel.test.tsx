import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { KnowledgeChunkPanel, type KnowledgeChunkRow } from './KnowledgeChunkPanel'

afterEach(cleanup)

function chunk(overrides: Partial<KnowledgeChunkRow> = {}): KnowledgeChunkRow {
  return {
    id: 'chunk_1',
    sourceKey: 'catalog/policy-cards.json',
    sourcePath: 'catalog/policy-cards.json',
    topic: 'policy-cards',
    title: 'Booking Safety & Anti-Fraud',
    bodyPreview: 'Isi kebijakan.',
    body: 'Isi kebijakan.',
    links: ['/policies/booking-paths.md'],
    prices: [1500000],
    tags: ['policy'],
    linksCount: 1,
    pricesCount: 1,
    hash: 'abcdef0123456789'.repeat(4),
    ...overrides,
  }
}

describe('KnowledgeChunkPanel', () => {
  it('renders a chunk with its topic, source path, price and link', () => {
    render(<KnowledgeChunkPanel chunks={[chunk()]} total={1} loading={false} error={null} />)

    expect(screen.getByText('Booking Safety & Anti-Fraud')).toBeInTheDocument()
    expect(screen.getByText('policy-cards')).toBeInTheDocument()
    expect(screen.getByText('catalog/policy-cards.json')).toBeInTheDocument()
    expect(screen.getByText('Rp 1.500.000')).toBeInTheDocument()
    expect(screen.getByText('/policies/booking-paths.md')).toBeInTheDocument()
  })

  it('does not render catalog links as anchors', () => {
    // These are grounding values, not routes in this app; an anchor would send an operator to
    // a 404 inside wa-inbox.
    render(<KnowledgeChunkPanel chunks={[chunk()]} total={1} loading={false} error={null} />)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('expands a truncated body on request', () => {
    const long = 'x'.repeat(900)
    render(
      <KnowledgeChunkPanel chunks={[chunk({ body: long, bodyPreview: long.slice(0, 400) })]} total={1} loading={false} error={null} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Tampilkan selengkapnya' }))
    expect(screen.getByRole('button', { name: 'Ringkas' })).toBeInTheDocument()
  })

  it('offers no expand control when the body is already fully shown', () => {
    render(<KnowledgeChunkPanel chunks={[chunk()]} total={1} loading={false} error={null} />)
    expect(screen.queryByRole('button', { name: 'Tampilkan selengkapnya' })).toBeNull()
  })

  it('does not crash when the Json columns are null', () => {
    // A chunk whose record had no links/prices/tags stores null, not [].
    render(
      <KnowledgeChunkPanel
        chunks={[chunk({ links: null, prices: null, tags: null, linksCount: 0, pricesCount: 0 })]}
        total={1}
        loading={false}
        error={null}
      />
    )
    expect(screen.getByText('Booking Safety & Anti-Fraud')).toBeInTheDocument()
  })

  it('survives a chunk with no title or topic at all', () => {
    render(<KnowledgeChunkPanel chunks={[chunk({ title: null, topic: null })]} total={1} loading={false} error={null} />)
    expect(screen.getByText('(tanpa judul)')).toBeInTheDocument()
  })

  it('shows how many of the total are on screen', () => {
    render(<KnowledgeChunkPanel chunks={[chunk()]} total={412} loading={false} error={null} />)
    expect(screen.getByText('Menampilkan 1 dari 412 chunk.')).toBeInTheDocument()
  })

  it('distinguishes loading, empty and failed', () => {
    const { rerender } = render(<KnowledgeChunkPanel chunks={[]} total={0} loading error={null} />)
    expect(screen.getByText('Memuat isi knowledge...')).toBeInTheDocument()

    rerender(<KnowledgeChunkPanel chunks={[]} total={0} loading={false} error={null} />)
    expect(screen.getByText('Tidak ada isi knowledge yang cocok.')).toBeInTheDocument()

    // A failure rendering as "no results" would have an operator conclude the bot knows
    // nothing about a topic when the query never completed.
    rerender(<KnowledgeChunkPanel chunks={[]} total={0} loading={false} error="Gagal memuat isi knowledge" />)
    expect(screen.getByText('Gagal memuat isi knowledge')).toBeInTheDocument()
    expect(screen.queryByText('Tidak ada isi knowledge yang cocok.')).toBeNull()
  })
})
