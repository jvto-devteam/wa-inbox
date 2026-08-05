import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
      return Promise.resolve({ ok: true, json: () => Promise.resolve(routes.messages[id] ?? []) } as Response)
    }
    if (s.endsWith('/api/accounts')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
    }
    const id = s.split('/').at(-1)!
    return Promise.resolve({ ok: true, json: () => Promise.resolve(routes.detail[id]) } as Response)
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
        if (s.includes('conv_1')) return Promise.resolve({ ok: true, json: () => Promise.resolve(conv1Messages) } as Response)
        return conv2MessagesPending.then((data) => ({ ok: true, json: () => Promise.resolve(data) }) as Response)
      }
      if (s.endsWith('/api/accounts')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      }
      // conversation-detail requests: resolve immediately, irrelevant to this test
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ botEnabled: false }) } as Response)
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

describe('ThreadView header identity', () => {
  it("shows the contact's name and avatar photo in the header when available", async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      const s = String(url)
      if (s.endsWith('/messages')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      if (s.endsWith('/api/accounts')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ botEnabled: false, contactName: 'Bruno Figarola', avatarUrl: 'https://x.test/photo.jpg' }),
      } as Response)
    })

    render(<ThreadView conversationId="conv_1" />)

    expect(await screen.findByText('Bruno Figarola')).toBeInTheDocument()
    expect(screen.getByAltText('Bruno Figarola')).toBeInTheDocument()
  })

  it('falls back to an initial-letter avatar when the contact has no avatarUrl', async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      const s = String(url)
      if (s.endsWith('/messages')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      if (s.endsWith('/api/accounts')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ botEnabled: false, contactName: 'Bruno Figarola', avatarUrl: null }),
      } as Response)
    })

    render(<ThreadView conversationId="conv_1" />)

    await screen.findByText('Bruno Figarola')
    expect(screen.getByText('B')).toBeInTheDocument()
  })

  it('shows the "Room Tes" badge and hides ComposeBox\'s channel selector when isTest is true', async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      const s = String(url)
      if (s.endsWith('/messages')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      if (s.endsWith('/api/accounts')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ botEnabled: true, isTest: true, contactName: '🧪 Tes Bot (Internal)' }),
      } as Response)
    })

    render(<ThreadView conversationId="conv_test" />)

    expect(await screen.findByText(/Room Tes/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Channel')).not.toBeInTheDocument()
  })
})

describe('ThreadView clear-chat button', () => {
  function mockTestRoomFetch(messages: unknown[] = []) {
    vi.mocked(fetch).mockImplementation((url) => {
      const s = String(url)
      if (s.endsWith('/messages')) return Promise.resolve({ ok: true, json: () => Promise.resolve(messages) } as Response)
      if (s.endsWith('/api/accounts')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      if (s.endsWith('/clear')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) } as Response)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ botEnabled: true, isTest: true }) } as Response)
    })
  }

  it('shows "Hapus Chat" only when isTest is true', async () => {
    mockTestRoomFetch()
    render(<ThreadView conversationId="conv_test" />)
    expect(await screen.findByRole('button', { name: 'Hapus Chat' })).toBeInTheDocument()
  })

  it('does not show "Hapus Chat" for a normal (non-test) conversation', async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      const s = String(url)
      if (s.endsWith('/messages')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      if (s.endsWith('/api/accounts')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ botEnabled: true, isTest: false }) } as Response)
    })
    render(<ThreadView conversationId="conv_1" />)
    await screen.findByText('Tanpa nama')
    expect(screen.queryByRole('button', { name: 'Hapus Chat' })).not.toBeInTheDocument()
  })

  it('asks for confirmation, then POSTs to /clear and empties the message list on confirm', async () => {
    mockTestRoomFetch(conv1Messages)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ThreadView conversationId="conv_test" />)

    expect(await screen.findByText('Hello from conv1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hapus Chat' }))

    expect(confirmSpy).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('Hello from conv1')).not.toBeInTheDocument())
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/conversations/conv_test/clear', { method: 'POST' })
  })

  it('does nothing when the confirmation dialog is declined', async () => {
    mockTestRoomFetch(conv1Messages)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<ThreadView conversationId="conv_test" />)

    expect(await screen.findByText('Hello from conv1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hapus Chat' }))

    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith('/api/conversations/conv_test/clear', { method: 'POST' })
    expect(screen.getByText('Hello from conv1')).toBeInTheDocument()
  })

  it('empties the message list on a conversation.cleared SSE event (e.g. cleared from another tab)', async () => {
    mockTestRoomFetch(conv1Messages)
    render(<ThreadView conversationId="conv_test" />)

    expect(await screen.findByText('Hello from conv1')).toBeInTheDocument()
    const es = FakeEventSource.instances[0]
    act(() => {
      es.emit({ type: 'conversation.cleared', conversationId: 'conv_test' })
    })

    await waitFor(() => expect(screen.queryByText('Hello from conv1')).not.toBeInTheDocument())
  })

  it('ignores a conversation.cleared event for a different conversation', async () => {
    mockTestRoomFetch(conv1Messages)
    render(<ThreadView conversationId="conv_test" />)

    expect(await screen.findByText('Hello from conv1')).toBeInTheDocument()
    const es = FakeEventSource.instances[0]
    act(() => {
      es.emit({ type: 'conversation.cleared', conversationId: 'conv_other' })
    })

    expect(screen.getByText('Hello from conv1')).toBeInTheDocument()
  })
})

