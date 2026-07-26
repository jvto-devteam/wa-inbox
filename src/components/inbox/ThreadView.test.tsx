import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { ThreadView } from './ThreadView'

// Mirrors how `src/app/inbox/page.tsx` renders `ThreadView`: keyed by
// `conversationId` so switching conversations fully remounts the component
// (resetting its `messages` state to `[]`) instead of requiring a
// synchronous `setState` inside the fetch effect, which would trip the
// `react-hooks/set-state-in-effect` lint rule.
function Harness() {
  const [conversationId, setConversationId] = useState('conv_1')
  return (
    <div>
      <button onClick={() => setConversationId('conv_2')}>switch</button>
      <ThreadView key={conversationId} conversationId={conversationId} />
    </div>
  )
}

const conv1Messages = [
  {
    id: 'm1',
    direction: 'INBOUND',
    content: 'Hello from conv1',
    channel: 'OFFICIAL',
    sentBy: 'CUSTOMER',
    deliveryStatus: 'DELIVERED',
    createdAt: new Date().toISOString(),
    botTrace: null,
  },
]

// ThreadView also opens an EventSource for live updates; jsdom doesn't implement it, so
// stub a minimal no-op version (this component's SSE behavior itself is exercised
// separately, not by this test) just enough to satisfy `new EventSource(...)` and `.close()`.
class FakeEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null
  close = vi.fn()
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  vi.stubGlobal('EventSource', FakeEventSource)
})

describe('ThreadView keyed by conversationId', () => {
  it('does not show the previous conversation messages after switching, even before the new fetch resolves', async () => {
    let resolveConv2: (value: unknown) => void = () => {}
    const conv2Pending = new Promise((resolve) => {
      resolveConv2 = resolve
    })

    vi.mocked(fetch).mockImplementation((url) => {
      if (String(url).includes('conv_1')) {
        return Promise.resolve({ json: () => Promise.resolve(conv1Messages) } as Response)
      }
      return conv2Pending.then((data) => ({ json: () => Promise.resolve(data) }) as Response)
    })

    render(<Harness />)

    await waitFor(() => expect(screen.getByText('Hello from conv1')).toBeInTheDocument())

    fireEvent.click(screen.getByText('switch'))

    // The conv_2 fetch has not resolved yet, but the remount (via the
    // changed `key`) must already have cleared conv_1's messages.
    expect(screen.queryByText('Hello from conv1')).not.toBeInTheDocument()

    resolveConv2([])
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('conv_2')))
  })
})
