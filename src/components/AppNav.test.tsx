import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { AppNav, isActivePath, initialsFrom } from './AppNav'

const pathname = vi.fn(() => '/inbox')
vi.mock('next/navigation', () => ({ usePathname: () => pathname() }))

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response
}

// Default happy-path backend. Individual tests override before rendering.
function stubApi(overrides: Record<string, () => Promise<Response>> = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = init?.method ? `${init.method} ${url}` : url
    const handler = overrides[key]
    if (handler) return handler()
    if (url === '/api/numbers/status') {
      return jsonResponse({ officialTokenValid: true, unofficialConnected: true })
    }
    if (url === '/api/session') return jsonResponse({ role: 'ADMIN', name: 'Admin Demo' })
    if (url === '/api/auth/logout') return jsonResponse({ ok: true })
    throw new Error(`unexpected fetch: ${key}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  pathname.mockReturnValue('/inbox')
  vi.stubGlobal('location', { href: '/inbox', pathname: '/inbox' })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('isActivePath', () => {
  it('matches the menu route itself', () => {
    expect(isActivePath('/contacts', '/contacts')).toBe(true)
  })

  it('matches nested routes so /contacts/<id> keeps Kontak lit', () => {
    expect(isActivePath('/contacts/abc123', '/contacts')).toBe(true)
    expect(isActivePath('/settings/bot-log', '/settings')).toBe(true)
  })

  it('does not match an unrelated route that merely shares a character prefix', () => {
    // A bare startsWith() would light up "Kontak" here.
    expect(isActivePath('/contacts-import', '/contacts')).toBe(false)
    expect(isActivePath('/dashboard', '/contacts')).toBe(false)
  })
})

describe('initialsFrom', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsFrom('Bruno Figarola JVTO')).toBe('BF')
  })

  it('handles a single-word name', () => {
    expect(initialsFrom('Rina')).toBe('R')
  })

  it('falls back to ? for an empty name', () => {
    expect(initialsFrom('   ')).toBe('?')
  })
})

describe('AppNav', () => {
  it('renders all five top-level menus as real links to their routes', () => {
    stubApi()
    render(<AppNav />)

    const expected = [
      ['Beranda', '/dashboard'],
      ['Chat / Inbox', '/inbox'],
      ['Kontak', '/contacts'],
      ['Template Pesan', '/templates'],
      ['Pengaturan', '/settings'],
    ]
    for (const [label, href] of expected) {
      // An anchor with a real href — a client-side <Link>, not a button that never navigates.
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href)
    }
  })

  it('marks the menu for the current route as the active page', () => {
    pathname.mockReturnValue('/inbox')
    stubApi()
    render(<AppNav />)

    expect(screen.getByRole('link', { name: 'Chat / Inbox' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Chat / Inbox' }).className).toContain('text-brand')
    expect(screen.getByRole('link', { name: 'Beranda' })).not.toHaveAttribute('aria-current')
  })

  it('moves the active marker when the route changes', () => {
    pathname.mockReturnValue('/templates')
    stubApi()
    render(<AppNav />)

    expect(screen.getByRole('link', { name: 'Template Pesan' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Chat / Inbox' })).not.toHaveAttribute('aria-current')
  })

  it('keeps the parent menu active on a nested route', () => {
    pathname.mockReturnValue('/contacts/ctc_1')
    stubApi()
    render(<AppNav />)

    expect(screen.getByRole('link', { name: 'Kontak' })).toHaveAttribute('aria-current', 'page')
    // Exactly one menu is ever active.
    expect(screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page')).toHaveLength(1)
  })

  it('renders both channel badges from /api/numbers/status', async () => {
    stubApi()
    render(<AppNav />)

    expect(await screen.findByText(/Official: Valid/)).toBeInTheDocument()
    expect(await screen.findByText(/Unofficial: Tersambung/)).toBeInTheDocument()
  })

  it('shows the failure wording when a channel is down', async () => {
    stubApi({
      '/api/numbers/status': async () => jsonResponse({ officialTokenValid: false, unofficialConnected: false }),
    })
    render(<AppNav />)

    expect(await screen.findByText(/Official: Tidak valid/)).toBeInTheDocument()
    expect(await screen.findByText(/Unofficial: Terputus/)).toBeInTheDocument()
  })

  it('renders no badges rather than broken ones when the status call fails', async () => {
    stubApi({
      '/api/numbers/status': async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response,
    })
    render(<AppNav />)

    // The account button still arrives, so this is a settled render, not an unfinished one.
    await screen.findByRole('button', { name: 'Akun Admin Demo' })
    expect(screen.queryByText(/Official:/)).not.toBeInTheDocument()
  })

  it('shows the signed-in account initials', async () => {
    stubApi()
    render(<AppNav />)

    expect(await screen.findByText('AD')).toBeInTheDocument()
  })

  it('logs out via POST /api/auth/logout and then goes to /login', async () => {
    const fetchMock = stubApi()
    render(<AppNav />)

    fireEvent.click(await screen.findByRole('button', { name: 'Akun Admin Demo' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Keluar' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' })
    })
    await waitFor(() => expect(globalThis.location.href).toBe('/login'))
  })

  it('stays put and reports the failure when logout does not succeed', async () => {
    stubApi({
      'POST /api/auth/logout': async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response,
    })
    render(<AppNav />)

    fireEvent.click(await screen.findByRole('button', { name: 'Akun Admin Demo' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Keluar' }))

    // Redirecting on a failed logout would show the login screen to a browser that still
    // holds a valid session cookie.
    expect(await screen.findByText('Gagal keluar — coba lagi')).toBeInTheDocument()
    expect(globalThis.location.href).toBe('/inbox')
  })

  it('keeps the logout action behind the account menu until it is opened', async () => {
    stubApi()
    render(<AppNav />)

    await screen.findByRole('button', { name: 'Akun Admin Demo' })
    expect(screen.queryByRole('menuitem', { name: 'Keluar' })).not.toBeInTheDocument()
  })
})