describe('ThreadView live delivery-status updates', () => {
  function mockBasicFetch(messages: unknown[]) {
    vi.mocked(fetch).mockImplementation((url) => {
      const s = String(url)
      if (s.endsWith('/messages')) return Promise.resolve({ ok: true, json: () => Promise.resolve(messages) } as Response)
      if (s.endsWith('/api/accounts')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ botEnabled: false, assignedAgentId: null }) } as Response)
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

    await waitFor(() => expect(screen.getByRole('img', { name: 'Terkirim' })).toBeInTheDocument())

    const es = FakeEventSource.instances[0]
    act(() => {
      es.emit({
        type: 'message.updated',
        conversationId: 'conv_1',
        message: { ...outboundMessage, deliveryStatus: 'FAILED' },
      })
    })

    await waitFor(() => expect(screen.getByText('FAILED')).toBeInTheDocument())
    expect(screen.queryByRole('img', { name: 'Terkirim' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Penawaran paket Ijen')).toHaveLength(1)
  })

  it('ignores a message.updated event for a different conversation', async () => {
    mockBasicFetch([outboundMessage])

    render(<ThreadView conversationId="conv_1" />)

    await waitFor(() => expect(screen.getByRole('img', { name: 'Terkirim' })).toBeInTheDocument())

    const es = FakeEventSource.instances[0]
    act(() => {
      es.emit({
        type: 'message.updated',
        conversationId: 'conv_other',
        message: { ...outboundMessage, deliveryStatus: 'FAILED' },
      })
    })

    await waitFor(() => expect(screen.getByRole('img', { name: 'Terkirim' })).toBeInTheDocument())
  })
})

describe('ThreadView live handoff sync', () => {
  function mockFetchWithBotEnabled() {
    vi.mocked(fetch).mockImplementation((url) => {
      const s = String(url)
      if (s.endsWith('/messages')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      if (s.endsWith('/api/accounts')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      // Agent manually re-activated the bot for this one chat (botEnabled: true), the scenario
      // where a stale "Ambil Alih dari Bot" button reads exactly backwards after a handoff.
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ botEnabled: true, assignedAgentId: null }) } as Response)
    })
  }

  it('flips botEnabled to false the moment a handoff.alert arrives, without a page reload', async () => {
    mockFetchWithBotEnabled()

    render(<ThreadView conversationId="conv_1" />)

    expect(await screen.findByText('Ambil Alih dari Bot')).toBeInTheDocument()

    const es = FakeEventSource.instances[0]
    act(() => {
      es.emit({ type: 'handoff.alert', conversationId: 'conv_1', contactName: 'David Setya' })
    })

    await waitFor(() => expect(screen.getByText('Aktifkan Bot untuk Chat Ini')).toBeInTheDocument())
    expect(screen.queryByText('Ambil Alih dari Bot')).not.toBeInTheDocument()
  })

  it('ignores a handoff.alert event for a different conversation', async () => {
    mockFetchWithBotEnabled()

    render(<ThreadView conversationId="conv_1" />)

    expect(await screen.findByText('Ambil Alih dari Bot')).toBeInTheDocument()

    const es = FakeEventSource.instances[0]
    act(() => {
      es.emit({ type: 'handoff.alert', conversationId: 'conv_other', contactName: 'Someone Else' })
    })

    await waitFor(() => expect(screen.getByText('Ambil Alih dari Bot')).toBeInTheDocument())
  })
})

