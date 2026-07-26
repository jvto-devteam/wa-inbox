import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageBubble } from './MessageBubble'

describe('MessageBubble', () => {
  it('shows bot-sent messages with a Bot badge', () => {
    render(<MessageBubble message={{ id: 'm1', direction: 'OUTBOUND', content: 'Info paket Ijen...', channel: 'OFFICIAL', sentBy: 'BOT', deliveryStatus: 'SENT', createdAt: new Date().toISOString(), botTrace: { mode: 'faq' } }} />)
    expect(screen.getByText('Info paket Ijen...')).toBeInTheDocument()
    expect(screen.getByText('Bot')).toBeInTheDocument()
  })

  it('shows a retry button for failed messages', () => {
    render(<MessageBubble message={{ id: 'm2', direction: 'OUTBOUND', content: 'Halo', channel: 'OFFICIAL', sentBy: 'AGENT', deliveryStatus: 'FAILED', createdAt: new Date().toISOString(), botTrace: null }} />)
    expect(screen.getByRole('button', { name: /kirim ulang/i })).toBeInTheDocument()
  })
})
