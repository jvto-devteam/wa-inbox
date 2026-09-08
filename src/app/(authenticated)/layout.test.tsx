import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import AuthenticatedLayout from './layout'

// The layout now renders <AppRail>, which reads usePathname() and fetches its own data.
// Mocked here so these tests stay about the route group's structure; AppRail's own behaviour
// (active menu, badges, logout) is covered in src/components/AppRail.test.tsx.
vi.mock('next/navigation', () => ({ usePathname: () => '/inbox' }))

class FakeEventSource {
  static instances: FakeEventSource[] = []
  static urls: string[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  close = vi.fn()
  constructor(url: string) {
    FakeEventSource.instances.push(this)
    FakeEventSource.urls.push(url)
  }
}

const requestPermission = vi.fn(() => Promise.resolve('granted' as NotificationPermission))

beforeEach(() => {
  FakeEventSource.instances = []
  FakeEventSource.urls = []
  requestPermission.mockClear()
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('Notification', Object.assign(vi.fn(), { permission: 'default', requestPermission }))
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/numbers/status') {
        return { ok: true, status: 200, json: async () => ({ officialTokenValid: true, unofficialConfigured: true }) }
      }
      return { ok: true, status: 200, json: async () => ({ role: 'ADMIN', name: 'Admin Demo' }) }
    })
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const appDir = path.join(process.cwd(), 'src', 'app')

// NotificationListener used to live in the ROOT layout, so it mounted on /login too — a
// public path per middleware's PUBLIC_PATHS, while /api/sse is not. Its EventSource got a
// 401 there and, with no onerror handler, the browser retried forever against an endpoint
// that cannot succeed until the user signs in; it also asked for notification permission
// before anyone had logged in.
//
// The fix is structural rather than a pathname check inside the component, so these tests
// assert the structure: the listener is wired to the authenticated route group, and the
// login screen is outside that group and therefore cannot reach it.
describe('authenticated route group', () => {
  it('opens the SSE subscription and asks for notification permission on authenticated pages', () => {
    render(<AuthenticatedLayout>{<div>halaman</div>}</AuthenticatedLayout>)

    expect(FakeEventSource.urls).toEqual(['/api/sse'])
    expect(requestPermission).toHaveBeenCalled()
  })

  it('still renders the page it wraps', () => {
    const { getByText } = render(<AuthenticatedLayout>{<div>halaman</div>}</AuthenticatedLayout>)

    expect(getByText('halaman')).toBeInTheDocument()
  })

  it('keeps /login outside the authenticated group, so nothing there can mount the listener', () => {
    // If /login were ever moved into the group it would inherit this layout — and with it the
    // EventSource that 401-loops for an unauthenticated visitor.
    expect(existsSync(path.join(appDir, 'login', 'page.tsx'))).toBe(true)
    expect(existsSync(path.join(appDir, '(authenticated)', 'login'))).toBe(false)
  })

  it('does not mount NotificationListener from the root layout', () => {
    const rootLayout = readFileSync(path.join(appDir, 'layout.tsx'), 'utf-8')

    // A root-layout mount reaches every page, public ones included — the original bug.
    expect(rootLayout).not.toMatch(/<NotificationListener/)
    expect(rootLayout).not.toMatch(/^import .*NotificationListener/m)
  })

  it('covers every authenticated top-level route with the group', () => {
    for (const route of ['dashboard', 'inbox', 'contacts', 'settings', 'templates']) {
      expect(existsSync(path.join(appDir, '(authenticated)', route))).toBe(true)
      expect(existsSync(path.join(appDir, route))).toBe(false)
    }
  })
})

