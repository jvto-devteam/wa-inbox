import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NewShell } from '../Shell'
import { InboxView } from './InboxView'

// Inbox memasang InboxScreen (komponen Inbox dengan markup desain artifact). Tiga komponen anaknya ditiru di sini --
// yang diuji hanya sambungan ke aplikasi: alamat yang ditulis, mode chat + lembar info ponsel, dan penjaga tautan.
// Logika membalas diuji di test komponen Inbox sendiri.
let search = new URLSearchParams()
const replace = vi.fn()
const push = vi.fn()
vi.mock('next/navigation', () => ({
  usePathname: () => '/inbox',
  useRouter: () => ({ push, replace }),
  useSearchParams: () => search,
}))
vi.mock('@/components/inbox/ConversationList', () => ({
  ConversationList: ({ onSelect }: { onSelect: (id: string) => void }) => <button onClick={() => onSelect('c1')}>pilih c1</button>,
}))
vi.mock('@/components/inbox/ThreadView', () => ({
  ThreadView: ({ conversationId, onBack, onInfo }: { conversationId: string; onBack: () => void; onInfo?: () => void }) => (
    <div data-testid="thread">{conversationId}<button onClick={onBack}>kembali</button><button onClick={onInfo}>info</button>
      <a href="/inbox?conversation=c2&message=m5&lihat=1">butir ringkasan</a>
      <a href="/contacts/k1?tab=x">kontak lama</a>
      <a href="https://jvto.me/b/abc">portal</a>
    </div>
  ),
}))
vi.mock('@/components/inbox/ContactPanel', () => ({ ContactPanel: () => <div data-testid="panel" /> }))

const mobile = (on: boolean) => {
  window.matchMedia = ((q: string) => ({
    matches: on, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  replace.mockClear()
  push.mockClear()
  search = new URLSearchParams()
  mobile(false)
})

describe('Inbox = komponen Inbox dengan markup desain baru', () => {
  it('memasang tiga kolom .inbox langsung (tanpa kulit .legacy-skin di luarnya); memilih chat menulis alamat /inbox', () => {
    render(<NewShell><InboxView /></NewShell>)
    expect(document.querySelector('#v-inbox .inbox-frame > .inbox')).not.toBeNull()
    // Kulit lama mereset font/warna tombol di dalamnya -- di luar markup baru ia akan merusak .btn desain baru.
    expect(document.querySelector('#v-inbox .inbox-frame.legacy-skin')).toBeNull()
    fireEvent.click(screen.getByText('pilih c1'))
    expect(replace).toHaveBeenCalledWith('/inbox?conversation=c1', { scroll: false })
    expect(screen.getByTestId('thread').textContent).toContain('c1')
  })

  it('tautan ke halaman lama yang sudah digantikan dibuka di padanan barunya; tautan lain tidak disentuh', () => {
    search = new URLSearchParams('conversation=c1')
    render(<NewShell><InboxView /></NewShell>)
    const old = screen.getByText('kontak lama')
    expect(fireEvent.click(old)).toBe(false) // default dicegah
    expect(push).toHaveBeenCalledWith('/kontak/k1?tab=x')
    push.mockClear()
    // /inbox sudah alamat aplikasi ini: tidak dibelokkan
    const inbox = screen.getByText('butir ringkasan')
    inbox.addEventListener('click', (e) => e.preventDefault()) // jsdom tidak bernavigasi
    fireEvent.click(inbox)
    fireEvent.click(screen.getByText('portal'))
    expect(push).not.toHaveBeenCalled()
    // Ctrl/⌘-klik = tab baru, dibiarkan
    fireEvent.click(old, { metaKey: true })
    expect(push).not.toHaveBeenCalled()
  })

  it('belum ada chat dipilih: tiga kolom, dua kolom kosong tanpa teks dan tanpa inline display (CSS ponsel menyembunyikannya)', () => {
    render(<NewShell><InboxView /></NewShell>)
    const cols = Array.from(document.querySelectorAll('#v-inbox .inbox > .col')) as HTMLElement[]
    expect(cols).toHaveLength(2) // daftar ditiru (tombol), sisanya dua kolom kosong
    for (const c of cols) {
      expect(c.textContent).toBe('')
      expect(c.style.display).toBe('')
    }
    expect(screen.queryByText('Pilih percakapan')).toBeNull()
  })

  it('tautan ?conversation= membuka chat itu (sama dengan /inbox)', () => {
    search = new URLSearchParams('conversation=c9')
    render(<NewShell><InboxView /></NewShell>)
    expect(screen.getByTestId('thread').textContent).toContain('c9')
  })

  it('ponsel: chat terbuka menyembunyikan bar atas/bawah aplikasi, kembali memunculkannya', () => {
    mobile(true)
    render(<NewShell><InboxView /></NewShell>)
    const root = document.querySelector('.nwa')!
    expect(root.classList.contains('m-inchat')).toBe(false)
    fireEvent.click(screen.getByText('pilih c1'))
    expect(root.classList.contains('m-inchat')).toBe(true)
    fireEvent.click(screen.getByText('kembali'))
    expect(root.classList.contains('m-inchat')).toBe(false)
  })

  it('ponsel: tombol info membuka panel kanan sebagai lembar bawah; ketuk latar menutupnya', () => {
    mobile(true)
    search = new URLSearchParams('conversation=c1')
    render(<NewShell><InboxView /></NewShell>)
    const root = document.querySelector('.nwa')!
    fireEvent.click(screen.getByText('info'))
    expect(root.classList.contains('m-info')).toBe(true)
    fireEvent.click(document.querySelector('#v-inbox .infoscrim')!)
    expect(root.classList.contains('m-info')).toBe(false)
  })

  it('CSS Inbox desain artifact tersedia untuk markup komponen Inbox', () => {
    const css = readFileSync(join(__dirname, '..', '..', '..', 'app', '(app)', 'new.css'), 'utf8')
    for (const sel of ['.nwa .inbox{', '.nwa .row{', '.nwa .chead{', '.nwa .msgs{', '.nwa .m.g{', '.nwa .comp{', '.nwa .pan{', '.nwa .box{', '.nwa .mpop{', '.nwa .mwrap{'])
      expect(css, sel).toContain(sel)
  })

  it('tautan di gelembung biru (bot/agen) ikut warna teks gelembung, tidak biru di atas biru', () => {
    const css = readFileSync(join(__dirname, '..', '..', '..', 'app', '(app)', 'new.css'), 'utf8')
    expect(css).toContain('.nwa .m.b a,.nwa .m.a a{color:inherit}')
  })

  it('kulit hanya memetakan variabel tema dan menetralkan aturan umum desain baru yang bentrok', () => {
    const css = readFileSync(join(__dirname, '..', '..', '..', 'app', '(app)', 'new.css'), 'utf8')
    const globals = readFileSync(join(__dirname, '..', '..', '..', 'app', 'globals.css'), 'utf8')
    const block = css.slice(css.indexOf('.nwa .legacy-skin{'))
    // setiap variabel warna tema Inbox lama dipetakan (supaya tidak ada warna lama yang tertinggal)
    const themeColors = [...globals.matchAll(/^\s*(--color-[a-z-]+):/gm)].map((m) => m[1])
    expect(themeColors.length).toBeGreaterThan(20)
    for (const v of themeColors) expect(block, v + ' tidak dipetakan').toContain(v + ':')
    expect(block).toContain('.nwa .legacy-skin :is(button,input,select,textarea){font:revert-layer;color:revert-layer}')
    expect(block).toContain('.nwa .legacy-skin .grid{gap:revert-layer}')
  })
})
