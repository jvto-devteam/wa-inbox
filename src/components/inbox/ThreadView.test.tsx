import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { ThreadView } from './ThreadView'

// Mirrors how `src/app/inbox/page.tsx` renders `ThreadView`: keyed by
// `conversationId` so switching conversations fully remounts the component
// (resetting its `messages`/`botEnabled` state) instead of requiring a
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

// ThreadView fires two distinct GET requests per conversation:
//   /api/conversations/:id/messages  -> Message[]
//   /api/conversations/:id           -> { botEnabled: boolean }
// A mock that only branches on "does the URL contain the conversation id"
// (without also checking the `/messages` suffix) would answer the detail
// request with the messages array, silently resolving `data.botEnabled` to
// `undefined` — the test would then pass without ever exercising the real
// botEnabled-sourcing behavior. This helper routes each endpoint separately
// so the two calls can be asserted independently.
function routeFetchByEndpoint(routes: {
  messages: Record<string, unknown>
  detail: Record<string, { botEnabled: boolean }>
}) {
  return (url: RequestInfo | URL) => {
    const s = String(url)
    if (s.endsWith('/messages')) {
      const id = s.split('/').at(-2)!
      return Promise.resolve({ json: () => Promise.resolve(routes.messages[id] ?? []) } as Response)
    }
    const id = s.split('/').at(-1)!
    return Promise.resolve({ json: () => Promise.resolve(routes.detail[id]) } as Response)
  }
}

describe('ThreadView keyed by conversationId', () => {
  it('does not show the previous conversation messages after switching, even before the new fetch resolves', async () => {
    let resolveConv2Messages: (value: unknown) => void = () => {}
    const conv2MessagesPending = new Promise((resolve) => {
      resolveConv2Messages = resolve
    })

    vi.mocked(fetch).mockImplementation((url) => {
      const s = String(url)
      if (s.endsWith('/messages')) {
        if (s.includes('conv_1')) return Promise.resolve({ json: () => Promise.resolve(conv1Messages) } as Response)
        return conv2MessagesPending.then((data) => ({ json: () => Promise.resolve(data) }) as Response)
      }
      // conversation-detail requests: resolve immediately, irrelevant to this test
      return Promise.resolve({ json: () => Promise.resolve({ botEnabled: false }) } as Response)
    })

    render(<Harness />)

    await waitFor(() => expect(screen.getByText('Hello from conv1')).toBeInTheDocument())

    fireEvent.click(screen.getByText('switch'))

    // The conv_2 fetch has not resolved yet, but the remount (via the
    // changed `key`) must already have cleared conv_1's messages.
    expect(screen.queryByText('Hello from conv1')).not.toBeInTheDocument()

    resolveConv2Messages([])
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('conv_2')))
  })

  it("does not carry over the previous conversation's botEnabled value after switching (true -> false)", async () => {
    vi.mocked(fetch).mockImplementation(
      routeFetchByEndpoint({
        messages: { conv_1: [], conv_2: [] },
        detail: { conv_1: { botEnabled: true }, conv_2: { botEnabled: false } },
      })
    )

    render(<Harness />)

    // conv_1 has the bot on: the "Ambil Alih dari Bot" takeover button shows.
    await waitFor(() => expect(screen.getByText('Ambil Alih dari Bot')).toBeInTheDocument())

    fireEvent.click(screen.getByText('switch'))

    // conv_2 has the bot off. If ThreadView carried over conv_1's `true`
    // instead of resetting on remount and re-fetching conv_2's own value,
    // the button would incorrectly remain visible.
    await waitFor(() => expect(screen.queryByText('Ambil Alih dari Bot')).not.toBeInTheDocument())
  })

  it("does not carry over the previous conversation's botEnabled value after switching (false -> true)", async () => {
    vi.mocked(fetch).mockImplementation(
      routeFetchByEndpoint({
        messages: { conv_1: [], conv_2: [] },
        detail: { conv_1: { botEnabled: false }, conv_2: { botEnabled: true } },
      })
    )

    render(<Harness />)

    // conv_1 has the bot off: no takeover button, and the remount default (false) agrees.
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('conv_1')))
    expect(screen.queryByText('Ambil Alih dari Bot')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('switch'))

    // conv_2 has the bot on — the button must appear once conv_2's own
    // detail fetch resolves, proving the value is freshly sourced per
    // conversation rather than stuck at whatever conv_1 had (or the default).
    await waitFor(() => expect(screen.getByText('Ambil Alih dari Bot')).toBeInTheDocument())
  })
})
