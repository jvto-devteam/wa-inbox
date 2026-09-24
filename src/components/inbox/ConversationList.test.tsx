import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, cleanup, act } from '@testing-library/react'
import { ConversationList } from './ConversationList'

const SEARCH_INPUT_PLACEHOLDER = 'Cari nama, nomor, atau isi pesan...'

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response
}

// ConversationList also fetches /api/conversations/order-channels and /api/labels (for the
// filter row) on every mount. Routing by URL keeps those calls answered with `[]` by default so
// neither gets mistaken for the conversations list -- e.g. `getAllByRole('button')[0]` would
// otherwise pick up a stray filter pill instead of the first conversation row. `channels` and
// `labels` default to empty for every test that isn't specifically exercising the filter row.
//
// The order-channels check must come BEFORE the conversations one: its URL also starts with
// '/api/conversations'.
function mockConversationsFetch(list: unknown[], channels: unknown[] = [], labels: unknown[] = []) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.startsWith('/api/conversations/order-channels')) return Promise.resolve(jsonResponse(channels))
    if (url.startsWith('/api/conversations')) return Promise.resolve(jsonResponse(list))
    if (url.startsWith('/api/labels')) return Promise.resolve(jsonResponse(labels))
    return Promise.resolve(jsonResponse([]))
  })
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
  it('fetches the WhatsApp-filtered list immediately on mount, with no debounce delay', async () => {
    render(<ConversationList selectedId={null} onSelect={() => {}} />)

    // No timer advance at all -- the very first load must not wait out the debounce window.
    await advanceTimers(0)

    // Default filter is the WhatsApp platform tab (see ConversationList's initial state) --
    // day one after deploy shows exactly what the team sees today.
    expect(fetch).toHaveBeenCalledWith('/api/conversations?platform=WHATSAPP')
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
    expect(fetch).toHaveBeenCalledWith('/api/conversations?q=ijen&platform=WHATSAPP')
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

  it('re-fetches the WhatsApp-filtered list when the search input is cleared', async () => {
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0) // flush the initial mount fetch

    const input = screen.getByPlaceholderText(SEARCH_INPUT_PLACEHOLDER)
    act(() => { fireEvent.change(input, { target: { value: 'ijen' } }) })
    await advanceTimers(300)
    vi.mocked(fetch).mockClear()

    act(() => { fireEvent.change(input, { target: { value: '' } }) })
    await advanceTimers(300)

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('/api/conversations?platform=WHATSAPP')
  })
})