describe('ThreadView read tracking', () => {
  function mockFetchWithDetail(messages: unknown[], detail: { lastReadAt: string | null }) {
    return vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const s = String(url)
      if (s.endsWith('/messages')) return Promise.resolve({ ok: true, json: () => Promise.resolve(messages) } as Response)
      if (s.endsWith('/api/accounts')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      if (s.endsWith('/read') && init?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ lastReadAt: new Date().toISOString() }) } as Response)
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ botEnabled: false, assignedAgentId: null, ...detail }) } as Response)
    })
  }

  it('marks the conversation as read on mount', async () => {
    const fetchMock = mockFetchWithDetail([], { lastReadAt: null })
    vi.stubGlobal('fetch', fetchMock)

    render(<ThreadView conversationId="conv_1" />)

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/conversations/conv_1/read', expect.objectContaining({ method: 'PATCH' }))
    )
  })

  it('marks the conversation as read again when a new message arrives while the thread is open', async () => {
    const fetchMock = mockFetchWithDetail([], { lastReadAt: null })
    vi.stubGlobal('fetch', fetchMock)

    render(<ThreadView conversationId="conv_1" />)
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/conversations/conv_1/read', expect.objectContaining({ method: 'PATCH' }))
    )
    fetchMock.mockClear()

    const es = FakeEventSource.instances[0]
    act(() => {
      es.emit({
        type: 'message.created',
        conversationId: 'conv_1',
        message: { id: 'm_new', direction: 'INBOUND', content: 'Halo lagi', channel: 'OFFICIAL', sentBy: 'CUSTOMER', deliveryStatus: 'DELIVERED', createdAt: new Date().toISOString(), botTrace: null },
      })
    })

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/conversations/conv_1/read', expect.objectContaining({ method: 'PATCH' }))
    )
  })

  it('shows an unread divider above the first inbound message received after lastReadAt', async () => {
    const messages = [
      { id: 'm1', direction: 'INBOUND', content: 'Pesan lama', channel: 'OFFICIAL', sentBy: 'CUSTOMER', deliveryStatus: 'DELIVERED', createdAt: '2026-07-20T09:00:00.000Z', botTrace: null },
      { id: 'm2', direction: 'INBOUND', content: 'Pesan baru', channel: 'OFFICIAL', sentBy: 'CUSTOMER', deliveryStatus: 'DELIVERED', createdAt: '2026-07-20T11:00:00.000Z', botTrace: null },
    ]
    vi.stubGlobal('fetch', mockFetchWithDetail(messages, { lastReadAt: '2026-07-20T10:00:00.000Z' }))

    render(<ThreadView conversationId="conv_1" />)

    await waitFor(() => expect(screen.getByText('Pesan baru')).toBeInTheDocument())
    expect(screen.getByText('Pesan belum dibaca')).toBeInTheDocument()

    // The divider sits between the already-read message and the first unread one, not
    // above the whole thread.
    const container = screen.getByText('Pesan lama').closest('.space-y-3')!
    const order = [...container.querySelectorAll('div')].map((el) => el.textContent).join('|')
    const oldIndex = order.indexOf('Pesan lama')
    const dividerIndex = order.indexOf('Pesan belum dibaca')
    const newIndex = order.indexOf('Pesan baru')
    expect(oldIndex).toBeLessThan(dividerIndex)
    expect(dividerIndex).toBeLessThan(newIndex)
  })

  it('shows no unread divider when the conversation has never been read before', async () => {
    const messages = [
      { id: 'm1', direction: 'INBOUND', content: 'Halo', channel: 'OFFICIAL', sentBy: 'CUSTOMER', deliveryStatus: 'DELIVERED', createdAt: new Date().toISOString(), botTrace: null },
    ]
    vi.stubGlobal('fetch', mockFetchWithDetail(messages, { lastReadAt: null }))

    render(<ThreadView conversationId="conv_1" />)

    await waitFor(() => expect(screen.getByText('Halo')).toBeInTheDocument())
    expect(screen.queryByText('Pesan belum dibaca')).not.toBeInTheDocument()
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
      if (s.endsWith('/messages')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      if (s.endsWith('/api/accounts')) return Promise.resolve({ ok: true, json: () => Promise.resolve(agents) } as Response)
      if (s.endsWith('/assign') && init?.method === 'PATCH') {
        patchCalls.push(JSON.parse(String(init.body)))
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(opts.patchResponse ?? { assignedAgentId: null }),
        } as Response)
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ botEnabled: false, assignedAgentId: opts.assignedAgentId }) } as Response)
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
      if (s.endsWith('/messages')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      if (s.endsWith('/api/accounts')) return Promise.resolve({ ok: true, json: () => Promise.resolve(agents) } as Response)
      if (s.endsWith('/assign') && init?.method === 'PATCH') {
        patchCalls.push(JSON.parse(String(init.body)))
        return patchPending.then(() => ({ ok: true, json: () => Promise.resolve({ assignedAgentId: 'acc_1' }) }) as Response)
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ botEnabled: false, assignedAgentId: null }) } as Response)
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
      if (s.endsWith('/messages')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      if (s.endsWith('/api/accounts')) return Promise.resolve({ ok: true, json: () => Promise.resolve(agents) } as Response)
      if (s.endsWith('/assign') && init?.method === 'PATCH') {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'nope' }) } as Response)
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ botEnabled: false, assignedAgentId: null }) } as Response)
    })

    render(<ThreadView conversationId="conv_1" />)

    const select = (await screen.findByLabelText('Ditugaskan ke')) as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe(''))

    fireEvent.change(select, { target: { value: 'acc_1' } })

    await waitFor(() => expect(screen.getByText('Gagal mengubah penugasan agen')).toBeInTheDocument())
    expect(select.value).toBe('')
  })
})

