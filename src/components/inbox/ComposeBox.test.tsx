import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ComposeBox } from './ComposeBox'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

describe('ComposeBox — Ambil Alih dari Bot toggle', () => {
  it('renders the "Ambil Alih dari Bot" button when botEnabled is true', () => {
    render(
      <ComposeBox conversationId="conv_1" botEnabled={true} onSent={() => {}} onBotToggled={() => {}} />
    )

    expect(screen.getByText('Ambil Alih dari Bot')).toBeInTheDocument()
  })

  it('does not render the "Ambil Alih dari Bot" button when botEnabled is false', () => {
    render(
      <ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />
    )

    expect(screen.queryByText('Ambil Alih dari Bot')).not.toBeInTheDocument()
  })

  it('calls the toggle-bot endpoint and reports the new value on click', async () => {
    vi.mocked(fetch).mockResolvedValue({ json: () => Promise.resolve({ botEnabled: false }) } as Response)
    const onBotToggled = vi.fn()

    render(
      <ComposeBox conversationId="conv_1" botEnabled={true} onSent={() => {}} onBotToggled={onBotToggled} />
    )

    fireEvent.click(screen.getByText('Ambil Alih dari Bot'))

    expect(fetch).toHaveBeenCalledWith('/api/conversations/conv_1/toggle-bot', { method: 'POST' })
    await waitFor(() => expect(onBotToggled).toHaveBeenCalledWith(false))
  })
})