// Until this wave, /dashboard, /inbox, /contacts, /templates and /settings had no links
// between them anywhere in the UI — the only way to reach one was to type its URL — and there
// was no logout control in the app at all. The group layout is where the shell belongs,
// because "wrapped by this layout" and "should show the top-level menus" are the same set of
// pages. Tahap 1B mengganti bentuk shell itu (bar atas -> rail ikon), bukan isinya.
describe('global navigation shell', () => {
  it('gives every authenticated page every top-level menu', () => {
    render(<AuthenticatedLayout>{<div>halaman</div>}</AuthenticatedLayout>)

    // Daftarnya ditulis penuh di sini — tujuh, bukan lima seperti sebelumnya. Chatbot dan Bot
    // Control sudah lama ada di bar atas tapi tidak pernah ikut dijaga test ini.
    for (const [label, href] of [
      ['Beranda', '/dashboard'],
      ['Inbox', '/inbox'],
      ['Kontak', '/contacts'],
      ['Template Pesan', '/templates'],
      ['Chatbot', '/chatbot'],
      ['Bot Control', '/bot-control'],
      ['Pengaturan', '/settings'],
    ]) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href)
    }
  })

  it('gives every authenticated page a way to reach the logout action', async () => {
    render(<AuthenticatedLayout>{<div>halaman</div>}</AuthenticatedLayout>)

    // POST /api/auth/logout has existed since Task 4 with nothing in the UI calling it.
    expect(await screen.findByRole('button', { name: 'Akun Admin Demo' })).toBeInTheDocument()
  })

  it('does not put the nav bar on the public login screen', () => {
    // /login is outside the group, so it cannot inherit this layout. Guard the other half of
    // that too: the root layout must not grow its own copy of the nav.
    const rootLayout = readFileSync(path.join(appDir, 'layout.tsx'), 'utf-8')
    expect(rootLayout).not.toMatch(/<AppRail/)
  })

  it('owns the viewport height so a full-height page cannot push the rail off screen', () => {
    // /inbox is a three-pane h-full grid. If the shell did not cap the height, the document
    // would be nav + 100vh tall and the rail would scroll away.
    const layout = readFileSync(path.join(appDir, '(authenticated)', 'layout.tsx'), 'utf-8')
    expect(layout).toMatch(/className="[^"]*\bh-screen\b/)

    const inbox = readFileSync(path.join(appDir, '(authenticated)', 'inbox', 'page.tsx'), 'utf-8')
    expect(inbox).not.toMatch(/className="[^"]*\bh-screen\b/)
  })

  it('menaruh rail di kiri pada layar lebar dan di bawah pada layar sempit, dari satu susunan', () => {
    const layout = readFileSync(path.join(appDir, '(authenticated)', 'layout.tsx'), 'utf-8')

    // flex-col-reverse menaruh anak PERTAMA (rail) di bawah; md:flex-row menaruhnya di kiri.
    // Satu susunan DOM untuk dua bentuk: kalau ini pernah dipecah jadi dua salinan yang
    // di-hide bergantian, setiap tujuan akan ada dua kali di DOM dan pembaca layar akan
    // mengumumkan menu ganda di setiap halaman.
    expect(layout).toMatch(/flex-col-reverse/)
    expect(layout).toMatch(/md:flex-row/)
  })

  it('menyerahkan judul halaman ke satu komponen, jadi tidak ada halaman yang menulis <h1> sendiri', () => {
    // Sebelum Tahap 1B, 17 halaman menyalin `<h1 className="text-xl font-semibold text-navy">`
    // tangan demi tangan — dan sebagian sudah mulai berbeda (ada yang punya `mb-4`, ada yang
    // dibungkus space-y-1, ada yang tidak). Yang menjaga mereka tetap sama bukan disiplin,
    // tapi test ini: satu <h1> hidup di <PageHeader>, dan halaman memanggilnya.
    function pagesUnder(dir: string): string[] {
      const out: string[] = []
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) out.push(...pagesUnder(full))
        else if (entry.name === 'page.tsx') out.push(full)
      }
      return out
    }

    for (const file of pagesUnder(path.join(appDir, '(authenticated)'))) {
      expect(readFileSync(file, 'utf-8'), `${file} menulis <h1> sendiri`).not.toMatch(/<h1[\s>]/)
    }
  })

  it('menyerahkan gulungan ke area konten, bukan ke dokumen', () => {
    // Halaman biasa menggulung di kotak ini; halaman setinggi penuh memakai h-full dan
    // scroller-nya sendiri, sehingga kotak ini tidak pernah aktif — tidak ada gulungan ganda.
    // `min-h-0`/`min-w-0` wajib: default min-size:auto pada flex item mendorong overflow-nya
    // balik ke dokumen dan rail ikut tergulung keluar layar.
    const layout = readFileSync(path.join(appDir, '(authenticated)', 'layout.tsx'), 'utf-8')
    expect(layout).toMatch(/className="min-h-0 min-w-0 flex-1 overflow-y-auto"/)
  })
})
