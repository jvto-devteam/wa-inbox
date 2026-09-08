import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { KnowledgeRevisionPanel, type RevisionRow } from './KnowledgeRevisionPanel'

afterEach(cleanup)

function revision(overrides: Partial<RevisionRow> = {}): RevisionRow {
  return {
    id: 'krev_1',
    version: 1,
    title: 'FAQ Harga ATV',
    summary: null,
    status: 'PUBLISHED',
    changeReason: 'Menutup knowledge gap harga ATV',
    createdByName: 'Budi',
    publishedByName: null,
    publishedAt: null,
    createdAt: '2026-09-07T02:00:00.000Z',
    updatedAt: '2026-09-07T02:00:00.000Z',
    ...overrides,
  }
}

function renderPanel(props: Partial<Parameters<typeof KnowledgeRevisionPanel>[0]> = {}) {
  render(
    <KnowledgeRevisionPanel
      sourceTitle="FAQ Harga ATV"
      revisions={[revision()]}
      loading={false}
      error={null}
      onClose={vi.fn()}
      {...props}
    />
  )
}

describe('KnowledgeRevisionPanel', () => {
  it('shows the version, status and who wrote it', () => {
    renderPanel()
    expect(screen.getByText('v1')).toBeInTheDocument()
    expect(screen.getByText('PUBLISHED')).toBeInTheDocument()
    expect(screen.getByText(/Ditulis Budi/)).toBeInTheDocument()
  })

  it('shows the change reason on every row', () => {
    // The version numbers say WHAT changed; the reason says why, and only the pair is any use
    // months later.
    renderPanel()
    expect(screen.getByText(/Menutup knowledge gap harga ATV/)).toBeInTheDocument()
  })

  it('shows superseded revisions rather than hiding them', () => {
    // A version the bot no longer reads usually explains why the current one is worded the way
    // it is — filtering it out would remove the most useful row on the page.
    renderPanel({ revisions: [revision({ status: 'ARCHIVED', version: 2 })] })
    expect(screen.getByText('ARCHIVED')).toBeInTheDocument()
  })

  it('names who activated a revision, which is what survived reviewer and approver', () => {
    renderPanel({ revisions: [revision({ publishedByName: 'Sinta', publishedAt: '2026-09-08T02:00:00.000Z' })] })
    expect(screen.getByText(/diaktifkan Sinta/)).toBeInTheDocument()
  })

  it('says so when the account that wrote a revision is gone', () => {
    renderPanel({ revisions: [revision({ createdByName: null })] })
    expect(screen.getByText(/\(akun terhapus\)/)).toBeInTheDocument()
  })

  it('renders an empty history as empty, not as a blank panel', () => {
    renderPanel({ revisions: [] })
    expect(screen.getByText('Sumber ini belum punya revisi.')).toBeInTheDocument()
  })

  it('surfaces a load error', () => {
    renderPanel({ revisions: [], error: 'Gagal memuat riwayat revisi' })
    expect(screen.getByText('Gagal memuat riwayat revisi')).toBeInTheDocument()
  })
})
