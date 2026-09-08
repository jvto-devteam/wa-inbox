import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import AuditLogsPage from './page'

/**
 * The page survived the narrowing; what it shows did not.
 *
 * A row is now five things — when, who, what action, which entity, why — and these tests pin
 * that shape from the reader's side, where the actual promise lives. The negative assertions
 * matter as much as the positive ones: a re-added diff pane would quietly put configuration
 * values back on a screen the retention policy no longer expects to hold any.
 */
const rows = [
  {
    id: 'audit_1',
    actorId: 'acc_1',
    actorName: 'Budi',
    action: 'PUBLISH',
    entityType: 'KNOWLEDGE',
    entityId: 'ks_1',
    entityKey: 'managed/faq-atv',
    reason: 'Harga ATV naik mulai Oktober',
    createdAt: '2026-09-07T02:00:00.000Z',
  },
  {
    id: 'audit_2',
    actorId: null,
    actorName: null,
    action: 'DISABLE',
    entityType: 'BOT_SETTING',
    entityKey: 'botAutoReplyAll',
    entityId: null,
    reason: null,
    createdAt: '2026-09-06T02:00:00.000Z',
  },
]

function mockFetch(items: unknown[] = rows) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({ items, page: 1, limit: 50, total: items.length }) })
    )
  )
}

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => cleanup())

describe('AuditLogsPage', () => {
  it('shows the five things a history row is', async () => {
    mockFetch()
    render(<AuditLogsPage />)

    await screen.findByRole('list')
    // Scoped to the timeline: KNOWLEDGE also appears as an option in the entity-type filter.
    const timeline = within(screen.getByRole('list'))

    expect(timeline.getByText('PUBLISH')).toBeInTheDocument()
    expect(timeline.getByText('KNOWLEDGE')).toBeInTheDocument()
    expect(timeline.getByText('managed/faq-atv')).toBeInTheDocument()
    expect(timeline.getByText(/Budi/)).toBeInTheDocument()
    expect(timeline.getByText(/Harga ATV naik mulai Oktober/)).toBeInTheDocument()
    // The timestamp is rendered in local format, so the year is the stable part to assert on.
    expect(timeline.getAllByText(/2026/).length).toBeGreaterThan(0)
  })

  it('renders a row whose actor account has since been deleted', async () => {
    mockFetch()
    render(<AuditLogsPage />)

    expect(await screen.findByText('(akun terhapus)')).toBeInTheDocument()
  })

  it('offers exactly the actions and entity types that are actually written', async () => {
    // A filter option nobody ever writes always returns nothing, which reads as "the log is
    // broken" rather than "that never happened".
    mockFetch()
    render(<AuditLogsPage />)

    const actions = await screen.findByLabelText('Filter aksi')
    expect([...actions.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Semua aksi',
      'UPDATE',
      'PUBLISH',
      'ENABLE',
      'DISABLE',
    ])

    const entities = screen.getByLabelText('Filter jenis entitas')
    expect([...entities.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Semua entitas',
      'KNOWLEDGE',
      'BOT_SETTING',
      'OUTBOUND_PROVIDER',
      'OUTBOUND_JOB',
    ])
  })

  it('has no before/after pane left to leak a stored value through', async () => {
    // Even handed a payload that still carried a diff — an older row, a stale client — there is
    // nothing on this page that would draw it.
    mockFetch([{ ...rows[0], before: { accessToken: 'EAAGrahasia' }, after: { accessToken: 'EAAGbaru' } }])
    render(<AuditLogsPage />)

    await screen.findByRole('list')
    expect(screen.queryByText(/EAAG/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Sebelum/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Sesudah/)).not.toBeInTheDocument()
  })

  it('says so plainly when nothing has been recorded yet', async () => {
    mockFetch([])
    render(<AuditLogsPage />)

    expect(await screen.findByText('Belum ada perubahan yang tercatat.')).toBeInTheDocument()
  })
})
