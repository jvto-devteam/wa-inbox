import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { AppRail, NAV_ITEMS, isActivePath, initialsFrom } from './AppRail'
import { BOT_CONTROL_SECTIONS } from './bot-control/BotControlNav'

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
      return jsonResponse({ officialTokenValid: true, unofficialConfigured: true })
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
    expect(isActivePath('/settings/knowledge-gaps', '/settings')).toBe(true)
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

// Tahap 1B mengganti BENTUK navigasi (bar atas -> rail ikon kiri) dan tidak boleh mengganti
// isinya. Daftar di bawah adalah salinan tetap dari tujuh tujuan seperti yang berdiri SEBELUM
// 1B; ia sengaja ditulis ulang di sini alih-alih diimpor, karena test yang mengimpor daftar
// yang sedang diuji tidak menguji apa pun.
const DESTINATIONS_BEFORE_1B = [
  ['Beranda', '/dashboard'],
  ['Inbox', '/inbox'],
  ['Kontak', '/contacts'],
  ['Template Pesan', '/templates'],
  ['Chatbot', '/chatbot'],
  ['Bot Control', '/bot-control'],
  ['Pengaturan', '/settings'],
] as const

describe('daftar tujuan rail', () => {
  it('sama persis dengan daftar bar atas sebelum Tahap 1B — label, href, dan urutannya', () => {
    expect(NAV_ITEMS.map((item) => [item.label, item.href])).toEqual(
      DESTINATIONS_BEFORE_1B.map(([label, href]) => [label, href])
    )
  })

  it('memberi setiap tujuan sebuah ikon, karena rail tanpa ikon adalah daftar teks yang sempit', () => {
    for (const item of NAV_ITEMS) {
      expect(typeof item.icon, `${item.label} tidak punya ikon`).not.toBe('undefined')
    }
    // Tujuh ikon yang berbeda. Dua tujuan yang berbagi satu ikon adalah dua tujuan yang tidak
    // bisa dibedakan sekilas, dan pasangan Chatbot/Bot Control adalah yang paling berisiko.
    expect(new Set(NAV_ITEMS.map((i) => i.icon)).size).toBe(NAV_ITEMS.length)
  })
})

