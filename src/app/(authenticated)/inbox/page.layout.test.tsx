import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import InboxPage from './page'

// Geometri cangkang /inbox, ditegakkan sebagai test dan bukan sebagai kepercayaan.
//
// Dua hal yang dijaga di sini, dan dua-duanya pernah rusak tanpa ketahuan sampai seseorang
// membuka halamannya di layar sungguhan:
//
//  1. TIDAK ADA GULUNGAN GANDA. Halaman ini setinggi kontainernya (h-full), bukan setinggi
//     viewport (h-screen) dan bukan setinggi isinya. Barisnya minmax(0,1fr) supaya thread yang
//     panjang tidak menumbuhkan grid melewati layar dan membuat pembungkus layout luar
//     menggulung seluruh tiga kolom sebagai satu blok.
//  2. TIGA BENTUK DARI SATU SUSUNAN DOM. Di bawah md daftar menghilang saat sebuah percakapan
//     dibuka (satu kolom bertingkat); panel kontak baru punya kolom dari xl ke atas.

let mockSearchParams: URLSearchParams

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  // Dipakai InboxPage untuk mencerminkan percakapan pilihan operator ke URL; cangkang tiga
  // kolom tidak peduli isinya, hanya tidak boleh meledak saat dipanggil.
  useRouter: () => ({ replace: () => {} }),
}))

// Sama seperti page.test.tsx, tiga anaknya dipalsukan -- tapi di sini mereka MENERUSKAN
// className/props tata letak yang diberikan halaman, karena itulah yang sedang diuji.
vi.mock('@/components/inbox/ConversationList', () => ({
  ConversationList: ({ className }: { className?: string }) => (
    <div data-testid="conversation-list" data-class={className ?? ''} />
  ),
}))

vi.mock('@/components/inbox/ThreadView', () => ({
  ThreadView: ({
    onBack,
    contactPanelOpen,
    onToggleContactPanel,
  }: {
    onBack?: () => void
    contactPanelOpen?: boolean
    onToggleContactPanel?: () => void
  }) => (
    <div data-testid="thread-view" data-panel-open={String(contactPanelOpen)}>
      <button onClick={onBack}>kembali</button>
      <button onClick={onToggleContactPanel}>toggle panel</button>
    </div>
  ),
}))

vi.mock('@/components/inbox/ContactPanel', () => ({
  ContactPanel: ({ className }: { className?: string }) => (
    <div data-testid="contact-panel" data-class={className ?? ''} />
  ),
}))

afterEach(() => {
  cleanup()
})

function shell(container: HTMLElement): HTMLElement {
  return container.firstElementChild as HTMLElement
}

describe('/inbox — cangkang tiga kolom', () => {
  it('setinggi kontainernya, bukan setinggi viewport — jadi hanya kolomnya yang menggulung', () => {
    mockSearchParams = new URLSearchParams('conversation=conv_1')
    const { container } = render(<InboxPage />)

    const root = shell(container)
    expect(root).toHaveClass('h-full')
    // h-screen/min-h-screen di sini akan mengabaikan rail navigasi dan membuat dokumen lebih
    // tinggi dari layar; overflow-hidden memastikan grid tidak pernah menggulung sebagai satu blok.
    expect(root.className).not.toMatch(/(^|\s)h-screen(\s|$)/)
    expect(root.className).not.toMatch(/min-h-screen/)
    expect(root).toHaveClass('overflow-hidden')
  })

  it('memakukan tinggi barisnya ke minmax(0,1fr) supaya isi yang panjang tidak menumbuhkan grid', () => {
    mockSearchParams = new URLSearchParams('conversation=conv_1')
    const { container } = render(<InboxPage />)

    expect(shell(container)).toHaveClass('grid-rows-[minmax(0,1fr)]')
  })

  it('kolom tengah memakai minmax(0,1fr), bukan 1fr, supaya satu untai panjang tidak melebarkan grid', () => {
    mockSearchParams = new URLSearchParams('conversation=conv_1')
    const { container } = render(<InboxPage />)

    expect(shell(container).className).toContain('md:grid-cols-[20rem_minmax(0,1fr)]')
  })

  it('menyembunyikan daftar percakapan di layar sempit begitu sebuah percakapan dibuka', () => {
    mockSearchParams = new URLSearchParams('conversation=conv_1')
    render(<InboxPage />)

    expect(screen.getByTestId('conversation-list')).toHaveAttribute('data-class', 'max-md:hidden')
  })

  it('membiarkan daftar percakapan mengisi layar sempit selama belum ada yang dipilih', () => {
    mockSearchParams = new URLSearchParams()
    render(<InboxPage />)

    expect(screen.getByTestId('conversation-list')).toHaveAttribute('data-class', '')
  })

  it('memberi panel kontak kolom hanya dari xl ke atas', () => {
    mockSearchParams = new URLSearchParams('conversation=conv_1')
    render(<InboxPage />)

    expect(screen.getByTestId('contact-panel')).toHaveAttribute('data-class', 'hidden xl:flex')
  })

  it('menambah kolom ketiga ke grid hanya saat ada percakapan terbuka DAN panelnya terbuka', () => {
    mockSearchParams = new URLSearchParams('conversation=conv_1')
    const { container } = render(<InboxPage />)

    expect(shell(container).className).toContain('xl:grid-cols-[20rem_minmax(0,1fr)_18.75rem]')

    fireEvent.click(screen.getByText('toggle panel'))

    // Panel ditutup -> grid kembali dua kolom dan thread melebar, bukan menyisakan lubang 300px.
    expect(shell(container).className).not.toContain('xl:grid-cols-[20rem_minmax(0,1fr)_18.75rem]')
    expect(screen.getByTestId('contact-panel')).toHaveAttribute('data-class', 'hidden')
    expect(screen.getByTestId('thread-view')).toHaveAttribute('data-panel-open', 'false')
  })

  it('tidak pernah menyusun tiga kolom saat belum ada percakapan yang dipilih', () => {
    mockSearchParams = new URLSearchParams()
    const { container } = render(<InboxPage />)

    expect(shell(container).className).not.toContain('18.75rem')
  })

  it('mengembalikan operator ke daftar lewat tombol kembali milik thread', () => {
    mockSearchParams = new URLSearchParams('conversation=conv_1')
    render(<InboxPage />)

    fireEvent.click(screen.getByText('kembali'))

    expect(screen.queryByTestId('thread-view')).not.toBeInTheDocument()
    expect(screen.getByTestId('conversation-list')).toHaveAttribute('data-class', '')
  })

  it('menjelaskan keadaan kosongnya, bukan sekadar menuliskan satu kalimat abu-abu', () => {
    mockSearchParams = new URLSearchParams()
    render(<InboxPage />)

    expect(screen.getByText('Pilih percakapan')).toBeInTheDocument()
    expect(screen.getByText(/Buka satu percakapan di daftar kiri/)).toBeInTheDocument()
  })
})
