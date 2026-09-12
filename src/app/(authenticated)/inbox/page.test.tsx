import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import InboxPage from './page'

let mockSearchParams: URLSearchParams
const replace = vi.fn()

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace }),
}))

// InboxPage is a pure container: it wires selectedId through to ConversationList,
// ThreadView, and ContactPanel. Mocking those three (rather than letting them mount for
// real) keeps this test focused on InboxPage's own job -- reading the `conversation`
// query param and turning it into the right selectedId -- without having to also stand
// up every fetch/EventSource call ThreadView, ContactPanel, and their children make.
vi.mock('@/components/inbox/ConversationList', () => ({
  ConversationList: ({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) => (
    <div data-testid="conversation-list" data-selected-id={selectedId ?? ''}>
      <button onClick={() => onSelect('conv_clicked')}>select conv_clicked</button>
    </div>
  ),
}))

vi.mock('@/components/inbox/ThreadView', () => ({
  ThreadView: ({ conversationId, focusMessageId }: { conversationId: string; focusMessageId?: string }) => (
    <div data-testid="thread-view" data-focus-message-id={focusMessageId ?? ''}>
      {conversationId}
    </div>
  ),
}))

vi.mock('@/components/inbox/ContactPanel', () => ({
  ContactPanel: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="contact-panel">{conversationId}</div>
  ),
}))

afterEach(() => {
  cleanup()
  replace.mockClear()
})

describe('InboxPage deep link via ?conversation=', () => {
  it('mounts ThreadView and ContactPanel for the conversation id given in the query param, on mount', () => {
    mockSearchParams = new URLSearchParams('conversation=conv_1')

    render(<InboxPage />)

    expect(screen.getByTestId('thread-view')).toHaveTextContent('conv_1')
    expect(screen.getByTestId('contact-panel')).toHaveTextContent('conv_1')
    expect(screen.getByTestId('conversation-list')).toHaveAttribute('data-selected-id', 'conv_1')
  })

  it('shows the "pilih percakapan" placeholder, with no ThreadView/ContactPanel, when there is no query param', () => {
    mockSearchParams = new URLSearchParams()

    render(<InboxPage />)

    expect(screen.getByText('Pilih percakapan')).toBeInTheDocument()
    expect(screen.queryByTestId('thread-view')).not.toBeInTheDocument()
    expect(screen.queryByTestId('contact-panel')).not.toBeInTheDocument()
  })

  it('still lets the user pick a different conversation manually afterward, overriding the deep-linked one', () => {
    mockSearchParams = new URLSearchParams('conversation=conv_1')

    render(<InboxPage />)
    fireEvent.click(screen.getByText('select conv_clicked'))

    expect(screen.getByTestId('thread-view')).toHaveTextContent('conv_clicked')
  })
})

describe('InboxPage deep link via ?message=', () => {
  it('meneruskan pesan yang diminta ke ThreadView', () => {
    mockSearchParams = new URLSearchParams('conversation=conv_1&message=msg_bot')

    render(<InboxPage />)

    expect(screen.getByTestId('thread-view')).toHaveAttribute('data-focus-message-id', 'msg_bot')
  })

  it('tanpa ?message= tidak ada pesan yang disorot', () => {
    mockSearchParams = new URLSearchParams('conversation=conv_1')

    render(<InboxPage />)

    expect(screen.getByTestId('thread-view')).toHaveAttribute('data-focus-message-id', '')
  })

  it('melepas sorotan begitu operator berpindah percakapan', () => {
    mockSearchParams = new URLSearchParams('conversation=conv_1&message=msg_bot')

    render(<InboxPage />)
    fireEvent.click(screen.getByText('select conv_clicked'))

    expect(screen.getByTestId('thread-view')).toHaveTextContent('conv_clicked')
    expect(screen.getByTestId('thread-view')).toHaveAttribute('data-focus-message-id', '')
  })
})

// Lonceng gap duduk di SETIAP halaman, termasuk /inbox sendiri. Menekan salah satu isinya dari
// /inbox adalah navigasi ke rute yang sama dengan query berbeda: React mempertahankan komponen
// yang sudah terpasang, jadi inisialisasi `useState` TIDAK dijalankan ulang. Tanpa sinkronisasi,
// URL-nya berubah dan layarnya tidak -- persis "diklik, tidak terjadi apa-apa".
describe('InboxPage mengikuti tautan dalam-halaman', () => {
  it('membuka percakapan dan pesan baru saat query berubah tanpa remount', () => {
    mockSearchParams = new URLSearchParams()
    const { rerender } = render(<InboxPage />)
    expect(screen.queryByTestId('thread-view')).not.toBeInTheDocument()

    mockSearchParams = new URLSearchParams('conversation=conv_9&message=msg_9')
    rerender(<InboxPage />)

    expect(screen.getByTestId('thread-view')).toHaveTextContent('conv_9')
    expect(screen.getByTestId('thread-view')).toHaveAttribute('data-focus-message-id', 'msg_9')
  })

  it('berpindah dari satu gap ke gap lain di percakapan yang sama', () => {
    mockSearchParams = new URLSearchParams('conversation=conv_1&message=msg_a')
    const { rerender } = render(<InboxPage />)

    mockSearchParams = new URLSearchParams('conversation=conv_1&message=msg_b')
    rerender(<InboxPage />)

    expect(screen.getByTestId('thread-view')).toHaveAttribute('data-focus-message-id', 'msg_b')
  })

  // Alasan asli `useState` dibaca sekali: pilihan manual operator tidak boleh ditarik balik ke
  // nilai URL pada setiap render. Itu tetap berlaku -- yang memicu sinkronisasi adalah URL yang
  // BERUBAH, bukan URL yang ada.
  it('tidak menarik balik pilihan manual saat query tidak berubah', () => {
    mockSearchParams = new URLSearchParams('conversation=conv_1')
    const { rerender } = render(<InboxPage />)

    fireEvent.click(screen.getByText('select conv_clicked'))
    rerender(<InboxPage />)

    expect(screen.getByTestId('thread-view')).toHaveTextContent('conv_clicked')
  })

  // Tanpa ini, menekan gap yang SAMA setelah operator berpindah percakapan sendiri tidak akan
  // melakukan apa-apa: href-nya identik dengan URL yang masih tertinggal di bilah alamat, jadi
  // tidak ada navigasi dan tidak ada query yang berubah. Menulis pilihan manual ke URL membuat
  // "apa yang tertulis di URL" dan "apa yang terlihat di layar" tidak pernah berpisah.
  it('menulis pilihan manual ke URL, tanpa menambah entri riwayat', () => {
    mockSearchParams = new URLSearchParams('conversation=conv_1&message=msg_a')
    render(<InboxPage />)

    fireEvent.click(screen.getByText('select conv_clicked'))

    expect(replace).toHaveBeenCalledWith('/inbox?conversation=conv_clicked', { scroll: false })
  })
})
