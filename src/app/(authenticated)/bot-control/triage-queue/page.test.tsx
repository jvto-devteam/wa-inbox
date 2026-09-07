import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import TriageQueuePage from './page'

const row = {
  id: 'tri_1',
  decisionRunId: 'run_1',
  status: 'OPEN',
  issueType: 'WRONG_ANSWER',
  severity: 'HIGH',
  assignedTo: null as string | null,
  assignedToName: null as string | null,
  note: null as string | null,
  resolvedByName: null as string | null,
  resolvedAt: null as string | null,
  createdAt: '2026-09-07T02:00:00.000Z',
  updatedAt: '2026-09-07T02:10:00.000Z',
  decision: {
    conversationId: 'conv_1',
    inboundPreview: 'Paket Bromo untuk 4 orang berapa?',
    status: 'REPLIED',
    mode: 'AUTO',
    startedAt: '2026-09-07T01:59:00.000Z',
  } as { conversationId: string; inboundPreview: string; status: string; mode: string; startedAt: string } | null,
}

let calls: Array<{ url: string; init?: RequestInit }> = []

function mockFetch(overrides: { rows?: (typeof row)[]; total?: number; role?: string; accountId?: string } = {}) {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url.startsWith('/api/session')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ role: overrides.role ?? 'ADMIN', accountId: overrides.accountId ?? 'acc_me' }),
        })
      }
      if (url.startsWith('/api/bot-control/decisions/triage')) {
        const items = overrides.rows ?? [row]
        return Promise.resolve({
          ok: true,
          json: async () => ({ items, page: 1, limit: 50, total: overrides.total ?? items.length }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
  )
}

function listRequests() {
  return calls.filter((c) => c.url.startsWith('/api/bot-control/decisions/triage')).map((c) => c.url)
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.spyOn(window, 'prompt').mockReturnValue('sudah diperbaiki di knowledge')
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TriageQueuePage', () => {
  it('asks the triage table directly, so the whole history is reachable', async () => {
    // Decision Logs can only narrow the page already on screen; "what is still open across
    // everything" is a question only this query can answer.
    mockFetch()
    render(<TriageQueuePage />)

    expect(await screen.findByText('Paket Bromo untuk 4 orang berapa?')).toBeInTheDocument()
    // Scoped to the card: the filter dropdowns carry the same words as their options.
    const card = within(screen.getByRole('listitem'))
    expect(card.getByText('HIGH')).toBeInTheDocument()
    expect(card.getByText('OPEN')).toBeInTheDocument()
    expect(card.getByText('Belum ditugaskan')).toBeInTheDocument()
  })

  it('says the decision is gone rather than rendering an empty card', async () => {
    // Triage outlives the decision it describes by design — both are audit records with no
    // foreign key between them.
    mockFetch({ rows: [{ ...row, decision: null }] })
    render(<TriageQueuePage />)

    expect(await screen.findByText('(keputusan sudah dihapus)')).toBeInTheDocument()
  })

  it('links each row back to its decision run', async () => {
    mockFetch()
    render(<TriageQueuePage />)

    expect(await screen.findByRole('link', { name: 'Buka di Decision Logs' })).toHaveAttribute(
      'href',
      '/bot-control/decisions?run=run_1'
    )
  })

  it('filters by "hanya tugas saya" using the signed-in account', async () => {
    mockFetch({ accountId: 'acc_me' })
    render(<TriageQueuePage />)
    await screen.findByText('Paket Bromo untuk 4 orang berapa?')

    fireEvent.click(screen.getByLabelText('Hanya tugas saya'))
    await waitFor(() => expect(listRequests().some((u) => u.includes('assignedTo=acc_me'))).toBe(true))
  })

  it('returns to page one whenever a filter changes', async () => {
    mockFetch({ total: 120 })
    render(<TriageQueuePage />)
    await screen.findByText('Paket Bromo untuk 4 orang berapa?')

    fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }))
    await waitFor(() => expect(listRequests().some((u) => u.includes('page=2'))).toBe(true))

    fireEvent.change(screen.getByLabelText('Filter status'), { target: { value: 'OPEN' } })
    await waitFor(() => expect(listRequests().some((u) => u.includes('status=OPEN'))).toBe(true))
    expect(listRequests().filter((u) => u.includes('status=OPEN')).every((u) => u.includes('page=1'))).toBe(true)
  })

  it('lets an agent take work, which is the one assignment they may make', async () => {
    mockFetch({ role: 'AGENT', accountId: 'acc_me' })
    render(<TriageQueuePage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Ambil sendiri' }))
    await waitFor(() => {
      const call = calls.find((c) => c.init?.method === 'PATCH')
      expect(call?.url).toBe('/api/bot-control/decisions/run_1/triage')
      expect(JSON.parse(String(call?.init?.body))).toEqual({ assignedTo: 'acc_me' })
    })
  })

  it('does not offer an agent the buttons that close a case', async () => {
    mockFetch({ role: 'AGENT' })
    render(<TriageQueuePage />)
    await screen.findByText('Paket Bromo untuk 4 orang berapa?')

    expect(screen.queryByRole('button', { name: 'Tandai selesai' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Abaikan' })).not.toBeInTheDocument()
  })

  it('hides "Ambil sendiri" on work already assigned to me', async () => {
    mockFetch({ rows: [{ ...row, assignedTo: 'acc_me', assignedToName: 'Saya' }], accountId: 'acc_me' })
    render(<TriageQueuePage />)
    await screen.findByText('Ditugaskan ke Saya')

    expect(screen.queryByRole('button', { name: 'Ambil sendiri' })).not.toBeInTheDocument()
  })

  it('records why a case was closed', async () => {
    mockFetch()
    render(<TriageQueuePage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Tandai selesai' }))
    await waitFor(() => {
      const call = calls.find((c) => c.init?.method === 'PATCH')
      expect(JSON.parse(String(call?.init?.body))).toEqual({
        status: 'RESOLVED',
        note: 'sudah diperbaiki di knowledge',
      })
    })
  })

  it('changes nothing when the note prompt is dismissed or too short', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('sudah')
    mockFetch()
    render(<TriageQueuePage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Abaikan' }))
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PATCH')).toBe(false))
  })

  it('offers "Buka lagi" on a closed case instead of deleting it', async () => {
    // Nothing is removed: "pernah diputuskan tidak perlu diapa-apakan" has to stay readable.
    mockFetch({ rows: [{ ...row, status: 'IGNORED', note: 'duplikat' }] })
    render(<TriageQueuePage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Buka lagi' }))
    await waitFor(() => {
      const call = calls.find((c) => c.init?.method === 'PATCH')
      expect(JSON.parse(String(call?.init?.body))).toEqual({ status: 'OPEN' })
    })
  })

  it('shows the server error instead of an empty queue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.startsWith('/api/bot-control/decisions/triage')
          ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'Gagal memuat triase' }) })
          : Promise.resolve({ ok: true, json: async () => ({ role: 'ADMIN', accountId: 'acc_me' }) })
      )
    )
    render(<TriageQueuePage />)

    expect(await screen.findByText('Gagal memuat triase')).toBeInTheDocument()
    expect(screen.queryByText(/Tidak ada tindak lanjut/)).not.toBeInTheDocument()
  })

  it('says so when nothing matches the filter', async () => {
    mockFetch({ rows: [] })
    render(<TriageQueuePage />)

    expect(await screen.findByText('Tidak ada tindak lanjut yang cocok dengan filter.')).toBeInTheDocument()
  })
})
