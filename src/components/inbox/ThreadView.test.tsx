import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
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
  static instances: FakeEventSource[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  close = vi.fn()
  constructor() {
    FakeEventSource.instances.push(this)
  }
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent)
  }
}

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('fetch', vi.fn())
  vi.stubGlobal('EventSource', FakeEventSource)
})

// ThreadView fires three distinct GET requests per conversation:
//   /api/conversations/:id/messages  -> Message[]
//   /api/conversations/:id           -> { botEnabled: boolean }
//   /api/accounts                    -> Agent[] (not conversation-specific)
// A mock that only branches on "does the URL contain the conversation id"
// (without also checking the `/messages` suffix) would answer the detail
// request with the messages array, silently resolving `data.botEnabled` to
// `undefined` — the test would then pass without ever exercising the real
// botEnabled-sourcing behavior. This helper routes each endpoint separately
// so the calls can be asserted independently.
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
    if (s.endsWith('/api/accounts')) {
      return Promise.resolve({ json: () => Promise.resolve([]) } as Response)
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
      if (s.endsWith('/api/accounts')) {
        return Promise.resolve({ json: () => Promise.resolve([]) } as Response)
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

describe('ThreadView live delivery-status updates', () => {
  function mockBasicFetch(messages: unknown[]) {
    vi.mocked(fetch).mockImplementation((url) => {
      const s = String(url)
      if (s.endsWith('/messages')) return Promise.resolve({ json: () => Promise.resolve(messages) } as Response)
      if (s.endsWith('/api/accounts')) return Promise.resolve({ json: () => Promise.resolve([]) } as Response)
      return Promise.resolve({ json: () => Promise.resolve({ botEnabled: false, assignedAgentId: null }) } as Response)
    })
  }

  const outboundMessage = {
    id: 'm1',
    direction: 'OUTBOUND',
    content: 'Penawaran paket Ijen',
    channel: 'OFFICIAL',
    sentBy: 'AGENT',
    deliveryStatus: 'SENT',
    createdAt: new Date().toISOString(),
    botTrace: null,
  }

  it('replaces an existing bubble in place on a message.updated event', async () => {
    // Meta's delivery receipt arrives long after the message was sent. Appending it as a
    // new message would duplicate the bubble; the status badge must just change.
    mockBasicFetch([outboundMessage])

    render(<ThreadView conversationId="conv_1" />)

    await waitFor(() => expect(screen.getByText('SENT')).toBeInTheDocument())

    const es = FakeEventSource.instances[0]
    act(() => {
      es.emit({
        type: 'message.updated',
        conversationId: 'conv_1',
        message: { ...outboundMessage, deliveryStatus: 'FAILED' },
      })
    })

    await waitFor(() => expect(screen.getByText('FAILED')).toBeInTheDocument())
    expect(screen.queryByText('SENT')).not.toBeInTheDocument()
    expect(screen.getAllByText('Penawaran paket Ijen')).toHaveLength(1)
  })

  it('ignores a message.updated event for a different conversation', async () => {
    mockBasicFetch([outboundMessage])

    render(<ThreadView conversationId="conv_1" />)

    await waitFor(() => expect(screen.getByText('SENT')).toBeInTheDocument())

    const es = FakeEventSource.instances[0]
    act(() => {
      es.emit({
        type: 'message.updated',
        conversationId: 'conv_other',
        message: { ...outboundMessage, deliveryStatus: 'FAILED' },
      })
    })

    await waitFor(() => expect(screen.getByText('SENT')).toBeInTheDocument())
  })
})

describe('ThreadView assign-agent dropdown', () => {
  const agents = [
    { id: 'acc_1', name: 'Rina' },
    { id: 'acc_2', name: 'Budi' },
  ]

  // Routes GET messages/detail/accounts plus PATCH assign, recording PATCH
  // request bodies so tests can assert exactly what was sent.
  function mockFetchWithAssign(opts: { assignedAgentId: string | null; patchResponse?: { assignedAgentId: string | null } }) {
    const patchCalls: unknown[] = []
    vi.mocked(fetch).mockImplementation((url, init) => {
      const s = String(url)
      if (s.endsWith('/messages')) return Promise.resolve({ json: () => Promise.resolve([]) } as Response)
      if (s.endsWith('/api/accounts')) return Promise.resolve({ json: () => Promise.resolve(agents) } as Response)
      if (s.endsWith('/assign') && init?.method === 'PATCH') {
        patchCalls.push(JSON.parse(String(init.body)))
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(opts.patchResponse ?? { assignedAgentId: null }),
        } as Response)
      }
      return Promise.resolve({ json: () => Promise.resolve({ botEnabled: false, assignedAgentId: opts.assignedAgentId }) } as Response)
    })
    return patchCalls
  }

  it('populates the dropdown from GET /api/accounts and selects the conversation\'s assigned agent', async () => {
    mockFetchWithAssign({ assignedAgentId: 'acc_2' })

    render(<ThreadView conversationId="conv_1" />)

    const select = (await screen.findByLabelText('Ditugaskan ke')) as HTMLSelectElement
    await waitFor(() => expect(screen.getByText('Budi')).toBeInTheDocument())
    await waitFor(() => expect(select.value).toBe('acc_2'))
  })

  it('shows "Belum ditugaskan" selected when the conversation has no assigned agent', async () => {
    mockFetchWithAssign({ assignedAgentId: null })

    render(<ThreadView conversationId="conv_1" />)

    const select = (await screen.findByLabelText('Ditugaskan ke')) as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe(''))
  })

  it('PATCHes agentId on selection and updates the dropdown only after the server confirms', async () => {
    let resolvePatch: (() => void) | undefined
    const patchPending = new Promise<void>((resolve) => {
      resolvePatch = resolve
    })
    const patchCalls: unknown[] = []
    vi.mocked(fetch).mockImplementation((url, init) => {
      const s = String(url)
      if (s.endsWith('/messages')) return Promise.resolve({ json: () => Promise.resolve([]) } as Response)
      if (s.endsWith('/api/accounts')) return Promise.resolve({ json: () => Promise.resolve(agents) } as Response)
      if (s.endsWith('/assign') && init?.method === 'PATCH') {
        patchCalls.push(JSON.parse(String(init.body)))
        return patchPending.then(() => ({ ok: true, json: () => Promise.resolve({ assignedAgentId: 'acc_1' }) }) as Response)
      }
      return Promise.resolve({ json: () => Promise.resolve({ botEnabled: false, assignedAgentId: null }) } as Response)
    })

    render(<ThreadView conversationId="conv_1" />)

    const select = (await screen.findByLabelText('Ditugaskan ke')) as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe(''))

    fireEvent.change(select, { target: { value: 'acc_1' } })

    // Request fired, but the server hasn't responded yet — no optimistic
    // update, so the dropdown must still reflect the old (unassigned) value.
    await waitFor(() => expect(patchCalls).toEqual([{ agentId: 'acc_1' }]))
    expect(select.value).toBe('')

    resolvePatch?.()
    await waitFor(() => expect(select.value).toBe('acc_1'))
  })

  it('PATCHes agentId: null when "Belum ditugaskan" is selected to unassign', async () => {
    const patchCalls = mockFetchWithAssign({ assignedAgentId: 'acc_1', patchResponse: { assignedAgentId: null } })

    render(<ThreadView conversationId="conv_1" />)

    const select = (await screen.findByLabelText('Ditugaskan ke')) as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('acc_1'))

    fireEvent.change(select, { target: { value: '' } })

    await waitFor(() => expect(patchCalls).toEqual([{ agentId: null }]))
    await waitFor(() => expect(select.value).toBe(''))
  })

  it('shows an error and leaves the dropdown unchanged when the PATCH request fails', async () => {
    vi.mocked(fetch).mockImplementation((url, init) => {
      const s = String(url)
      if (s.endsWith('/messages')) return Promise.resolve({ json: () => Promise.resolve([]) } as Response)
      if (s.endsWith('/api/accounts')) return Promise.resolve({ json: () => Promise.resolve(agents) } as Response)
      if (s.endsWith('/assign') && init?.method === 'PATCH') {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'nope' }) } as Response)
      }
      return Promise.resolve({ json: () => Promise.resolve({ botEnabled: false, assignedAgentId: null }) } as Response)
    })

    render(<ThreadView conversationId="conv_1" />)

    const select = (await screen.findByLabelText('Ditugaskan ke')) as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe(''))

    fireEvent.change(select, { target: { value: 'acc_1' } })

    await waitFor(() => expect(screen.getByText('Gagal mengubah penugasan agen')).toBeInTheDocument())
    expect(select.value).toBe('')
  })
})
