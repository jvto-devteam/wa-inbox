import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { KnowledgeSourceTable, type KnowledgeSourceRow } from './KnowledgeSourceTable'

afterEach(cleanup)

function source(overrides: Partial<KnowledgeSourceRow> = {}): KnowledgeSourceRow {
  return {
    id: 'src_1',
    key: 'managed/abc123',
    title: 'FAQ Harga ATV',
    status: 'PUBLISHED',
    summary: 'Jawaban harga ATV Bromo',
    topics: [],
    ...overrides,
  }
}

describe('KnowledgeSourceTable', () => {
  it('shows the title, summary and status', () => {
    render(<KnowledgeSourceTable sources={[source({ status: 'ARCHIVED' })]} />)
    const row = screen.getAllByRole('row')[1]
    expect(within(row).getByText('FAQ Harga ATV')).toBeInTheDocument()
    expect(within(row).getByText('Jawaban harga ATV Bromo')).toBeInTheDocument()
    expect(within(row).getByText('ARCHIVED')).toBeInTheDocument()
  })

  it('shows the draft badge only while something is written but not activated', () => {
    const { rerender } = render(
      <KnowledgeSourceTable
        sources={[source({ hasDraft: true, latestRevision: { id: 'r1', version: 4, status: 'DRAFT' } })]}
      />
    )
    expect(screen.getByText('v4: DRAFT')).toBeInTheDocument()

    rerender(
      <KnowledgeSourceTable
        sources={[source({ hasDraft: false, latestRevision: { id: 'r1', version: 4, status: 'PUBLISHED' } })]}
      />
    )
    expect(screen.queryByText(/v4:/)).not.toBeInTheDocument()
  })

  it('offers Riwayat to a reader but no write controls', () => {
    render(<KnowledgeSourceTable sources={[source()]} onAction={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Riwayat' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit isi' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Arsipkan' })).not.toBeInTheDocument()
  })

  it('reports the chosen action and source to its parent', () => {
    const onAction = vi.fn()
    render(<KnowledgeSourceTable sources={[source({ id: 'src_9' })]} canEdit onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit isi' }))
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'src_9' }), 'edit')
  })

  it('offers Aktifkan only when the latest revision is a draft', () => {
    const { rerender } = render(
      <KnowledgeSourceTable
        sources={[source({ latestRevision: { id: 'r1', version: 2, status: 'PUBLISHED' } })]}
        canEdit
        onAction={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: 'Aktifkan' })).not.toBeInTheDocument()

    rerender(
      <KnowledgeSourceTable
        sources={[source({ latestRevision: { id: 'r1', version: 3, status: 'DRAFT' } })]}
        canEdit
        onAction={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Aktifkan' })).toBeInTheDocument()
  })

  it('hides every write control on an archived source', () => {
    render(<KnowledgeSourceTable sources={[source({ status: 'ARCHIVED' })]} canEdit onAction={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Edit isi' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Arsipkan' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Riwayat' })).toBeInTheDocument()
  })

  it('points an operator at the create button instead of showing a bare empty table', () => {
    render(<KnowledgeSourceTable sources={[]} />)
    expect(screen.getByText(/Buat knowledge baru/)).toBeInTheDocument()
  })

  it('menampilkan badge topik supaya salah tanda terlihat tanpa membuka form', () => {
    render(<KnowledgeSourceTable sources={[source({ topics: ['payment', 'booking'] })]} />)
    const row = screen.getAllByRole('row')[1]
    expect(within(row).getByText('payment')).toBeInTheDocument()
    expect(within(row).getByText('booking')).toBeInTheDocument()
  })
})
