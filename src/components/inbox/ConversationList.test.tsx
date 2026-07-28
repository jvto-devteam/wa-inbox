import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { ConversationList } from './ConversationList'

const SEARCH_INPUT_PLACEHOLDER = 'Cari nama, nomor, atau isi pesan...'

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response
}

// ConversationList opens an EventSource for live updates; jsdom doesn't implement it, so
// stub a minimal version (same shape ThreadView.test.tsx uses) that also lets a test push
// an event through `onmessage`.
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

// Wraps timer advancement (which flushes the pending setTimeout, its fetch mock, and the
// resulting setConversations state update) in `act` so React doesn't warn about updates
// happening outside of a rendered/asserted batch.
async function advanceTimers(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  FakeEventSource.instances = []
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse([]))))
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('location', { pathname: '/inbox', href: 'http://localhost/inbox' })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('ConversationList search debounce', () => {
  it('fetches the unfiltered list immediately on mount, with no debounce delay', async () => {
    render(<ConversationList selectedId={null} onSelect={() => {}} />)

    // No timer advance at all -- the very first load must not wait out the debounce window.
    await advanceTimers(0)

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('/api/conversations')
  })

  it('schedules exactly one fetch after the debounce delay when typing quickly, not one per keystroke', async () => {
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0) // flush the initial mount fetch
    vi.mocked(fetch).mockClear()

    const input = screen.getByPlaceholderText(SEARCH_INPUT_PLACEHOLDER)
    act(() => { fireEvent.change(input, { target: { value: 'i' } }) })
    act(() => { fireEvent.change(input, { target: { value: 'ij' } }) })
    act(() => { fireEvent.change(input, { target: { value: 'ije' } }) })
    act(() => { fireEvent.change(input, { target: { value: 'ijen' } }) })

    // Still inside the debounce window -- nothing should have fired yet, and each keystroke
    // must not have triggered its own immediate fetch alongside the delayed one.
    expect(fetch).not.toHaveBeenCalled()

    await advanceTimers(300)

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('/api/conversations?q=ijen')
  })

  it('clears the debounce timer on unmount, so no stale fetch fires afterward', async () => {
    const { unmount } = render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0) // flush the initial mount fetch
    vi.mocked(fetch).mockClear()

    const input = screen.getByPlaceholderText(SEARCH_INPUT_PLACEHOLDER)
    act(() => { fireEvent.change(input, { target: { value: 'ijen' } }) })

    unmount()

    await advanceTimers(1000)

    expect(fetch).not.toHaveBeenCalled()
  })

  it('re-fetches the unfiltered list when the search input is cleared', async () => {
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0) // flush the initial mount fetch

    const input = screen.getByPlaceholderText(SEARCH_INPUT_PLACEHOLDER)
    act(() => { fireEvent.change(input, { target: { value: 'ijen' } }) })
    await advanceTimers(300)
    vi.mocked(fetch).mockClear()

    act(() => { fireEvent.change(input, { target: { value: '' } }) })
    await advanceTimers(300)

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('/api/conversations')
  })
})

