import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import BotControlLayout from './layout'
import BotControlPage from './page'
import { AppRail } from '@/components/AppRail'
import { BOT_CONTROL_SECTIONS } from '@/components/bot-control/BotControlNav'

const pathname = vi.fn(() => '/bot-control')
vi.mock('next/navigation', () => ({ usePathname: () => pathname() }))

beforeEach(() => {
  pathname.mockReturnValue('/bot-control')
  // AppRail memasang GapBell, yang membuka EventSource sendiri; jsdom tidak punya kelas itu.
  // Stub no-op sudah cukup -- perilaku loncengnya diuji di src/components/GapBell.test.tsx.
  vi.stubGlobal(
    'EventSource',
    class {
      onmessage: ((event: MessageEvent) => void) | null = null
      close = vi.fn()
    }
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const botControlDir = path.join(process.cwd(), 'src', 'app', '(authenticated)', 'bot-control')

/** Setiap sub-direktori yang benar-benar merender halaman, dibaca dari disk. */
function pageDirectoriesOnDisk(): string[] {
  return readdirSync(botControlDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(botControlDir, entry.name, 'page.tsx')))
    .map((entry) => entry.name)
    .sort()
}

// GERBANG UTAMA item ini. Halaman kartu /bot-control dulu adalah satu-satunya daftar tautan ke
// bagian-bagian Bot Control; menggantinya dengan baris tab hanya aman kalau daftar tab itu
// benar-benar mencakup semua halaman yang ada. Test ini membaca direktori, bukan ingatan, jadi
// halaman baru yang lupa didaftarkan di BOT_CONTROL_SECTIONS gagal di CI alih-alih menjadi
// halaman yatim: ada file-nya, tidak ada jalan ke sana dari UI.
describe('tidak ada halaman Bot Control yang yatim', () => {
  it('menautkan setiap halaman di direktori bot-control dari sub-nav', () => {
    const hrefsOnDisk = ['/bot-control', ...pageDirectoriesOnDisk().map((dir) => `/bot-control/${dir}`)].sort()
    const hrefsInNav = BOT_CONTROL_SECTIONS.map((s) => s.href as string).sort()

    expect(hrefsInNav).toEqual(hrefsOnDisk)
  })

  it('tidak menautkan rute yang tidak punya halaman', () => {
    // Sisi sebaliknya dari test di atas, dinyatakan sebagai janji terpisah supaya pesan
    // gagalnya jelas: tab yang menunjuk ke 404 mengajarkan bahwa menu ini tidak bisa dipercaya.
    for (const section of BOT_CONTROL_SECTIONS) {
      const segment = section.href.replace('/bot-control', '').replace(/^\//, '')
      const file = segment ? path.join(botControlDir, segment, 'page.tsx') : path.join(botControlDir, 'page.tsx')
      expect(existsSync(file), `${section.href} tidak punya page.tsx`).toBe(true)
    }
  })
})

describe('layout Bot Control', () => {
  it('memberi sub-nav ke setiap halaman Bot Control', () => {
    render(<BotControlLayout>{<div>halaman</div>}</BotControlLayout>)

    // Halaman yang dibungkus tetap tampil, dan navigasinya ikut — dua-duanya, bukan salah satu.
    expect(screen.getByText('halaman')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Menu Bot Control' })
    for (const section of BOT_CONTROL_SECTIONS) {
      expect(screen.getByRole('link', { name: section.label })).toHaveAttribute('href', section.href)
    }
    expect(nav).toBeInTheDocument()
  })

  it('memasang sub-nav di akar bot-control sehingga semua halaman mewarisinya', () => {
    // Struktural, bukan per halaman: selama layout ini ada di akar dan tidak ada layout lain
    // yang menimpanya di sub-direktori, halaman baru mana pun otomatis mendapat navigasinya.
    expect(existsSync(path.join(botControlDir, 'layout.tsx'))).toBe(true)
    for (const dir of pageDirectoriesOnDisk()) {
      expect(existsSync(path.join(botControlDir, dir, 'layout.tsx')), `${dir} menimpa layout`).toBe(false)
    }
  })
})

describe('/bot-control itu sendiri', () => {
  it('tetap berupa halaman ringkas, bukan redirect yang bisa berputar', () => {
    const source = readFileSync(path.join(botControlDir, 'page.tsx'), 'utf-8')

    // Sebuah redirect() di halaman induk yang tab pertamanya menunjuk balik ke induk adalah
    // resep loop; halaman ini sengaja tidak punya satu pun.
    expect(source).not.toMatch(/\bredirect\s*\(/)
    expect(source).not.toMatch(/next\/navigation/)
  })

  it('menampilkan isi nyata, bukan kartu-kartu tautan', () => {
    render(<BotControlPage />)

    expect(screen.getByRole('heading', { name: 'Bot Control', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Kemampuan per channel' })).toBeInTheDocument()
    // Kartu-kartu tautan lama sudah pindah ke sub-nav; halaman ini tidak boleh menumbuhkan
    // salinan keduanya, karena dua daftar tautan yang sama pasti akan berbeda suatu hari.
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })
})

describe('tautan Bot Control di AppRail', () => {
  it('masih mengarah ke /bot-control dan tetap menyala di rute bersarang', async () => {
    pathname.mockReturnValue('/bot-control/rules')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () =>
          url === '/api/numbers/status'
            ? { officialTokenValid: true, unofficialConfigured: true }
            : { role: 'ADMIN', name: 'Admin Demo' },
      }))
    )
    render(<AppRail />)

    // Tunggu kedua probe AppRail selesai supaya ini render yang sudah settle.
    await screen.findByRole('button', { name: 'Akun Admin Demo' })
    const link = screen.getByRole('link', { name: 'Bot Control' })
    expect(link).toHaveAttribute('href', '/bot-control')
    expect(link).toHaveAttribute('aria-current', 'page')
  })
})
