import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NewShell } from '../Shell'
import { InboxView } from './InboxView'

// Inbox /new memasang InboxScreen (susunan Inbox asli). Tiga komponen anaknya ditiru di sini -- yang diuji hanya
// sambungan /new: alamat yang ditulis, mode chat ponsel, dan pembungkus kulit. Logika membalas diuji di test
// komponen Inbox sendiri, yang tidak diubah.
let search = new URLSearchParams()
const replace = vi.fn()
const push = vi.fn()
vi.mock('next/navigation', () => ({
  usePathname: () => '/new/inbox',
  useRouter: () => ({ push, replace }),
  useSearchParams: () => search,
}))
vi.mock('@/components/inbox/ConversationList', () => ({
  ConversationList: ({ onSelect }: { onSelect: (id: string) => void }) => <button onClick={() => onSelect('c1')}>pilih c1</button>,
}))
vi.mock('@/components/inbox/ThreadView', () => ({
  ThreadView: ({ conversationId, onBack }: { conversationId: string; onBack: () => void }) => (
    <div data-testid="thread">{conversationId}<button onClick={onBack}>kembali</button>
      <a href="/inbox?conversation=c2&message=m5&lihat=1">butir ringkasan</a>
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

describe('Inbox /new = Inbox asli dengan kulit baru', () => {
  it('memasang susunan Inbox asli di dalam pembungkus kulit; memilih chat menulis alamat /new/inbox', () => {
    render(<NewShell><InboxView /></NewShell>)
    expect(document.querySelector('#v-inbox .inbox-real')).not.toBeNull()
    fireEvent.click(screen.getByText('pilih c1'))
    expect(replace).toHaveBeenCalledWith('/new/inbox?conversation=c1', { scroll: false })
    expect(screen.getByTestId('thread').textContent).toContain('c1')
  })

  it('tautan /inbox?... di dalam komponen Inbox tetap dibuka di /new/inbox; tautan lain tidak disentuh', () => {
    search = new URLSearchParams('conversation=c1')
    render(<NewShell><InboxView /></NewShell>)
    const inner = screen.getByText('butir ringkasan')
    expect(fireEvent.click(inner)).toBe(false) // default dicegah
    expect(push).toHaveBeenCalledWith('/new/inbox?conversation=c2&message=m5&lihat=1')
    push.mockClear()
    fireEvent.click(screen.getByText("portal"))
    expect(push).not.toHaveBeenCalled()
    // Ctrl/⌘-klik = tab baru, dibiarkan
    fireEvent.click(inner, { metaKey: true })
    expect(push).not.toHaveBeenCalled()
  })

  it('tautan ?conversation= membuka chat itu (sama dengan /inbox)', () => {
    search = new URLSearchParams('conversation=c9')
    render(<NewShell><InboxView /></NewShell>)
    expect(screen.getByTestId('thread').textContent).toContain('c9')
  })

  it('ponsel: chat terbuka menyembunyikan bar atas/bawah /new, kembali memunculkannya', () => {
    mobile(true)
    render(<NewShell><InboxView /></NewShell>)
    const root = document.querySelector('.nwa')!
    expect(root.classList.contains('m-inchat')).toBe(false)
    fireEvent.click(screen.getByText('pilih c1'))
    expect(root.classList.contains('m-inchat')).toBe(true)
    fireEvent.click(screen.getByText('kembali'))
    expect(root.classList.contains('m-inchat')).toBe(false)
  })

  it('kulit hanya memetakan variabel tema dan menetralkan aturan umum /new yang bentrok', () => {
    const css = readFileSync(join(__dirname, '..', '..', '..', 'app', 'new', 'new.css'), 'utf8')
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
