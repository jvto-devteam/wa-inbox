import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, within } from '@testing-library/react'
import DashboardPage, { buildWaitingList, formatWait } from './page'

// Beranda sekarang membaca tiga endpoint (lihat komentar kepala page.tsx): summary tahu
// percakapan mana yang sudah di-handoff dan belum dipegang siapa pun, /api/conversations
// membawa timestamp pesan terakhir (satu-satunya sumber "sudah menunggu berapa lama"), dan
// /api/reminders/due membawa dueAt + contactId supaya reminder bisa diklik.
const HOUR = 60 * 60 * 1000

function isoAgo(ms: number) {
  return new Date(Date.now() - ms).toISOString()
}

const summary = {
  openCount: 3,
  handoffTodayCount: 1,
  officialTokenValid: true,
  unofficialConfigured: false,
  needsAttention: [{ id: 'conv_1', contactName: 'Bruno', reason: 'Menunggu agen setelah handoff' }],
  remindersDue: [{ id: 'rem_1', note: 'Follow up DP', contactName: 'Bruno' }],
}

const conversations = [
  {
    id: 'conv_1',
    contactName: 'Bruno',
    contactPhone: '6281234567890',
    avatarUrl: null,
    // Baris log handoff: sentBy BOT, content null. Tidak ada apa pun yang dikirim ke pelanggan.
    lastMessage: null,
    lastMessageSentBy: 'BOT',
    lastMessageAt: isoAgo(4 * HOUR),
    botEnabled: false,
    status: 'OPEN',
    isTest: false,
  },
  {
    id: 'conv_2',
    contactName: 'Sinta',
    contactPhone: '6289999999999',
    avatarUrl: null,
    lastMessage: 'Kak, jemputannya jam berapa?',
    lastMessageSentBy: 'CUSTOMER',
    lastMessageAt: isoAgo(30 * 60 * 1000),
    botEnabled: false,
    status: 'OPEN',
    isTest: false,
  },
  // Bot masih memegang percakapan ini -> bukan antrean agen, tapi ikut dihitung "Dipegang bot".
  {
    id: 'conv_3',
    contactName: 'Wira',
    contactPhone: '6287777777777',
    avatarUrl: null,
    lastMessage: 'Harga paket Ijen berapa?',
    lastMessageSentBy: 'CUSTOMER',
    lastMessageAt: isoAgo(5 * 60 * 1000),
    botEnabled: true,
    status: 'OPEN',
    isTest: false,
  },
]

const reminders = [
  { id: 'rem_1', note: 'Follow up DP', dueAt: isoAgo(2 * HOUR), contactId: 'contact_1', contactName: 'Bruno' },
]

