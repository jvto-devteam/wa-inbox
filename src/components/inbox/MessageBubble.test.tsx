import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MessageBubble } from './MessageBubble'

describe('MessageBubble', () => {
  it('shows bot-sent messages with a Bot badge', () => {
    render(<MessageBubble message={{ id: 'm1', direction: 'OUTBOUND', content: 'Info paket Ijen...', channel: 'OFFICIAL', sentBy: 'BOT', deliveryStatus: 'SENT', createdAt: new Date().toISOString(), botTrace: { mode: 'faq', draft: 'Info paket Ijen...', sourceTopic: 'inclusions' } }} />)
    expect(screen.getByText('Info paket Ijen...')).toBeInTheDocument()
    expect(screen.getByText('Bot')).toBeInTheDocument()
  })

  it('shows a retry button for failed messages', () => {
    render(<MessageBubble message={{ id: 'm2', direction: 'OUTBOUND', content: 'Halo', channel: 'OFFICIAL', sentBy: 'AGENT', deliveryStatus: 'FAILED', createdAt: new Date().toISOString(), botTrace: null }} />)
    expect(screen.getByRole('button', { name: /kirim ulang/i })).toBeInTheDocument()
  })

  it('toggles the bot trace popover open and closed when clicking a bot message with a trace', () => {
    render(
      <MessageBubble
        message={{
          id: 'm3',
          direction: 'OUTBOUND',
          content: 'Info paket Ijen...',
          channel: 'OFFICIAL',
          sentBy: 'BOT',
          deliveryStatus: 'SENT',
          createdAt: new Date().toISOString(),
          botTrace: { mode: 'faq', draft: 'Info paket Ijen...', sourceTopic: 'inclusions' },
        }}
      />
    )
    expect(screen.queryByText(/sumber topik/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Info paket Ijen...'))
    expect(screen.getByText(/sumber topik/i)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Info paket Ijen...'))
    expect(screen.queryByText(/sumber topik/i)).not.toBeInTheDocument()
  })

  it('does not show a popover when clicking a bot message with no botTrace', () => {
    render(
      <MessageBubble
        message={{
          id: 'm4',
          direction: 'OUTBOUND',
          content: 'Halo dari bot',
          channel: 'OFFICIAL',
          sentBy: 'BOT',
          deliveryStatus: 'SENT',
          createdAt: new Date().toISOString(),
          botTrace: null,
        }}
      />
    )
    fireEvent.click(screen.getByText('Halo dari bot'))
    expect(screen.queryByText(/mode:/i)).not.toBeInTheDocument()
  })

  it('shows a clear handoff placeholder instead of a blank bubble for a logged handoff decision', () => {
    // Task 34 logs a handoff decision as a Message row with content: null, sentBy: 'BOT'. Without
    // a placeholder, the bubble would render empty, reading as a broken bot reply instead of a
    // silent handoff to a human agent.
    render(
      <MessageBubble
        message={{
          id: 'm6',
          direction: 'OUTBOUND',
          content: null,
          channel: 'OFFICIAL',
          sentBy: 'BOT',
          deliveryStatus: 'SENT',
          createdAt: new Date().toISOString(),
          botTrace: { mode: 'handoff', reason: 'Kata kunci eskalasi terdeteksi' },
        }}
      />
    )
    expect(screen.getByText('Bot menyerahkan ke agen — lihat alasan')).toBeInTheDocument()
  })

  it('does not show a popover when clicking a non-bot message', () => {
    render(
      <MessageBubble
        message={{
          id: 'm5',
          direction: 'OUTBOUND',
          content: 'Halo dari agen',
          channel: 'OFFICIAL',
          sentBy: 'AGENT',
          deliveryStatus: 'SENT',
          createdAt: new Date().toISOString(),
          botTrace: null,
        }}
      />
    )
    fireEvent.click(screen.getByText('Halo dari agen'))
    expect(screen.queryByText(/mode:/i)).not.toBeInTheDocument()
  })
})
