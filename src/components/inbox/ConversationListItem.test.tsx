import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConversationListItem } from './ConversationListItem'

const summary = {
  id: 'conv_1', contactName: 'Bruno Figarola', contactPhone: '6281234567890',
  lastMessage: 'Halo!', lastMessageSentBy: 'CUSTOMER', lastMessageAt: new Date().toISOString(),
  botEnabled: true, status: 'OPEN', unreadCount: 0, labels: [{ id: 'lbl_1', name: 'Confirmed Booking', color: '#3C6B42' }],
}

describe('ConversationListItem', () => {
  it('shows contact name, last message, and Bot badge', () => {
    render(<ConversationListItem conversation={summary} onClick={() => {}} />)
    expect(screen.getByText('Bruno Figarola')).toBeInTheDocument()
    expect(screen.getByText('Halo!')).toBeInTheDocument()
    expect(screen.getByText('Bot')).toBeInTheDocument()
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

  it('shows Agen instead of Bot when the global kill switch is on, even if botEnabled is true', () => {
    // botEnabled reflects this conversation's own toggle, not whether a reply can actually
    // happen right now -- the kill switch overrides it company-wide.
    render(<ConversationListItem conversation={summary} killSwitchOn onClick={() => {}} />)
    expect(screen.queryByText('Bot')).not.toBeInTheDocument()
    expect(screen.getByText('Agen')).toBeInTheDocument()
  })

  it('still shows Bot when botEnabled is true and the kill switch is off', () => {
    render(<ConversationListItem conversation={summary} killSwitchOn={false} onClick={() => {}} />)
    expect(screen.getByText('Bot')).toBeInTheDocument()
  })
})
