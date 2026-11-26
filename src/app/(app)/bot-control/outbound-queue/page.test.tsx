import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import OutboundQueuePage from './page'

const job = {
  id: 'job_1',
  conversationId: 'conv_1',
  messageId: 'msg_1',
  contactName: 'Budi',
  contactPhone: '6281234567890',
  channel: 'UNOFFICIAL',
  provider: 'COEXIST',
  status: 'FAILED',
  attempts: 4,
  maxAttempts: 4,
  nextAttemptAt: null,
  lastError: 'wa-coexist timeout',
  createdAt: '2026-09-07T02:00:00.000Z',
  updatedAt: '2026-09-07T02:10:00.000Z',
}

const queue = {
  items: [job],
  summary: { QUEUED: 12, SENDING: 1, RETRYING: 3, SENT: 480, FAILED: 7, CANCELLED: 2 },
  pausedProviders: [] as string[],
  page: 1,
  limit: 50,
  total: 1,
}

let calls: Array<{ url: string; init?: RequestInit }> = []

function mockFetch(overrides: { queue?: Partial<typeof queue>; role?: string } = {}) {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url.startsWith('/api/session')) {
        return Promise.resolve({ ok: true, json: async () => ({ role: overrides.role ?? 'ADMIN' }) })
      }
      if (url.startsWith('/api/outbound-jobs?')) {
        return Promise.resolve({ ok: true, json: async () => ({ ...queue, ...overrides.queue }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({ requeued: 0, failed: 0 }) })
    })
  )
}

