import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConversationListItem } from './ConversationListItem'

const summary = {
  id: 'conv_1', contactName: 'Bruno Figarola', contactPhone: '6281234567890',
  lastMessage: 'Halo!', lastMessageSentBy: 'CUSTOMER', lastMessageAt: new Date().toISOString(),
  botEnabled: true, status: 'OPEN', labels: [{ id: 'lbl_1', name: 'Confirmed Booking', color: '#3C6B42' }],
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
})