describe('ThreadView reply/quote', () => {
  const inboundMessage = {
    id: 'm1',
    direction: 'INBOUND',
    content: 'Paketnya yang 3D2N kan?',
    channel: 'OFFICIAL',
    sentBy: 'CUSTOMER',
    deliveryStatus: 'DELIVERED',
    createdAt: new Date().toISOString(),
    botTrace: null,
  }

  function mockFetch(opts: { sendResponse?: unknown } = {}) {
    return vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const s = String(url)
      if (s.endsWith('/messages')) return Promise.resolve({ ok: true, json: () => Promise.resolve([inboundMessage]) } as Response)
      if (s.endsWith('/api/accounts')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      if (s === '/api/send' && init?.method === 'POST') {
        return Promise.resolve(
          opts.sendResponse ?? ({ ok: true, json: () => Promise.resolve({ id: 'm_new', deliveryStatus: 'SENT' }) } as Response)
        )
      }
      if (s.endsWith('/read') && init?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ lastReadAt: new Date().toISOString() }) } as Response)
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ botEnabled: false, assignedAgentId: null, lastReadAt: null }) } as Response)
    })
  }

  it('shows the reply preview bar in ComposeBox after clicking Balas on a message', async () => {
    vi.stubGlobal('fetch', mockFetch())

    render(<ThreadView conversationId="conv_1" />)
    await waitFor(() => expect(screen.getByText('Paketnya yang 3D2N kan?')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Balas pesan ini' }))

    expect(screen.getByText('Membalas Pelanggan')).toBeInTheDocument()
  })

  it('clears the reply preview bar after a successful send', async () => {
    vi.stubGlobal('fetch', mockFetch())

    render(<ThreadView conversationId="conv_1" />)
    await waitFor(() => expect(screen.getByText('Paketnya yang 3D2N kan?')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Balas pesan ini' }))
    expect(screen.getByText('Membalas Pelanggan')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Pesan'), { target: { value: 'Iya benar' } })
    fireEvent.click(screen.getByText('Kirim'))

    await waitFor(() => expect(screen.queryByText('Membalas Pelanggan')).not.toBeInTheDocument())
  })

  it('clears the reply preview bar when the cancel button is clicked', async () => {
    vi.stubGlobal('fetch', mockFetch())

    render(<ThreadView conversationId="conv_1" />)
    await waitFor(() => expect(screen.getByText('Paketnya yang 3D2N kan?')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Balas pesan ini' }))

    fireEvent.click(screen.getByLabelText('Batalkan balasan'))

    expect(screen.queryByText('Membalas Pelanggan')).not.toBeInTheDocument()
  })
})

describe('ThreadView test-room send/SSE race', () => {
  it("does not duplicate a message that arrives via SSE before ComposeBox's own fetch response resolves", async () => {
    // Reproduces a real bug: /api/conversations/[id]/test-message broadcasts the customer's
    // message immediately, then awaits the (possibly slow, real-LLM) bot before returning its
    // HTTP response -- so the SSE echo can land in the browser well before ComposeBox's own
    // fetch() resolves and calls onSent for the very same message id.
    let resolveSend: (value: unknown) => void = () => {}
    const sendPending = new Promise((resolve) => {
      resolveSend = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn((url: RequestInfo | URL) => {
        const s = String(url)
        if (s.endsWith('/messages')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
        if (s.endsWith('/api/accounts')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
        if (s.endsWith('/test-message')) return sendPending.then((data) => ({ ok: true, json: () => Promise.resolve(data) }) as Response)
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ botEnabled: true, isTest: true }) } as Response)
      })
    )

    render(<ThreadView conversationId="conv_test" />)
    await screen.findByPlaceholderText('Ketik sebagai customer untuk menguji bot...')

    fireEvent.change(screen.getByLabelText('Pesan'), { target: { value: 'is ijen safe?' } })
    fireEvent.click(screen.getByText('Kirim'))

    // SSE echo of the same message arrives first, while the bot is still "thinking" server-side.
    const es = FakeEventSource.instances[0]
    const broadcastMessage = {
      id: 'msg_1', direction: 'INBOUND', content: 'is ijen safe?', channel: 'UNOFFICIAL',
      sentBy: 'CUSTOMER', deliveryStatus: 'DELIVERED', createdAt: '2026-08-04T00:00:00.000Z', botTrace: null,
    }
    // A <textarea> exposes its own value as DOM text content, so getAllByText would otherwise
    // ambiguously match both the still-typed draft AND the rendered bubble -- excluded here.
    const bubbleCopies = () => screen.getAllByText('is ijen safe?').filter((el) => el.tagName !== 'TEXTAREA')

    act(() => {
      es.emit({ type: 'message.created', conversationId: 'conv_test', message: broadcastMessage })
    })
    await waitFor(() => expect(bubbleCopies()).toHaveLength(1))

    // Only now does the slow fetch() resolve, calling ComposeBox's onSent with the same id.
    resolveSend({ id: 'msg_1', channel: 'UNOFFICIAL', deliveryStatus: 'DELIVERED', createdAt: '2026-08-04T00:00:00.000Z' })

    await waitFor(() => expect(screen.queryByLabelText('Pesan')).toHaveValue(''))
    expect(bubbleCopies()).toHaveLength(1)
  })
})

describe('ThreadView template variable data', () => {
  function mockFetch() {
    return vi.fn((url: RequestInfo | URL) => {
      const s = String(url)
      if (s.endsWith('/messages')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      if (s.endsWith('/api/accounts')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      if (s === '/api/templates') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: 'tpl_1', name: 'Konfirmasi', type: 'QUICK_REPLY', category: null, body: 'Sisa tagihan: {{1}}' }]),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            botEnabled: false,
            assignedAgentId: null,
            lastReadAt: null,
            contactName: 'Bruno Figarola',
            bookingData: { financial: { balance: 350000 } },
          }),
      } as Response)
    })
  }

  it('passes the conversation’s contact name and booking data into ComposeBox as pickable variable fields', async () => {
    vi.stubGlobal('fetch', mockFetch())

    render(<ThreadView conversationId="conv_1" />)
    await waitFor(() => expect(screen.getByText('Bruno Figarola')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Channel'), { target: { value: 'UNOFFICIAL' } })
    fireEvent.click(screen.getByLabelText('Tambah lampiran atau template'))
    fireEvent.click(await screen.findByText('📋 Template'))
    fireEvent.click(await screen.findByText('Konfirmasi'))

    const picker = await screen.findByLabelText('Isi dari data booking/kontak')
    fireEvent.change(picker, { target: { value: 'Bruno Figarola' } })
    expect(screen.getByLabelText('{{1}}')).toHaveValue('Bruno Figarola')
  })
})

describe('ThreadView initial scroll position', () => {
  // Element.prototype.scrollIntoView is a shared, module-level target -- vi.spyOn wraps
  // whatever is currently installed, so without restoring it after each test the call count
  // would keep accumulating across every test in this block instead of resetting per test.
  afterEach(() => vi.restoreAllMocks())

  const oldMessage = {
    id: 'm_old',
    direction: 'INBOUND',
    content: 'Pesan lama yang sudah dibaca',
    channel: 'OFFICIAL',
    sentBy: 'CUSTOMER',
    deliveryStatus: 'DELIVERED',
    createdAt: '2026-07-01T08:00:00.000Z',
    botTrace: null,
  }
  const newUnreadMessage = {
    id: 'm_new',
    direction: 'INBOUND',
    content: 'Pesan baru yang belum dibaca',
    channel: 'OFFICIAL',
    sentBy: 'CUSTOMER',
    deliveryStatus: 'DELIVERED',
    createdAt: '2026-07-01T09:00:00.000Z',
    botTrace: null,
  }

  function mockFetch(messages: unknown[], lastReadAt: string | null) {
    return vi.fn((url: RequestInfo | URL) => {
      const s = String(url)
      if (s.endsWith('/messages')) return Promise.resolve({ ok: true, json: () => Promise.resolve(messages) } as Response)
      if (s.endsWith('/api/accounts')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ botEnabled: false, assignedAgentId: null, lastReadAt }) } as Response)
    })
  }

  it('scrolls the "Pesan belum dibaca" divider into view when there is an unread message', async () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView')
    vi.stubGlobal('fetch', mockFetch([oldMessage, newUnreadMessage], '2026-07-01T08:30:00.000Z'))

    render(<ThreadView conversationId="conv_1" />)

    await waitFor(() => expect(screen.getByText('Pesan belum dibaca')).toBeInTheDocument())
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledWith({ block: 'start' }))
  })

  it('scrolls to the last message (bottom) when everything is already read', async () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView')
    vi.stubGlobal('fetch', mockFetch([oldMessage, newUnreadMessage], '2026-07-02T00:00:00.000Z'))

    render(<ThreadView conversationId="conv_1" />)

    await waitFor(() => expect(screen.getByText('Pesan baru yang belum dibaca')).toBeInTheDocument())
    expect(screen.queryByText('Pesan belum dibaca')).not.toBeInTheDocument()
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledWith({ block: 'end' }))
  })

  it('scrolls to the last message on a conversation that has never been opened before (lastReadAt: null)', async () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView')
    vi.stubGlobal('fetch', mockFetch([oldMessage, newUnreadMessage], null))

    render(<ThreadView conversationId="conv_1" />)

    await waitFor(() => expect(screen.getByText('Pesan baru yang belum dibaca')).toBeInTheDocument())
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledWith({ block: 'end' }))
  })

  it('only scrolls once, even if messages/detail state updates again later', async () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView')
    vi.stubGlobal('fetch', mockFetch([oldMessage], '2026-07-02T00:00:00.000Z'))

    render(<ThreadView conversationId="conv_1" />)
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1))

    const es = FakeEventSource.instances[0]
    act(() => {
      es.emit({ type: 'message.created', conversationId: 'conv_1', message: newUnreadMessage })
    })

    await waitFor(() => expect(screen.getByText('Pesan baru yang belum dibaca')).toBeInTheDocument())
    expect(scrollSpy).toHaveBeenCalledTimes(1)
  })
})

