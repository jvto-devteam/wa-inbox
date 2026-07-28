import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConversationListItem } from './ConversationListItem'

const summary = {
  id: 'conv_1', contactName: 'Bruno Figarola', contactPhone: '6281234567890', avatarUrl: null,
  lastMessage: 'Halo!', lastMessageSentBy: 'CUSTOMER', lastMessageAt: new Date().toISOString(),
  botEnabled: true, status: 'OPEN', orderChannel: null, unreadCount: 0, labels: [{ id: 'lbl_1', name: 'Confirmed Booking', color: '#3C6B42' }],
}

describe('ConversationListItem', () => {
  it('shows contact name, last message, and labels', () => {
    render(<ConversationListItem conversation={summary} onClick={() => {}} />)
    expect(screen.getByText('Bruno Figarola')).toBeInTheDocument()
    expect(screen.getByText('Halo!')).toBeInTheDocument()
    expect(screen.getByText('Confirmed Booking')).toBeInTheDocument()
  })

  it('shows a clear handoff placeholder instead of a blank preview for a logged handoff decision', () => {
    // Task 34 logs a handoff decision as a Message row with content: null, sentBy: 'BOT'. Without
    // a placeholder, the sidebar preview line would render blank instead of signaling a handoff.
    render(
      <ConversationListItem
        conversation={{ ...summary, lastMessage: null, lastMessageSentBy: 'BOT' }}
        onClick={() => {}}
      />
    )
    expect(screen.getByText('Bot menyerahkan ke agen — lihat alasan')).toBeInTheDocument()
  })

  it('shows an unread badge and bolds the row when unreadCount is greater than zero', () => {
    render(<ConversationListItem conversation={{ ...summary, unreadCount: 3 }} onClick={() => {}} />)
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByLabelText('3 pesan belum dibaca')).toBeInTheDocument()
  })

  it('shows no unread badge when unreadCount is zero', () => {
    render(<ConversationListItem conversation={summary} onClick={() => {}} />)
    expect(screen.queryByLabelText(/pesan belum dibaca/)).not.toBeInTheDocument()
  })

  it('shows the order channel badge when a booking exists', () => {
    render(<ConversationListItem conversation={{ ...summary, orderChannel: 'KLOOK' }} onClick={() => {}} />)
    expect(screen.getByText('KLOOK')).toBeInTheDocument()
  })

  it('shows no order channel badge at all when there is no booking yet', () => {
    render(<ConversationListItem conversation={summary} onClick={() => {}} />)
    expect(screen.queryByText('KLOOK')).not.toBeInTheDocument()
    expect(screen.queryByText('JVTO')).not.toBeInTheDocument()
  })

  it('shows the real avatar photo when avatarUrl is set, instead of the initial fallback', () => {
    render(<ConversationListItem conversation={{ ...summary, avatarUrl: 'https://x.test/photo.jpg' }} onClick={() => {}} />)
    expect(screen.getByAltText('Bruno Figarola')).toBeInTheDocument()
    expect(screen.queryByText('B')).not.toBeInTheDocument()
  })

  it('shows an initial-letter avatar when there is no avatarUrl', () => {
    render(<ConversationListItem conversation={summary} onClick={() => {}} />)
    expect(screen.getByText('B')).toBeInTheDocument()
  })
})