describe('AppRail', () => {
  it('renders all seven top-level menus as real links to their routes', () => {
    stubApi()
    render(<AppRail />)

    for (const [label, href] of DESTINATIONS_BEFORE_1B) {
      // An anchor with a real href — a client-side <Link>, not a button that never navigates.
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href)
    }
  })

  it('marks the menu for the current route as the active page', () => {
    pathname.mockReturnValue('/inbox')
    stubApi()
    render(<AppRail />)

    expect(screen.getByRole('link', { name: 'Inbox' })).toHaveAttribute('aria-current', 'page')
    // Aksen adalah tanda "halaman aktif" di sistem desain Tahap 1A, dan rail adalah satu dari
    // tiga tempat ia boleh dibelanjakan.
    expect(screen.getByRole('link', { name: 'Inbox' }).className).toContain('bg-accent')
    expect(screen.getByRole('link', { name: 'Beranda' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Beranda' }).className).not.toContain('bg-accent')
  })

  it('moves the active marker when the route changes', () => {
    pathname.mockReturnValue('/templates')
    stubApi()
    render(<AppRail />)

    expect(screen.getByRole('link', { name: 'Template Pesan' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Inbox' })).not.toHaveAttribute('aria-current')
  })

  it('keeps the parent menu active on a nested route', () => {
    pathname.mockReturnValue('/contacts/ctc_1')
    stubApi()
    render(<AppRail />)

    expect(screen.getByRole('link', { name: 'Kontak' })).toHaveAttribute('aria-current', 'page')
    // Exactly one menu is ever active.
    expect(screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page')).toHaveLength(1)
  })

  it('meringkas kesehatan kedua kanal jadi satu penanda yang menautkan ke faktanya', async () => {
    stubApi()
    render(<AppRail />)

    // Dua lencana teks penuh tidak muat di rail 64px. Isinya tidak hilang: ia menjadi satu
    // titik + tooltip, dan titik itu adalah tautan ke /settings tempat angka lengkapnya ada.
    expect(await screen.findByText(/Official: Valid/)).toBeInTheDocument()
    expect(await screen.findByText(/Unofficial: Terkonfigurasi/)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Status kanal — Official: Valid · Unofficial: Terkonfigurasi' })
    ).toHaveAttribute('href', '/settings')
  })

  it('shows the failure wording when a channel is down', async () => {
    stubApi({
      '/api/numbers/status': async () => jsonResponse({ officialTokenValid: false, unofficialConfigured: false }),
    })
    render(<AppRail />)

    expect(await screen.findByText(/Official: Tidak valid/)).toBeInTheDocument()
    expect(await screen.findByText(/Unofficial: Belum diatur/)).toBeInTheDocument()
  })

  it('renders no channel indicator rather than a broken one when the status call fails', async () => {
    stubApi({
      '/api/numbers/status': async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response,
    })
    render(<AppRail />)

    // The account button still arrives, so this is a settled render, not an unfinished one.
    await screen.findByRole('button', { name: 'Akun Admin Demo' })
    expect(screen.queryByText(/Official:/)).not.toBeInTheDocument()
  })

  it('shows the signed-in account initials', async () => {
    stubApi()
    render(<AppRail />)

    expect(await screen.findByText('AD')).toBeInTheDocument()
  })

  it('logs out via POST /api/auth/logout and then goes to /login', async () => {
    const fetchMock = stubApi()
    render(<AppRail />)

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
    render(<AppRail />)

    fireEvent.click(await screen.findByRole('button', { name: 'Akun Admin Demo' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Keluar' }))

    // Redirecting on a failed logout would show the login screen to a browser that still
    // holds a valid session cookie.
    expect(await screen.findByText('Gagal keluar — coba lagi')).toBeInTheDocument()
    expect(globalThis.location.href).toBe('/inbox')
  })

  it('keeps the logout action behind the account menu until it is opened', async () => {
    stubApi()
    render(<AppRail />)

    await screen.findByRole('button', { name: 'Akun Admin Demo' })
    expect(screen.queryByRole('menuitem', { name: 'Keluar' })).not.toBeInTheDocument()
  })

  it('membuka menu akun sebagai overlay sungguhan, jadi ia berhak atas bayangan popover', async () => {
    // Salah satu dari dua bayangan yang tersisa di sistem Tahap 1A. Skala shadow-* Tailwind
    // dimatikan di sana, jadi `shadow-sm` di sini akan diam-diam tidak menghasilkan apa pun.
    stubApi()
    render(<AppRail />)

    fireEvent.click(await screen.findByRole('button', { name: 'Akun Admin Demo' }))
    const menu = screen.getByRole('menu')
    expect(menu.className).toContain('shadow-popover')
    expect(menu.className).not.toMatch(/\bshadow-(sm|md|lg|xl)\b/)
  })
})

describe('aksesibilitas rail', () => {
  it('adalah landmark navigasi dengan nama', () => {
    stubApi()
    render(<AppRail />)

    // Tanpa nama, pembaca layar mengumumkan "navigation" saja — dan halaman ini punya dua
    // landmark navigasi di dalam Bot Control.
    expect(screen.getByRole('navigation', { name: 'Menu utama' })).toBeInTheDocument()
  })

  it('memberi setiap ikon nama yang terbaca, lewat label yang juga terlihat di layar', () => {
    stubApi()
    render(<AppRail />)

    for (const item of NAV_ITEMS) {
      const link = screen.getByRole('link', { name: item.label })
      // Nama aksesibelnya BUKAN aria-label terpisah: ia teks yang benar-benar tampil, jadi
      // yang didengar dan yang dilihat tidak bisa berpisah.
      expect(link).toHaveTextContent(item.label)
      expect(link).not.toHaveAttribute('aria-label')
      // SVG-nya disembunyikan supaya tidak ikut menyusun nama itu.
      const svg = link.querySelector('svg')
      expect(svg, `${item.label} tidak punya ikon terpasang`).not.toBeNull()
      expect(svg).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('bisa dijelajahi keyboard dari ujung ke ujung, dengan fokus yang terlihat', () => {
    stubApi()
    render(<AppRail />)

    for (const item of NAV_ITEMS) {
      const link = screen.getByRole('link', { name: item.label })
      // <a href> ikut urutan tab bawaan; tidak ada tabIndex yang mengeluarkannya dari sana.
      expect(link).not.toHaveAttribute('tabindex')
      link.focus()
      expect(document.activeElement).toBe(link)
      expect(link.className).toMatch(/\bfocus-ring-inverse\b/)
    }
  })

  it('memakai cincin fokus versi terang, karena aksen di atas navy hanya 2.6:1', () => {
    // Kelasnya harus benar-benar ada di sistem desain, bukan kelas Tailwind yang tidak
    // menghasilkan apa-apa. Dibaca dari globals.css supaya test ini gagal kalau definisinya
    // dihapus di kemudian hari.
    const css = readFileSync(path.join(process.cwd(), 'src', 'app', 'globals.css'), 'utf-8')
    expect(css).toMatch(/\.focus-ring-inverse:focus-visible\s*\{[^}]*outline:\s*2px solid #ffffff/)
  })

  it('menandai logo sebagai dekorasi, bukan sebagai tujuan kedelapan yang diumumkan dua kali', () => {
    stubApi()
    const { container } = render(<AppRail />)

    const logo = container.querySelector('img')
    expect(logo).toHaveAttribute('alt', '')
    // Pembungkusnya tetap tautan yang bisa diklik, jadi ia butuh namanya sendiri.
    expect(screen.getByRole('link', { name: 'wa-inbox — beranda' })).toHaveAttribute('href', '/dashboard')
  })
})

// GERBANG "tidak ada tujuan yang hilang". Mengganti bar atas dengan rail hanya aman kalau
// setiap halaman yang ada masih punya jalan ke sana dari UI. Test ini membaca direktori
// halaman dari disk, bukan dari ingatan, jadi halaman yang jalannya terputus gagal di CI.
const authenticatedDir = path.join(process.cwd(), 'src', 'app', '(authenticated)')

/** Setiap rute dengan page.tsx di bawah grup rute terautentikasi, sebagai path URL. */
function routesOnDisk(dir: string = authenticatedDir, prefix = ''): string[] {
  const routes: string[] = []
  if (existsSync(path.join(dir, 'page.tsx'))) routes.push(prefix || '/')
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    routes.push(...routesOnDisk(path.join(dir, entry.name), `${prefix}/${entry.name}`))
  }
  return routes
}

/** Seluruh sumber .tsx aplikasi (tanpa test), digabung — tempat mencari href yang menautkan. */
function appSource(dir: string = path.join(process.cwd(), 'src')): string {
  let out = ''
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out += appSource(full)
    } else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) {
      out += readFileSync(full, 'utf-8')
    }
  }
  return out
}

describe('semua halaman masih terjangkau', () => {
  const routes = routesOnDisk()
  const source = appSource()
  const railHrefs = new Set(NAV_ITEMS.map((i) => i.href))
  const subNavHrefs = new Set(BOT_CONTROL_SECTIONS.map((s) => s.href as string))

  it('menemukan kesembilan belas halaman di disk, bukan lebih sedikit', () => {
    // Angka ini adalah jumlah halaman saat Tahap 1B ditulis. Kalau ia berubah, test-test di
    // bawah harus dibaca ulang secara sadar, bukan lolos diam-diam.
    expect(routes).toHaveLength(19)
  })

  for (const route of routesOnDisk()) {
    it(`punya jalan dari UI menuju ${route}`, () => {
      if (railHrefs.has(route) || subNavHrefs.has(route)) return

      // Rute dinamis tidak bisa ditulis sebagai href literal; ia dibangun dari data di halaman
      // induknya (/contacts -> /contacts/<id>), jadi yang harus terjangkau adalah induknya.
      if (route.includes('[')) {
        const parent = route.slice(0, route.lastIndexOf('/')) || '/'
        expect(railHrefs.has(parent) || subNavHrefs.has(parent), `induk ${parent} tidak terjangkau`).toBe(true)
        return
      }

      // Sisanya adalah halaman bersarang yang dijangkau lewat tautan di dalam halaman lain
      // (/settings/billing dari /settings, /settings/knowledge-gaps dari /chatbot). Cukup satu
      // tautan di mana pun di aplikasi; yang dilarang adalah nol.
      expect(source.includes(`href="${route}"`), `tidak ada satu pun href="${route}" di aplikasi`).toBe(true)
    })
  }

  it('tidak menautkan tujuan rail yang tidak punya halaman', () => {
    for (const item of NAV_ITEMS) {
      const dir = path.join(authenticatedDir, item.href.replace(/^\//, ''))
      expect(existsSync(path.join(dir, 'page.tsx')), `${item.href} tidak punya page.tsx`).toBe(true)
      expect(statSync(dir).isDirectory()).toBe(true)
    }
  })
})