// The list used to be a one-shot snapshot: it fetched on mount and on search, and never
// subscribed to the SSE stream every inbound/outbound message already broadcasts on. A new
// customer message produced no new row, and a reply on an open conversation neither moved it
// to the top nor refreshed its preview until the agent reloaded the page.
describe('ConversationList live updates', () => {
  function conversation(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      contactName: `Kontak ${id}`,
      contactPhone: `62812000${id}`,
      lastMessage: `Pesan lama ${id}`,
      lastMessageSentBy: 'CUSTOMER',
      lastMessageAt: '2026-07-20T10:00:00.000Z',
      botEnabled: false,
      status: 'OPEN',
      unreadCount: 0,
      labels: [],
      ...overrides,
    }
  }

  it('patches the preview and timestamp of a conversation already in the list, and re-sorts it to the top', async () => {
    const list = [
      conversation('a', { lastMessageAt: '2026-07-20T12:00:00.000Z' }),
      conversation('b', { lastMessageAt: '2026-07-20T09:00:00.000Z' }),
    ]
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse(list)))

    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)
    expect(screen.getByText('Pesan lama b')).toBeInTheDocument()

    // 'b' was last (older lastMessageAt); a fresh customer message on it must both refresh
    // its preview and lift it above 'a'.
    const es = FakeEventSource.instances[0]
    vi.mocked(fetch).mockClear()
    act(() => {
      es.emit({
        type: 'message.created',
        conversationId: 'b',
        message: {
          id: 'm_new',
          content: 'Halo, masih ada slot besok?',
          sentBy: 'CUSTOMER',
          createdAt: '2026-07-20T15:00:00.000Z',
        },
      })
    })
    await advanceTimers(0)

    expect(screen.getByText('Halo, masih ada slot besok?')).toBeInTheDocument()
    expect(screen.queryByText('Pesan lama b')).not.toBeInTheDocument()

    const rows = screen.getAllByRole('button').map((el) => el.textContent)
    expect(rows[0]).toContain('Kontak b')
    expect(rows[1]).toContain('Kontak a')

    // An in-place patch carries everything the row renders, so no round trip is needed.
    expect(fetch).not.toHaveBeenCalled()
  })

  it('re-fetches when the event is for a conversation not currently in the list', async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse([conversation('a')])))

    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)
    vi.mocked(fetch).mockClear()

    const es = FakeEventSource.instances[0]
    // A brand-new conversation: the event carries no contact name, phone, labels or
    // botEnabled, so the full row can only come from the server.
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(jsonResponse([conversation('baru', { contactName: 'Pelanggan Baru' }), conversation('a')]))
    )
    act(() => {
      es.emit({
        type: 'message.created',
        conversationId: 'baru',
        message: { id: 'm1', content: 'Halo', sentBy: 'CUSTOMER', createdAt: '2026-07-20T16:00:00.000Z' },
      })
    })
    await advanceTimers(0)

    expect(fetch).toHaveBeenCalledWith('/api/conversations')
    expect(screen.getByText('Pelanggan Baru')).toBeInTheDocument()
  })

  it('keeps the active search filter on the re-fetch triggered by a new conversation', async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse([conversation('a')])))

    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)

    fireEvent.change(screen.getByPlaceholderText(SEARCH_INPUT_PLACEHOLDER), { target: { value: 'ijen' } })
    await advanceTimers(300)
    vi.mocked(fetch).mockClear()

    const es = FakeEventSource.instances[0]
    act(() => {
      es.emit({
        type: 'message.created',
        conversationId: 'lain',
        message: { id: 'm1', content: 'Halo', sentBy: 'CUSTOMER', createdAt: '2026-07-20T16:00:00.000Z' },
      })
    })
    await advanceTimers(0)

    // Re-fetching unfiltered would silently drop the agent's search.
    expect(fetch).toHaveBeenCalledWith('/api/conversations?q=ijen')
  })

  it('ignores event types it does not handle', async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse([conversation('a')])))

    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)
    vi.mocked(fetch).mockClear()

    const es = FakeEventSource.instances[0]
    act(() => {
      es.emit({ type: 'handoff.alert', conversationId: 'zzz', contactName: 'Siapa pun' })
      es.emit({
        type: 'message.updated',
        conversationId: 'a',
        message: { id: 'm1', content: 'diperbarui', sentBy: 'AGENT', createdAt: '2026-07-21T00:00:00.000Z' },
      })
    })
    await advanceTimers(0)

    expect(fetch).not.toHaveBeenCalled()
    expect(screen.getByText('Pesan lama a')).toBeInTheDocument()
  })

  it('closes the EventSource on unmount', async () => {
    const { unmount } = render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)

    const es = FakeEventSource.instances[0]
    unmount()

    expect(es.close).toHaveBeenCalled()
  })
})