function queueRequests() {
  return calls.filter((c) => c.url.startsWith('/api/outbound-jobs?')).map((c) => c.url)
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.spyOn(window, 'prompt').mockReturnValue('alasan yang cukup panjang')
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('OutboundQueuePage', () => {
  it('counts the whole queue in the cards, not the rows on screen', async () => {
    // The point of the cards is to tell an operator who has filtered to FAILED how many are
    // still queued behind it. Counting the page would make them agree with the table and say
    // nothing.
    mockFetch()
    render(<OutboundQueuePage />)

    expect(await screen.findByText('480')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('wa-coexist timeout')).toBeInTheDocument()
  })

  it('warns everyone who opens the page that a provider is paused', async () => {
    // Not only whoever pressed the button: a queue that looks stalled for no reason is how a
    // second operator starts retrying by hand.
    mockFetch({ queue: { pausedProviders: ['COEXIST'] } })
    render(<OutboundQueuePage />)

    // Asserted INSIDE the banner. A bare findByText('COEXIST') used to resolve on the provider
    // filter's own <option> on the very first poll, before the fetch had even landed — so it
    // passed whether or not the banner ever rendered. The filter is gone; the assertion now
    // names the element it was always meant to be about.
    const banner = await screen.findByText(/tidak ada yang gagal karenanya/)
    expect(within(banner).getByText('COEXIST')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Lanjutkan COEXIST' })).toBeInTheDocument()
  })

  it('hanya menyisakan filter status dan "hanya yang menggantung"', async () => {
    // Six filters on a page people open in a panic. Provider and channel had two values each and
    // are printed on every row already; a created-at range answers a reporting question nobody
    // asks of a queue that empties itself. What is left is the two questions an incident asks.
    mockFetch()
    render(<OutboundQueuePage />)
    await screen.findByText('480')

    expect(screen.getByLabelText('Filter status')).toBeInTheDocument()
    expect(screen.getByLabelText('Hanya job menggantung')).toBeInTheDocument()
    expect(screen.queryByLabelText('Filter provider')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Filter channel')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Dari tanggal')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Sampai tanggal')).not.toBeInTheDocument()
  })

  it('mengirim kedua filter ke server, tidak menyaring baris di klien', async () => {
    // The rows on screen are a page out of a filtered query. Filtering them here instead would
    // make the total, and therefore the paging, describe a different set from the one displayed.
    mockFetch()
    render(<OutboundQueuePage />)
    await screen.findByText('480')

    fireEvent.change(screen.getByLabelText('Filter status'), { target: { value: 'SENDING' } })
    await waitFor(() => expect(queueRequests().some((u) => u.includes('status=SENDING'))).toBe(true))

    fireEvent.click(screen.getByLabelText('Hanya job menggantung'))
    await waitFor(() => expect(queueRequests().some((u) => u.includes('stuck=true'))).toBe(true))
  })

  it('masih bisa kirim ulang, batalkan, pulihkan yang menggantung, dan jeda provider', async () => {
    // The filters were trimmed; the four things an operator actually DOES here were not. Each
    // one is the only way out of a different failure, so all four are checked in one place.
    mockFetch({ queue: { items: [job, { ...job, id: 'job_2', status: 'QUEUED' }] } })
    render(<OutboundQueuePage />)
    await screen.findByText('480')

    fireEvent.click(screen.getByRole('button', { name: 'Kirim ulang' }))
    await waitFor(() => {
      const call = calls.find((c) => c.url === '/api/outbound-jobs/retry')
      expect(JSON.parse(String(call?.init?.body))).toEqual({ messageId: 'msg_1' })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Batalkan' }))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/outbound-jobs/job_2/cancel')).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: 'Pulihkan job menggantung' }))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/outbound-jobs/recover-stuck')).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: 'Jeda META' }))
    await waitFor(() => {
      const call = calls.find((c) => c.url === '/api/outbound-jobs/pause-provider')
      expect(JSON.parse(String(call?.init?.body))).toMatchObject({ provider: 'META' })
    })
  })

  it('returns to page one whenever a filter changes', async () => {
    mockFetch({ queue: { total: 120 } })
    render(<OutboundQueuePage />)
    await screen.findByText('480')

    fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }))
    await waitFor(() => expect(queueRequests().some((u) => u.includes('page=2'))).toBe(true))

    fireEvent.change(screen.getByLabelText('Filter status'), { target: { value: 'FAILED' } })
    await waitFor(() => expect(queueRequests().some((u) => u.includes('status=FAILED'))).toBe(true))
    expect(queueRequests().filter((u) => u.includes('status=FAILED')).every((u) => u.includes('page=1'))).toBe(true)
  })

  it('hides pause and recovery from an agent', async () => {
    // The controls are admin-only in the API too; showing them would only produce a 403.
    mockFetch({ role: 'AGENT' })
    render(<OutboundQueuePage />)
    await screen.findByText('480')

    expect(screen.queryByRole('button', { name: 'Jeda COEXIST' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pulihkan job menggantung' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Batalkan' })).not.toBeInTheDocument()
  })

  it('lets an OWNER pause a provider, with a reason', async () => {
    // Pause, cancel and recover are guarded by `requireAdmin` on the API, so the page offers them
    // to exactly the roles that carry admin powers — a BOT_MANAGER may edit the bot's answers but
    // not stop its deliveries.
    mockFetch({ role: 'OWNER' })
    render(<OutboundQueuePage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Jeda COEXIST' }))
    await waitFor(() => {
      const call = calls.find((c) => c.url === '/api/outbound-jobs/pause-provider')
      expect(JSON.parse(String(call?.init?.body))).toEqual({
        provider: 'COEXIST',
        reason: 'alasan yang cukup panjang',
      })
    })
  })

  it('sends nothing when the reason prompt is dismissed', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null)
    mockFetch()
    render(<OutboundQueuePage />)
    await screen.findByText('480')

    fireEvent.click(screen.getByRole('button', { name: 'Jeda COEXIST' }))
    await waitFor(() => expect(calls.some((c) => c.url.includes('pause-provider'))).toBe(false))
  })

  it('sends nothing when the reason is too short to explain anything', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('salah')
    mockFetch({ queue: { items: [{ ...job, status: 'QUEUED' }] } })
    render(<OutboundQueuePage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Batalkan' }))
    await waitFor(() => expect(calls.some((c) => c.url.includes('/cancel'))).toBe(false))
  })

  it('cancels a job with the typed reason and reloads', async () => {
    mockFetch({ queue: { items: [{ ...job, status: 'QUEUED' }] } })
    render(<OutboundQueuePage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Batalkan' }))
    await waitFor(() => {
      const call = calls.find((c) => c.url === '/api/outbound-jobs/job_1/cancel')
      expect(JSON.parse(String(call?.init?.body))).toEqual({ reason: 'alasan yang cukup panjang' })
    })
    await waitFor(() => expect(queueRequests().length).toBeGreaterThan(1))
  })

  it('reports "0 dipulihkan" as a real answer rather than silence', async () => {
    // A healthy queue and a broken button look identical if nothing is said.
    mockFetch()
    render(<OutboundQueuePage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Pulihkan job menggantung' }))
    expect(await screen.findByText('0 job dikembalikan ke antrean, 0 ditandai gagal.')).toBeInTheDocument()
  })

  it('shows the server error instead of an empty table', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.startsWith('/api/outbound-jobs')
          ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'Gagal membaca antrean' }) })
          : Promise.resolve({ ok: true, json: async () => ({ role: 'ADMIN' }) })
      )
    )
    render(<OutboundQueuePage />)
    expect(await screen.findByText('Gagal membaca antrean')).toBeInTheDocument()
  })

  it('renders each job once, with its provider', async () => {
    mockFetch()
    render(<OutboundQueuePage />)
    await screen.findByText('480')

    const rows = screen.getAllByRole('row')
    expect(within(rows[1]).getByText('Budi')).toBeInTheDocument()
    expect(within(rows[1]).getByText('COEXIST')).toBeInTheDocument()
  })
})