describe('ConversationList filter row (channel + label)', () => {
  const CHANNELS = ['JVTO', 'KLOOK']
  const LABELS = [
    { id: 'lbl_1', name: 'VIP', color: '#3C6B42' },
    { id: 'lbl_2', name: 'Komplain', color: '#B23B3B' },
  ]

  it('still renders the filter row for its platform tabs when there is neither a channel nor a label yet', async () => {
    mockConversationsFetch([], [], [])
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)

    // SHIPPED_PLATFORMS (WhatsApp, Facebook) is a fixed constant, not derived from data -- so
    // unlike the channel/label pills, the platform tabs (and the row that holds them) show up
    // even before any booking channel or label exists.
    expect(screen.getByRole('group', { name: 'Filter inbox' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'WhatsApp' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Facebook' })).toBeInTheDocument()
  })

  it('renders All + platform tabs + one button per channel and per label, with WhatsApp active by default', async () => {
    mockConversationsFetch([], CHANNELS, LABELS)
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)

    const group = screen.getByRole('group', { name: 'Filter inbox' })
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'WhatsApp' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Facebook' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'JVTO' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'KLOOK' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'VIP' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Komplain' })).toHaveAttribute('aria-pressed', 'false')
    expect(group).toBeInTheDocument()
  })

  it('re-fetches with the platform param when a platform pill is clicked, and marks it active', async () => {
    mockConversationsFetch([], CHANNELS, LABELS)
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)
    vi.mocked(fetch).mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Facebook' }))
    await advanceTimers(300)

    expect(fetch).toHaveBeenCalledWith('/api/conversations?platform=FACEBOOK')
    expect(screen.getByRole('button', { name: 'Facebook' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'WhatsApp' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('renders a channel-only row when there are no labels yet', async () => {
    mockConversationsFetch([], CHANNELS, [])
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)

    expect(screen.getByRole('group', { name: 'Filter inbox' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'JVTO' })).toBeInTheDocument()
  })

  it('re-fetches with orderChannel when a channel pill is clicked, and marks it active', async () => {
    mockConversationsFetch([], CHANNELS, LABELS)
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)
    vi.mocked(fetch).mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'JVTO' }))
    await advanceTimers(300)

    expect(fetch).toHaveBeenCalledWith('/api/conversations?orderChannel=JVTO')
    expect(screen.getByRole('button', { name: 'JVTO' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('re-fetches with labelId when a label pill is clicked, and marks it active', async () => {
    mockConversationsFetch([], CHANNELS, LABELS)
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)
    vi.mocked(fetch).mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'VIP' }))
    await advanceTimers(300)

    expect(fetch).toHaveBeenCalledWith('/api/conversations?labelId=lbl_1')
    expect(screen.getByRole('button', { name: 'VIP' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('picking a label deactivates a previously active channel pill, and vice versa', async () => {
    mockConversationsFetch([], CHANNELS, LABELS)
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)

    fireEvent.click(screen.getByRole('button', { name: 'JVTO' }))
    await advanceTimers(300)
    expect(screen.getByRole('button', { name: 'JVTO' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'VIP' }))
    await advanceTimers(300)

    expect(screen.getByRole('button', { name: 'JVTO' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'VIP' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('combines the active filter with a search query', async () => {
    mockConversationsFetch([], CHANNELS, LABELS)
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)

    fireEvent.click(screen.getByRole('button', { name: 'JVTO' }))
    await advanceTimers(300)
    vi.mocked(fetch).mockClear()

    fireEvent.change(screen.getByPlaceholderText(SEARCH_INPUT_PLACEHOLDER), { target: { value: 'ijen' } })
    await advanceTimers(300)

    expect(fetch).toHaveBeenCalledWith('/api/conversations?q=ijen&orderChannel=JVTO')
  })

  it('returns to the unfiltered list when All is clicked again', async () => {
    mockConversationsFetch([], CHANNELS, LABELS)
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)

    fireEvent.click(screen.getByRole('button', { name: 'VIP' }))
    await advanceTimers(300)
    vi.mocked(fetch).mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    await advanceTimers(300)

    expect(fetch).toHaveBeenCalledWith('/api/conversations')
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
  })
})

// The platform badge (WhatsApp/Facebook per row) is only useful where rows from more than one
// platform can appear side by side -- the "Semua" tab. On a single-platform tab every row
// already agrees on its platform, so the badge would be uniform noise rather than information.
describe('ConversationList platform badge visibility', () => {
  function conversation(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      contactName: `Kontak ${id}`,
      contactPhone: `62812000${id}`,
      lastMessage: `Pesan ${id}`,
      lastMessageSentBy: 'CUSTOMER',
      lastMessageAt: '2026-07-20T10:00:00.000Z',
      botEnabled: false,
      status: 'OPEN',
      pipelineStage: 'new',
      unreadCount: 0,
      labels: [],
      platform: 'WHATSAPP',
      ...overrides,
    }
  }

  // Scoped to the <ul> of conversation rows throughout -- "Facebook"/"WhatsApp" is also the
  // text of the filter row's own tab buttons, which must not be mistaken for the row badge.
  it('hides the platform badge on the default WhatsApp tab', async () => {
    mockConversationsFetch([conversation('a')])
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)

    expect(within(screen.getByRole('list')).queryByText('WhatsApp')).not.toBeInTheDocument()
  })

  it('shows the platform badge once "All" is selected', async () => {
    mockConversationsFetch([conversation('a', { platform: 'FACEBOOK' })])
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    await advanceTimers(300)

    expect(within(screen.getByRole('list')).getByText('Facebook')).toBeInTheDocument()
  })

  it('hides the platform badge again after switching to a single-platform tab', async () => {
    mockConversationsFetch([conversation('a', { platform: 'FACEBOOK' })])
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    await advanceTimers(300)
    expect(within(screen.getByRole('list')).getByText('Facebook')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Facebook' }))
    await advanceTimers(300)

    expect(within(screen.getByRole('list')).queryByText('Facebook')).not.toBeInTheDocument()
  })

  // GET /api/conversations only constrains channelIdentity when `platform` itself is the
  // active filter (route.ts:46-48) -- an orderChannel or labelId filter has no platform
  // restriction at all, so a pill like "KLOOK" can return a WhatsApp booking and a Facebook
  // booking side by side. `filter === null` alone missed this: it hid the badge for exactly
  // the filter states where rows can still mix platforms.
  it('shows the platform badge when an orderChannel pill is active, since it can mix rows from more than one platform', async () => {
    mockConversationsFetch(
      [conversation('a', { platform: 'WHATSAPP' }), conversation('b', { platform: 'FACEBOOK' })],
      ['KLOOK']
    )
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)

    fireEvent.click(screen.getByRole('button', { name: 'KLOOK' }))
    await advanceTimers(300)

    expect(within(screen.getByRole('list')).getByText('WhatsApp')).toBeInTheDocument()
    expect(within(screen.getByRole('list')).getByText('Facebook')).toBeInTheDocument()
  })

  it('shows the platform badge when a label pill is active, since it can mix rows from more than one platform', async () => {
    mockConversationsFetch(
      [conversation('a', { platform: 'WHATSAPP' }), conversation('b', { platform: 'FACEBOOK' })],
      [],
      [{ id: 'lbl_1', name: 'VIP', color: '#3C6B42' }]
    )
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)

    fireEvent.click(screen.getByRole('button', { name: 'VIP' }))
    await advanceTimers(300)

    expect(within(screen.getByRole('list')).getByText('WhatsApp')).toBeInTheDocument()
    expect(within(screen.getByRole('list')).getByText('Facebook')).toBeInTheDocument()
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
      pipelineStage: 'new',
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
    mockConversationsFetch(list)

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

    // Scoped to the <ul> of conversation rows -- the filter row's own buttons (All, WhatsApp,
    // Facebook, ...) sit above the list and would otherwise be picked up as rows[0]/rows[1].
    const rows = within(screen.getByRole('list')).getAllByRole('button').map((el) => el.textContent)
    expect(rows[0]).toContain('Kontak b')
    expect(rows[1]).toContain('Kontak a')

    // An in-place patch carries everything the row renders, so no round trip is needed.
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps a pinned conversation above a fresher non-pinned one after a live re-sort', async () => {
    const list = [
      conversation('test', { lastMessageAt: '2026-07-20T09:00:00.000Z', isPinned: true }),
      conversation('a', { lastMessageAt: '2026-07-20T10:00:00.000Z', isPinned: false }),
    ]
    mockConversationsFetch(list)

    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)

    // 'a' gets a brand-new message, which would normally jump it to the top -- but the
    // pinned sandbox conversation must stay first regardless.
    const es = FakeEventSource.instances[0]
    act(() => {
      es.emit({
        type: 'message.created',
        conversationId: 'a',
        message: { id: 'm_new', content: 'Baru masuk', sentBy: 'CUSTOMER', createdAt: '2026-07-20T20:00:00.000Z' },
      })
    })
    await advanceTimers(0)

    const rows = within(screen.getByRole('list')).getAllByRole('button').map((el) => el.textContent)
    expect(rows[0]).toContain('Kontak test')
    expect(rows[1]).toContain('Kontak a')
  })

  it('re-fetches when the event is for a conversation not currently in the list', async () => {
    mockConversationsFetch([conversation('a')])

    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)
    vi.mocked(fetch).mockClear()

    const es = FakeEventSource.instances[0]
    // A brand-new conversation: the event carries no contact name, phone, labels or
    // botEnabled, so the full row can only come from the server.
    mockConversationsFetch([conversation('baru', { contactName: 'Pelanggan Baru' }), conversation('a')])
    act(() => {
      es.emit({
        type: 'message.created',
        conversationId: 'baru',
        message: { id: 'm1', content: 'Halo', sentBy: 'CUSTOMER', createdAt: '2026-07-20T16:00:00.000Z' },
      })
    })
    await advanceTimers(0)

    expect(fetch).toHaveBeenCalledWith('/api/conversations?platform=WHATSAPP')
    expect(screen.getByText('Pelanggan Baru')).toBeInTheDocument()
  })

  it('keeps the active search filter on the re-fetch triggered by a new conversation', async () => {
    mockConversationsFetch([conversation('a')])

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

    // Re-fetching without the active filter would silently drop the agent's search (and its
    // default WhatsApp tab).
    expect(fetch).toHaveBeenCalledWith('/api/conversations?q=ijen&platform=WHATSAPP')
  })

  it('ignores event types it does not handle', async () => {
    mockConversationsFetch([conversation('a')])

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
      pipelineStage: 'new',
      unreadCount: 0,
      labels: [],
      ...overrides,
    }
  }

  it('bumps the unread badge on an inbound message for a conversation that is not selected', async () => {
    mockConversationsFetch([conversation('a')])
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
    mockConversationsFetch([conversation('a')])
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
    mockConversationsFetch([conversation('a')])
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
    mockConversationsFetch([conversation('a', { unreadCount: 5 })])
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
    mockConversationsFetch([
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

    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)

    expect(screen.getByText('Bruno')).toBeInTheDocument()
    expect(screen.getByText('Halo!')).toBeInTheDocument()
    expect(location.href).toBe('http://localhost/inbox')
  })

  it('keeps the existing rows when a non-401 failure happens on a later search', async () => {
    mockConversationsFetch([conversationRow()])

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

// Tahap 1C. Dua hal yang tidak punya penjaga sebelumnya: apakah daftar ini bisa dipakai tanpa
// tetikus, dan apakah ia menggulung SENDIRI (bukan mendorong overflow-nya ke pembungkus
// halaman, yang menghasilkan gulungan ganda).
describe('ConversationList — aksesibilitas dan gulungan', () => {
  function row(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      contactName: `Kontak ${id}`,
      contactPhone: `62812000${id}`,
      avatarUrl: null,
      lastMessage: `Pesan ${id}`,
      lastMessageSentBy: 'CUSTOMER',
      lastMessageAt: '2026-07-20T10:00:00.000Z',
      botEnabled: true,
      status: 'OPEN',
      isPinned: false,
      orderChannel: null,
      pipelineStage: 'new',
      unreadCount: 0,
      labels: [],
      ...overrides,
    }
  }

  it('memberi kolomnya nama yang bisa dibaca pembaca layar', async () => {
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)

    expect(screen.getByRole('complementary', { name: 'Daftar percakapan' })).toBeInTheDocument()
  })

  it('memberi kotak pencarian nama sendiri, bukan hanya placeholder', async () => {
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)

    expect(screen.getByLabelText('Cari percakapan')).toBeInTheDocument()
  })

  it('menyusun barisnya sebagai daftar sungguhan, dan tiap baris adalah tombol yang bisa di-Tab', async () => {
    mockConversationsFetch([row('a'), row('b')])
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    // Tombol native: fokus keyboard, Enter dan Spasi datang gratis dan benar. Sebuah <div
    // onClick> akan terlihat sama persis dan tidak bisa dicapai tanpa tetikus sama sekali.
    for (const item of items) {
      const button = item.querySelector('button')
      expect(button).toBeInTheDocument()
      expect(button).not.toHaveAttribute('disabled')
      expect(button?.tabIndex).not.toBe(-1)
    }
  })

  it('menandai percakapan yang sedang dibuka dengan aria-current, bukan hanya dengan warna', async () => {
    mockConversationsFetch([row('a'), row('b')])
    render(<ConversationList selectedId="b" onSelect={() => {}} />)
    await advanceTimers(0)

    const buttons = screen.getAllByRole('button')
    expect(buttons.find((b) => b.textContent?.includes('Kontak b'))).toHaveAttribute('aria-current', 'true')
    expect(buttons.find((b) => b.textContent?.includes('Kontak a'))).not.toHaveAttribute('aria-current')
  })

  it('memilih percakapan lewat Enter di baris yang sedang difokus', async () => {
    mockConversationsFetch([row('a')])
    const onSelect = vi.fn()
    render(<ConversationList selectedId={null} onSelect={onSelect} />)
    await advanceTimers(0)

    // Scoped to the <ul> of conversation rows -- the filter row's own buttons (All, WhatsApp,
    // Facebook, ...) sit above the list and would otherwise be picked up as button [0].
    const button = within(screen.getByRole('list')).getAllByRole('button')[0]
    button.focus()
    expect(document.activeElement).toBe(button)
    // fireEvent.click adalah apa yang dikirim browser untuk Enter/Spasi pada <button>.
    fireEvent.click(button)

    expect(onSelect).toHaveBeenCalledWith('a')
  })

  it('menggulung di dalam kolomnya sendiri, dan kolomnya tidak boleh tumbuh melewati tingginya', async () => {
    const { container } = render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)

    const column = container.firstElementChild as HTMLElement
    expect(column).toHaveClass('h-full', 'min-h-0')
    // Kolomnya sendiri TIDAK menggulung; scroller-nya ada di dalam, jadi kepala pencarian tetap
    // di tempat dan tidak ada dua bilah gulung yang bertumpuk.
    expect(column.className).not.toContain('overflow-y-auto')

    const scroller = column.querySelector('.overflow-y-auto')
    expect(scroller).toBeInTheDocument()
    expect(scroller).toHaveClass('min-h-0', 'flex-1')
  })
})

// Keadaan memuat dan keadaan kosong: dirancang, bukan kebetulan.
describe('ConversationList — keadaan memuat dan kosong', () => {
  it('menunjukkan kerangka baris selagi permintaan pertama berjalan, bukan daftar kosong', () => {
    // Sengaja tidak pernah selesai: inilah jendela waktu yang sedang diuji.
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}))
    const { container } = render(<ConversationList selectedId={null} onSelect={() => {}} />)

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })

  it('mengganti kerangka dengan ajakan yang jelas ketika memang belum ada percakapan', async () => {
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)

    expect(screen.getByText('Belum ada percakapan')).toBeInTheDocument()
    expect(screen.getByText(/pelanggan mengirim pesan pertama/)).toBeInTheDocument()
  })

  it('membedakan "pencarian tidak ketemu" dari "memang belum ada apa-apa", dan menawarkan jalan keluar', async () => {
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0)

    fireEvent.change(screen.getByPlaceholderText(SEARCH_INPUT_PLACEHOLDER), { target: { value: 'ijen' } })
    await advanceTimers(300)

    expect(screen.getByText('Tidak ada yang cocok')).toBeInTheDocument()
    expect(screen.getByText(/"ijen"/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Hapus pencarian' }))
    await advanceTimers(300)

    expect(screen.getByText('Belum ada percakapan')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(SEARCH_INPUT_PLACEHOLDER)).toHaveValue('')
  })
})
