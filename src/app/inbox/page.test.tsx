import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import InboxPage from './page'

let mockSearchParams: URLSearchParams

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
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
  ThreadView: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="thread-view">{conversationId}</div>
  ),
}))

vi.mock('@/components/inbox/ContactPanel', () => ({
  ContactPanel: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="contact-panel">{conversationId}</div>
  ),
}))

afterEach(() => {
  cleanup()
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
