import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConversationListItem } from './ConversationListItem'

const summary = {
  id: 'conv_1', contactName: 'Bruno Figarola', contactPhone: '6281234567890',
  lastMessage: 'Halo!', lastMessageAt: new Date().toISOString(), unreadCount: 2,
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
})