describe('ConversationList unread counts', () => {
  function conversation(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      contactName: `Kontak ${id}`,
      contactPhone: `62812000${id}`,
      lastMessage: `Pesan lama ${id}`,
      lastMessageSentBy: 'CUSTOMER',
      lastMessageAt: '2026-07-20T10:00:00.000Z',
      botEnabled: false,
      status: 'OPEN',
      unreadCount: 0,
      labels: [],
      ...overrides,
    }
  }

  it('bumps the unread badge on an inbound message for a conversation that is not selected', async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse([conversation('a')])))
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)

    const es = FakeEventSource.instances[0]
    act(() => {
      es.emit({
        type: 'message.created',
        conversationId: 'a',
        message: { id: 'm1', content: 'Halo', sentBy: 'CUSTOMER', direction: 'INBOUND', createdAt: '2026-07-20T16:00:00.000Z' },
      })
    })
    await advanceTimers(0)

    expect(screen.getByLabelText('1 pesan belum dibaca')).toBeInTheDocument()
  })

  it('does not bump the unread badge for an inbound message on the currently selected conversation', async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse([conversation('a')])))
    render(<ConversationList selectedId="a" onSelect={() => {}} />)
    await advanceTimers(0)

    const es = FakeEventSource.instances[0]
    act(() => {
      es.emit({
        type: 'message.created',
        conversationId: 'a',
        message: { id: 'm1', content: 'Halo', sentBy: 'CUSTOMER', direction: 'INBOUND', createdAt: '2026-07-20T16:00:00.000Z' },
      })
    })
    await advanceTimers(0)

    expect(screen.queryByLabelText(/pesan belum dibaca/)).not.toBeInTheDocument()
  })

  it('does not bump the unread badge for an outbound message', async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse([conversation('a')])))
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)

    const es = FakeEventSource.instances[0]
    act(() => {
      es.emit({
        type: 'message.created',
        conversationId: 'a',
        message: { id: 'm1', content: 'Halo', sentBy: 'AGENT', direction: 'OUTBOUND', createdAt: '2026-07-20T16:00:00.000Z' },
      })
    })
    await advanceTimers(0)

    expect(screen.queryByLabelText(/pesan belum dibaca/)).not.toBeInTheDocument()
  })

  it('clears the unread badge for a conversation as soon as it becomes selected', async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse([conversation('a', { unreadCount: 5 })])))
    const { rerender } = render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)
    expect(screen.getByLabelText('5 pesan belum dibaca')).toBeInTheDocument()

    rerender(<ConversationList selectedId="a" onSelect={() => {}} />)

    expect(screen.queryByLabelText(/pesan belum dibaca/)).not.toBeInTheDocument()
  })
})

// src/middleware.ts answers an expired or revoked session with a 401 on every /api/* route.
// Before fetchJson, `{ error: 'Unauthorized' }` landed in `conversations` and the very next
// render threw on `conversations.map`.
describe('ConversationList session expiry', () => {
  it('redirects to /login instead of crashing when the list request 401s', async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: 'Unauthorized' }) } as Response)
    )

    expect(() => render(<ConversationList selectedId={null} onSelect={() => {}} />)).not.toThrow()
    await advanceTimers(0)

    expect(location.href).toBe('/login')
    // Still a usable, empty list -- never an error object rendered as rows.
    expect(screen.getByPlaceholderText(SEARCH_INPUT_PLACEHOLDER)).toBeInTheDocument()
  })

  it('renders the list normally on a 200, exactly as before', async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(
        jsonResponse([
          {
            id: 'conv_1',
            contactName: 'Bruno',
            contactPhone: '6281234567890',
            lastMessage: 'Halo!',
            lastMessageSentBy: 'CUSTOMER',
            lastMessageAt: '2026-07-20T10:00:00.000Z',
            botEnabled: true,
            status: 'OPEN',
            labels: [],
          },
        ])
      )
    )

    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)

    expect(screen.getByText('Bruno')).toBeInTheDocument()
    expect(screen.getByText('Halo!')).toBeInTheDocument()
    expect(location.href).toBe('http://localhost/inbox')
  })

  it('keeps the existing rows when a non-401 failure happens on a later search', async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse([conversationRow()])))

    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)
    expect(screen.getByText('Bruno')).toBeInTheDocument()

    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'boom' }) } as Response)
    )
    fireEvent.change(screen.getByPlaceholderText(SEARCH_INPUT_PLACEHOLDER), { target: { value: 'ijen' } })
    await advanceTimers(300)

    // A server error must not blank out the agent's inbox, and must not bounce them to login.
    expect(screen.getByText('Bruno')).toBeInTheDocument()
    expect(location.href).toBe('http://localhost/inbox')
  })
})

function conversationRow() {
  return {
    id: 'conv_1',
    contactName: 'Bruno',
    contactPhone: '6281234567890',
    lastMessage: 'Halo!',
    lastMessageSentBy: 'CUSTOMER',
    lastMessageAt: '2026-07-20T10:00:00.000Z',
    botEnabled: true,
    status: 'OPEN',
    labels: [],
  }
}
