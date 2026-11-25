import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewShell } from './Shell'

// Cangkang /new memakai data asli: lencana menu, pencarian global, nama akun, Keluar.
const push = vi.fn()
vi.mock('next/navigation', () => ({ usePathname: () => '/new/laporan', useRouter: () => ({ push }) }))
const redirectToLogin = vi.fn()
vi.mock('@/lib/fetch-json', async (orig) => ({ ...(await orig<typeof import('@/lib/fetch-json')>()), redirectToLogin: (o: unknown) => redirectToLogin(o) }))

type Route = (url: URL, init?: RequestInit) => unknown
function stub(routes: Record<string, Route>) {
  const fn = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://x')
    const r = routes[url.pathname]
    if (!r) return { ok: false, status: 404, json: async () => ({ error: 'tidak ada' }) } as Response
    return { ok: true, status: 200, json: async () => r(url, init) } as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const base: Record<string, Route> = {
  '/api/session': () => ({ name: 'Dewi Lestari', role: 'ADMIN' }),
  '/api/new/unread': () => ({ unread: 4 }),
  '/api/summary-items/count': () => ({ open: 9 }),
  '/api/new/agent-activity': () => ({ items: [{ status: 'gagal' }, { status: 'ok' }, { status: 'gagal' }] }),
  '/api/auth/logout': () => ({ ok: true }),
  '/api/conversations': (u) => (u.searchParams.get('q') === 'lukas'
    ? [
      { id: 'c1', contactName: 'Lukas', contactPhone: '4477', bookingGuestName: 'Lukas Braun', lastMessage: 'Kapan  jemput?', platform: 'WHATSAPP', isTest: false },
      { id: 'sb', contactName: 'Sandbox', contactPhone: null, bookingGuestName: null, lastMessage: 'x', platform: null, isTest: true },
    ]
    : []),
}

beforeEach(() => {
  push.mockClear(); redirectToLogin.mockClear()
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('cangkang /new: data asli', () => {
  it('lencana menu dari chat belum dibaca, antrean terbuka, agent gagal hari ini; nama akun dari sesi', async () => {
    stub(base)
    render(<NewShell><div /></NewShell>)
    await waitFor(() => expect(screen.getByTitle('Inbox').querySelector('.bd')?.textContent).toBe('4'))
    await waitFor(() => expect(screen.getByTitle('Antrean').querySelector('.bd')?.textContent).toBe('9'))
    await waitFor(() => expect(screen.getByTitle('Riwayat Agent').querySelector('.bd')?.textContent).toBe('2'))
    await waitFor(() => expect(document.querySelector('.uname')?.textContent).toBe('Dewi Lestari'))
    expect(document.querySelector('.uav')?.textContent).toBe('DL')
  })

  it('pencarian global mencari chat asli (tanpa sandbox) dan membuka /new/inbox', async () => {
    const fn = stub(base)
    render(<NewShell><div /></NewShell>)
    const input = screen.getByLabelText('Pencarian global')
    fireEvent.change(input, { target: { value: 'lukas' } })
    await waitFor(() => expect(screen.getByText('Lukas (Lukas Braun)')).toBeTruthy())
    expect(screen.queryByText('Sandbox')).toBeNull()
    expect(screen.getByText('WhatsApp · Kapan jemput?')).toBeTruthy()
    expect(fn.mock.calls.some(([u]) => String(u) === '/api/conversations?q=lukas')).toBe(true)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(push).toHaveBeenCalledWith('/new/inbox?conversation=c1')
  })

  it('Keluar memanggil logout sungguhan lalu ke halaman login', async () => {
    const fn = stub(base)
    render(<NewShell><div /></NewShell>)
    fireEvent.click(screen.getByLabelText('Menu akun'))
    await act(async () => { fireEvent.click(screen.getByText('Keluar')) })
    await waitFor(() => expect(redirectToLogin).toHaveBeenCalledWith({ keepPath: false }))
    expect(fn.mock.calls.some(([u, init]) => String(u) === '/api/auth/logout' && (init as RequestInit | undefined)?.method === 'POST')).toBe(true)
  })
})
