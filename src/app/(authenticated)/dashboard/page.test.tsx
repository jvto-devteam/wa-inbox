import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, within } from '@testing-library/react'
import DashboardPage from './page'
import { formatWait } from '@/components/dashboard/data'

// Beranda membaca sumber yang berdiri sendiri (lihat komentar kepala page.tsx): status saluran,
// /api/reminders/due, dan dua endpoint agregat (/api/dashboard/operations, /api/dashboard/activity)
// yang mengisi funnel, outbound, kesehatan bot, dan cluster keputusan.
const HOUR = 60 * 60 * 1000

function isoAgo(ms: number) {
  return new Date(Date.now() - ms).toISOString()
}

const channels = { officialTokenValid: true, unofficialConfigured: false }

const reminders = [
  { id: 'rem_1', note: 'Follow up DP', dueAt: isoAgo(2 * HOUR), contactId: 'contact_1', contactName: 'Bruno' },
]

const operations = {
  funnel: [
    { stage: 'new', label: 'Baru', count: 6 },
    { stage: 'nego', label: 'Negosiasi', count: 3 },
    { stage: 'booked', label: 'Booked', count: 2 },
    { stage: 'lunas', label: 'Lunas', count: 1 },
    { stage: 'selesai', label: 'Selesai', count: 0 },
  ],
  conversationTotal: 12,
  outbound: {
    inFlight: { QUEUED: 0, SENDING: 0, RETRYING: 0 },
    inFlightTotal: 0,
    failedRecent: 0,
    stuck: 0,
    pausedProviders: [],
  },
}

const activity = {
  days: 7,
  since: isoAgo(7 * 24 * HOUR),
  decisions: {
    total: 4,
    byStatus: { REPLIED: 3, HANDOFF: 1 },
    flagged: 0,
    avgLatencyMs: 1200,
    maxLatencyMs: 3000,
  },
  byTopic: [
    { topic: 'route_endpoint', total: 12, replied: 0, clarified: 12, handoff: 0 },
    { topic: 'payment', total: 8, replied: 8, clarified: 0, handoff: 0 },
  ],
  byJob: [{ job: 'book_trip', total: 10, replied: 2, clarified: 0, handoff: 8 }],
}

function mockEndpoints(overrides: Partial<Record<string, unknown>> = {}) {
  const bodies: Record<string, unknown> = {
    '/api/numbers/status': channels,
    '/api/reminders/due': reminders,
    '/api/dashboard/operations': operations,
    '/api/dashboard/activity?days=7': activity,
    ...overrides,
  }
  const impl = (url: string) =>
    Promise.resolve({ ok: true, status: 200, json: async () => bodies[url] } as Response)
  vi.mocked(fetch).mockImplementation(impl as unknown as typeof fetch)
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
  it('mengarahkan chat ke /summary dan tidak lagi memuat panel yang sudah dilepas', async () => {
    mockEndpoints()

    render(<DashboardPage />)

    expect(await screen.findByText('Beranda')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Summary Harian/ })).toHaveAttribute('href', '/summary')
    expect(screen.getByText('Kesehatan bot')).toBeInTheDocument()
    for (const removed of ['Chat menunggu dibalas', 'Volume pesan', 'Ringkasan inbox']) {
      expect(screen.queryByText(removed)).not.toBeInTheDocument()
    }
    expect(screen.queryByText('Pertanyaan yang bot tidak bisa jawab')).not.toBeInTheDocument()
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).not.toContain('/api/conversations')

    // Reminder manual tidak punya tempat lain: tetap bisa diklik ke kontaknya dan mengaku terlambat.
    const reminderLink = screen.getByRole('link', { name: /Follow up DP/ })
    expect(reminderLink).toHaveAttribute('href', '/contacts/contact_1')
    expect(within(reminderLink).getByText('Terlambat 2 jam')).toBeInTheDocument()

    // Saluran tidak resmi belum diatur -> peringatan keras di atas.
    expect(screen.getByText('Saluran tidak resmi belum diatur')).toBeInTheDocument()

    expect(location.href).toBe('http://localhost/dashboard')
  })

  it('menampilkan cluster keputusan bot per topik dan per job (R53)', async () => {
    mockEndpoints()

    render(<DashboardPage />)

    expect(await screen.findByText('Keputusan bot per cluster')).toBeInTheDocument()
    expect(screen.getByText('route_endpoint')).toBeInTheDocument()
    expect(screen.getByText('book_trip')).toBeInTheDocument()
  })

  it('tidak menampilkan peringatan saat kedua saluran sehat', async () => {
    mockEndpoints({
      '/api/numbers/status': { ...channels, unofficialConfigured: true },
      '/api/reminders/due': [],
    })

    render(<DashboardPage />)

    expect(await screen.findByText('Tidak ada reminder yang jatuh tempo')).toBeInTheDocument()
    expect(screen.queryByText(/tidak bisa mengirim pesan/)).not.toBeInTheDocument()
    expect(screen.queryByText(/belum diatur/)).not.toBeInTheDocument()
  })

  // middleware answers an expired/revoked session with a 401 on /api/*. The page used to feed
  // that `{ error: 'Unauthorized' }` body straight into state, and the next line of JSX threw,
  // blanking the screen instead of re-authenticating.
  it('redirects to /login instead of crashing when a request 401s', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    } as Response)

    expect(() => render(<DashboardPage />)).not.toThrow()

    await waitFor(() => expect(location.href).toBe('/login'))
    // Stays on the loading state rather than rendering a half-built page off an error object.
    expect(screen.getByRole('status', { name: 'Memuat beranda' })).toBeInTheDocument()
    expect(screen.queryByText('Follow up DP')).not.toBeInTheDocument()
  })

  // Beranda punya beberapa panel di atas sumber yang berdiri sendiri, satu endpoint
  // yang 500 tidak boleh lagi menahan SELURUH halaman di kerangka pemuatan: panel yang datanya
  // tidak sampai mengaku sendiri, dan panel di sebelahnya tetap benar. Yang tidak berubah adalah
  // dua hal yang penting: tidak ada redirect (500 bukan sesi mati), dan tidak ada satu pun angka
  // yang dikarang untuk mengisi kekosongan.
  it('does not redirect on a 500, and every panel admits its data failed', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    } as Response)

    render(<DashboardPage />)

    await waitFor(() => expect(screen.getAllByText('Data tidak bisa dibaca').length).toBeGreaterThan(0))
    expect(location.href).toBe('http://localhost/dashboard')
    expect(screen.queryByText('Follow up DP')).not.toBeInTheDocument()
    expect(screen.getByText('Kesehatan bot')).toBeInTheDocument()
  })
})

describe('formatWait', () => {
  const now = new Date('2026-09-08T12:00:00Z')

  it('memakai satu satuan, dan tidak pernah negatif', () => {
    expect(formatWait('2026-09-08T11:59:30Z', now)).toBe('baru saja')
    expect(formatWait('2026-09-08T12:05:00Z', now)).toBe('baru saja')
    expect(formatWait('2026-09-08T11:38:00Z', now)).toBe('22 menit')
    expect(formatWait('2026-09-08T08:00:00Z', now)).toBe('4 jam')
    expect(formatWait('2026-09-05T12:00:00Z', now)).toBe('3 hari')
  })
})