function mockEndpoints(overrides: Partial<Record<string, unknown>> = {}) {
  const bodies: Record<string, unknown> = {
    '/api/dashboard/summary': summary,
    '/api/conversations': conversations,
    '/api/reminders/due': reminders,
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
  it('memimpin dengan antrean chat yang menunggu, diurut dari yang paling lama', async () => {
    mockEndpoints()

    render(<DashboardPage />)

    expect(await screen.findByText('Beranda')).toBeInTheDocument()
    expect(screen.getByText('Chat menunggu dibalas')).toBeInTheDocument()

    // Dua yang menunggu manusia (conv_1 dan conv_2); conv_3 masih dipegang bot.
    const rows = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/inbox?conversation='))
    expect(rows.map((a) => a.getAttribute('href'))).toEqual([
      '/inbox?conversation=conv_1',
      '/inbox?conversation=conv_2',
    ])
    expect(within(rows[0]).getByText('Bruno')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Diserahkan bot')).toBeInTheDocument()
    expect(within(rows[0]).getByText('4 jam')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Sinta')).toBeInTheDocument()

    // Reminder tetap ada, sekarang bisa diklik ke kontaknya dan mengaku terlambat.
    const reminderLink = screen.getByRole('link', { name: /Follow up DP/ })
    expect(reminderLink).toHaveAttribute('href', '/contacts/contact_1')
    expect(within(reminderLink).getByText('Terlambat 2 jam')).toBeInTheDocument()

    // Angka konteks turun ke strip bawah, tapi tidak hilang -- dan tiap sel punya tujuan.
    const openLink = screen.getByRole('link', { name: /Percakapan terbuka/ })
    expect(within(openLink).getByText('3')).toBeInTheDocument()
    const handoffLink = screen.getByRole('link', { name: /Diserahkan bot hari ini/ })
    expect(handoffLink).toHaveAttribute('href', '/bot-control/decisions')
    expect(screen.getByRole('link', { name: /Dipegang bot/ })).toBeInTheDocument()

    // Saluran tidak resmi belum diatur -> peringatan keras di atas, dan fakta lengkapnya
    // tetap terbaca di baris bawah (satu-satunya tempatnya di ponsel).
    expect(screen.getByText('Saluran tidak resmi belum diatur')).toBeInTheDocument()
    expect(screen.getByText(/Tidak resmi — belum diatur/)).toBeInTheDocument()

    expect(location.href).toBe('http://localhost/dashboard')
  })

  it('merayakan antrean kosong alih-alih menampilkan kotak "tidak ada data"', async () => {
    mockEndpoints({
      '/api/dashboard/summary': { ...summary, needsAttention: [], unofficialConfigured: true },
      '/api/conversations': [conversations[2]],
      '/api/reminders/due': [],
    })

    render(<DashboardPage />)

    expect(await screen.findByText('Tidak ada yang menunggu dibalas')).toBeInTheDocument()
    expect(screen.getByText('Semua pelanggan sudah dijawab. 1 chat lain sedang dipegang bot.')).toBeInTheDocument()
    // Saluran sehat -> tidak ada peringatan sama sekali.
    expect(screen.queryByText(/tidak bisa mengirim pesan/)).not.toBeInTheDocument()
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
    expect(screen.queryByText('Bruno')).not.toBeInTheDocument()
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
    expect(screen.getByRole('status', { name: 'Memuat beranda' })).toBeInTheDocument()
    expect(screen.queryByText('Bruno')).not.toBeInTheDocument()
  })
})

describe('buildWaitingList', () => {
  const base = {
    contactName: 'X',
    contactPhone: '628',
    avatarUrl: null,
    lastMessage: 'halo',
    lastMessageSentBy: 'CUSTOMER',
    lastMessageAt: isoAgo(HOUR),
    botEnabled: false,
    status: 'OPEN',
    isTest: false,
  }

  it('menyertakan percakapan yang baru saja diserahkan bot, walau pesan terakhirnya milik BOT', () => {
    const rows = buildWaitingList({ ...summary, needsAttention: [{ id: 'a', contactName: null, reason: '' }] }, [
      { ...base, id: 'a', lastMessage: null, lastMessageSentBy: 'BOT' },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].handedOff).toBe(true)
    expect(rows[0].preview).toBe('Bot menyerahkan ke agen')
  })

  it('mengecualikan percakapan yang masih dipegang bot, yang sudah dijawab agen, sandbox, dan yang tertutup', () => {
    const rows = buildWaitingList({ ...summary, needsAttention: [] }, [
      { ...base, id: 'bot', botEnabled: true },
      { ...base, id: 'dijawab', lastMessageSentBy: 'AGENT' },
      { ...base, id: 'sandbox', isTest: true },
      { ...base, id: 'tertutup', status: 'CLOSED' },
    ])
    expect(rows).toEqual([])
  })

  it('mengurutkan yang paling lama menunggu ke atas', () => {
    const rows = buildWaitingList({ ...summary, needsAttention: [] }, [
      { ...base, id: 'baru', lastMessageAt: isoAgo(60_000) },
      { ...base, id: 'lama', lastMessageAt: isoAgo(9 * HOUR) },
      { ...base, id: 'sedang', lastMessageAt: isoAgo(3 * HOUR) },
    ])
    expect(rows.map((r) => r.id)).toEqual(['lama', 'sedang', 'baru'])
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
