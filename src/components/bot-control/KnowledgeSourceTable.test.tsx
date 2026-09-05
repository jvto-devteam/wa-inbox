import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { KnowledgeSourceTable, type KnowledgeSourceRow } from './KnowledgeSourceTable'

afterEach(cleanup)

function source(overrides: Partial<KnowledgeSourceRow> = {}): KnowledgeSourceRow {
  return {
    id: 'src_1',
    key: 'catalog/policy-cards.json',
    title: 'Policy Cards',
    type: 'CATALOG_JSON',
    sourcePath: 'catalog/policy-cards.json',
    status: 'PUBLISHED',
    summary: '10 record dari policy-cards.json',
    chunkCount: 10,
    lastSyncedAt: '2026-09-05T03:00:00.000Z',
    ...overrides,
  }
}

describe('KnowledgeSourceTable', () => {
  it('shows the source path so an operator knows which file the bot reads', () => {
    render(<KnowledgeSourceTable sources={[source()]} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.getByText('catalog/policy-cards.json')).toBeInTheDocument()
  })

  it('shows the chunk count and status', () => {
    render(<KnowledgeSourceTable sources={[source({ chunkCount: 77, status: 'ARCHIVED' })]} selectedId={null} onSelect={vi.fn()} />)
    const row = screen.getAllByRole('row')[1]
    expect(within(row).getByText('77')).toBeInTheDocument()
    expect(within(row).getByText('ARCHIVED')).toBeInTheDocument()
  })

  it('says "Belum pernah" rather than rendering an empty cell for a never-synced source', () => {
    render(<KnowledgeSourceTable sources={[source({ lastSyncedAt: null })]} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.getByText('Belum pernah')).toBeInTheDocument()
  })

  it('renders a dash for a source with no path instead of a blank cell', () => {
    render(<KnowledgeSourceTable sources={[source({ sourcePath: null })]} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('reports the chosen source id to its parent', () => {
    const onSelect = vi.fn()
    render(<KnowledgeSourceTable sources={[source({ id: 'src_9' })]} selectedId={null} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: 'Lihat isi' }))
    expect(onSelect).toHaveBeenCalledWith('src_9')
  })

  it('marks the selected source', () => {
    render(
      <KnowledgeSourceTable
        sources={[source({ id: 'a', title: 'A' }), source({ id: 'b', title: 'B' })]}
        selectedId="b"
        onSelect={vi.fn()}
      />
    )
    const pressed = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true')
    expect(pressed).toHaveLength(1)
  })

  it('tells the operator how to populate an empty index instead of showing a bare table', () => {
    render(<KnowledgeSourceTable sources={[]} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.getByText(/Index ulang katalog/)).toBeInTheDocument()
  })
})
