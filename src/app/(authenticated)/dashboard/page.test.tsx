import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import DashboardPage from './page'

const summary = {
  openCount: 3,
  handoffTodayCount: 1,
  officialTokenValid: true,
  unofficialConfigured: false,
  needsAttention: [{ id: 'conv_1', contactName: 'Bruno', reason: 'Menunggu agen setelah handoff' }],
  remindersDue: [{ id: 'rem_1', note: 'Follow up DP', contactName: 'Bruno' }],
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  vi.stubGlobal('location', { pathname: '/dashboard', href: 'http://localhost/dashboard' })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Beranda dashboard', () => {
  it('renders the summary on a 200, exactly as before', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => summary } as Response)

    render(<DashboardPage />)

    expect(await screen.findByText('Beranda')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Bruno')).toBeInTheDocument()
    expect(screen.getByText(/Follow up DP/)).toBeInTheDocument()
    expect(location.href).toBe('http://localhost/dashboard')
  })

  // middleware answers an expired/revoked session with a 401 on /api/*. The page used to feed
  // that `{ error: 'Unauthorized' }` body straight into `summary`, and the next line of JSX --
  // `summary.remindersDue.length` -- threw, blanking the screen instead of re-authenticating.
  it('redirects to /login instead of crashing when the summary request 401s', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    } as Response)

    expect(() => render(<DashboardPage />)).not.toThrow()

    await waitFor(() => expect(location.href).toBe('/login'))
    // Stays on the loading state rather than rendering a half-built page off an error object.
    expect(screen.getByText('Memuat...')).toBeInTheDocument()
  })

  it('does not redirect on a 500, and holds the loading state', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    } as Response)

    render(<DashboardPage />)

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/dashboard/summary'))
    expect(location.href).toBe('http://localhost/dashboard')
    expect(screen.getByText('Memuat...')).toBeInTheDocument()
  })
})