describe('ThreadView date dividers', () => {
  function mockFetch(messages: unknown[]) {
    return vi.fn((url: RequestInfo | URL) => {
      const s = String(url)
      if (s.endsWith('/messages')) return Promise.resolve({ ok: true, json: () => Promise.resolve(messages) } as Response)
      if (s.endsWith('/api/accounts')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ botEnabled: false, assignedAgentId: null, lastReadAt: null }) } as Response)
    })
  }

  it('labels a message from today as "Hari ini"', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch([
        { id: 'm1', direction: 'INBOUND', content: 'Halo', channel: 'OFFICIAL', sentBy: 'CUSTOMER', deliveryStatus: 'DELIVERED', createdAt: new Date().toISOString(), botTrace: null },
      ])
    )

    render(<ThreadView conversationId="conv_1" />)

    await waitFor(() => expect(screen.getByText('Hari ini')).toBeInTheDocument())
  })

  it('labels a message from yesterday as "Kemarin"', async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    vi.stubGlobal(
      'fetch',
      mockFetch([
        { id: 'm1', direction: 'INBOUND', content: 'Halo kemarin', channel: 'OFFICIAL', sentBy: 'CUSTOMER', deliveryStatus: 'DELIVERED', createdAt: yesterday.toISOString(), botTrace: null },
      ])
    )

    render(<ThreadView conversationId="conv_1" />)

    await waitFor(() => expect(screen.getByText('Kemarin')).toBeInTheDocument())
  })

  it('labels an older message with its full date', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch([
        { id: 'm1', direction: 'INBOUND', content: 'Pesan lama', channel: 'OFFICIAL', sentBy: 'CUSTOMER', deliveryStatus: 'DELIVERED', createdAt: '2026-01-05T03:00:00.000Z', botTrace: null },
      ])
    )

    render(<ThreadView conversationId="conv_1" />)

    await waitFor(() => expect(screen.getByText('5 Januari 2026')).toBeInTheDocument())
  })

  it('shows only one divider for consecutive messages on the same day', async () => {
    const today = new Date().toISOString()
    vi.stubGlobal(
      'fetch',
      mockFetch([
        { id: 'm1', direction: 'INBOUND', content: 'Pesan satu', channel: 'OFFICIAL', sentBy: 'CUSTOMER', deliveryStatus: 'DELIVERED', createdAt: today, botTrace: null },
        { id: 'm2', direction: 'OUTBOUND', content: 'Pesan dua', channel: 'OFFICIAL', sentBy: 'AGENT', deliveryStatus: 'SENT', createdAt: today, botTrace: null },
      ])
    )

    render(<ThreadView conversationId="conv_1" />)

    await waitFor(() => expect(screen.getByText('Pesan dua')).toBeInTheDocument())
    expect(screen.getAllByText('Hari ini')).toHaveLength(1)
  })

  it('shows a new divider when messages cross a day boundary', async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    vi.stubGlobal(
      'fetch',
      mockFetch([
        { id: 'm1', direction: 'INBOUND', content: 'Pesan kemarin', channel: 'OFFICIAL', sentBy: 'CUSTOMER', deliveryStatus: 'DELIVERED', createdAt: yesterday.toISOString(), botTrace: null },
        { id: 'm2', direction: 'OUTBOUND', content: 'Pesan hari ini', channel: 'OFFICIAL', sentBy: 'AGENT', deliveryStatus: 'SENT', createdAt: new Date().toISOString(), botTrace: null },
      ])
    )

    render(<ThreadView conversationId="conv_1" />)

    await waitFor(() => expect(screen.getByText('Pesan hari ini')).toBeInTheDocument())
    expect(screen.getByText('Kemarin')).toBeInTheDocument()
    expect(screen.getByText('Hari ini')).toBeInTheDocument()
  })
})
