import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { GapBell, gapHref } from './GapBell'

vi.mock('next/link', () => ({
  default: ({ href, children, onClick }: { href: string; children: React.ReactNode; onClick?: () => void }) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}))

// jsdom tidak punya EventSource; stub minimal yang bisa memancarkan event seperti ThreadView.test.
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

function gap(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gap_1',
    conversationId: 'conv_1',
    messageId: 'msg_bot',
    contactName: 'Bruno',
    topic: 'price',
    reason: 'reply_unsourced',
    messageText: 'berapa harga ATV sekarang?',
    createdAt: '2026-09-12T02:00:00.000Z',
    ...overrides,
  }
}

function stubFeed(feed: { count: number; items: unknown[] }) {
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => feed }) as Response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('gapHref', () => {
  it('menyertakan id pesan bila ada', () => {
    expect(gapHref(gap() as never)).toBe('/inbox?conversation=conv_1&message=msg_bot')
  })

  it('hanya membuka percakapan untuk baris gap lama tanpa id pesan', () => {
    expect(gapHref(gap({ messageId: null }) as never)).toBe('/inbox?conversation=conv_1')
  })
})

describe('GapBell', () => {
  it('menampilkan angka gap yang belum ditangani', async () => {
    stubFeed({ count: 3, items: [gap()] })
    render(<GapBell />)
    expect(await screen.findByText('3')).toBeInTheDocument()
    expect(screen.getByLabelText('Gap knowledge (3 belum ditangani)')).toBeInTheDocument()
  })

  it('tanpa angka sama sekali saat tidak ada gap', async () => {
    stubFeed({ count: 0, items: [] })
    render(<GapBell />)
    await waitFor(() => expect(screen.getByLabelText('Gap knowledge')).toBeInTheDocument())
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('menulis 99+ di atas seratus', async () => {
    stubFeed({ count: 128, items: [] })
    render(<GapBell />)
    expect(await screen.findByText('99+')).toBeInTheDocument()
  })

  it('membuka daftar berisi kontak, topik, pertanyaan, dan tautan lihat semua', async () => {
    stubFeed({ count: 1, items: [gap()] })
    render(<GapBell />)

    fireEvent.click(await screen.findByLabelText('Gap knowledge (1 belum ditangani)'))

    expect(screen.getByText(/Bruno/)).toBeInTheDocument()
    expect(screen.getByText('berapa harga ATV sekarang?')).toBeInTheDocument()
    expect(screen.getByText('Jawaban tanpa sumber')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Lihat semua' })).toHaveAttribute('href', '/settings/knowledge-gaps')
  })

  it('item menautkan ke percakapan dan pesannya', async () => {
    stubFeed({ count: 2, items: [gap(), gap({ id: 'gap_2', messageId: null, conversationId: 'conv_2', contactName: 'Ayu' })] })
    render(<GapBell />)
    fireEvent.click(await screen.findByLabelText('Gap knowledge (2 belum ditangani)'))

    const links = screen.getAllByRole('link')
    expect(links[0]).toHaveAttribute('href', '/inbox?conversation=conv_1&message=msg_bot')
    expect(links[1]).toHaveAttribute('href', '/inbox?conversation=conv_2')
  })

  it('menaikkan angkanya saat event knowledge.gap tiba, tanpa muat ulang halaman', async () => {
    const fetchMock = stubFeed({ count: 1, items: [gap()] })
    render(<GapBell />)
    await screen.findByText('1')

    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ count: 2, items: [gap()] }) }) as Response)
    act(() => {
      FakeEventSource.instances[0].emit({ type: 'knowledge.gap', conversationId: 'conv_9' })
    })

    expect(await screen.findByText('2')).toBeInTheDocument()
  })

  it('mengabaikan event lain', async () => {
    const fetchMock = stubFeed({ count: 1, items: [gap()] })
    render(<GapBell />)
    await screen.findByText('1')
    const callsBefore = fetchMock.mock.calls.length

    act(() => {
      FakeEventSource.instances[0].emit({ type: 'message.created', conversationId: 'conv_9', message: { id: 'm1' } })
    })

    expect(fetchMock.mock.calls.length).toBe(callsBefore)
  })

  it('menutup daftar saat Escape ditekan', async () => {
    stubFeed({ count: 1, items: [gap()] })
    render(<GapBell />)
    fireEvent.click(await screen.findByLabelText('Gap knowledge (1 belum ditangani)'))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
