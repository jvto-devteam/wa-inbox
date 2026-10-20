import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { BookingActionsSection } from './BookingActionsSection'
import { SUMMARY_ITEMS_CHANGED } from '@/lib/summary-items/events'
import type { BookingActionsResponse, BookingActionView } from '@/lib/booking-actions/view'

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

const base: BookingActionView = {
  id: 'a1', conversationId: 'c1', type: 'CHANGE', field: 'pickup_point', tier: 'AI',
  proposedValue: 'Surabaya Hotel', oldValue: 'Surabaya Airport', sourceMessageId: 'm9',
  createdAt: '2026-10-20T00:00:00Z',
}

function response(over: Partial<BookingActionsResponse> = {}): BookingActionsResponse {
  return {
    booking: { id: '77', code: 'JVTO-77', start: '2026-11-01', end: '2026-11-02' },
    actions: [base],
    history: [],
    writeEnabled: false,
    ...over,
  }
}

function mockFetch(get: () => BookingActionsResponse, patch: { ok: boolean; status?: number; body?: unknown } = { ok: true }) {
  const fn = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      return Promise.resolve({ ok: patch.ok, status: patch.status ?? 200, json: () => Promise.resolve(patch.body ?? {}) } as Response)
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(get()) } as Response)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

describe('BookingActionsSection', () => {
  it('renders single column at 360px with 44px buttons', async () => {
    mockFetch(() => response())
    render(<BookingActionsSection conversationId="c1" />)
    await screen.findByText(/Surabaya Hotel/)
    const list = screen.getAllByRole('list')[0]
    expect(list.className).toContain('flex-col')
    expect(list.className).not.toMatch(/grid-cols|flex-row/)
    for (const name of ['Setujui', 'Tolak']) {
      expect(screen.getByRole('button', { name }).className).toContain('min-h-11')
    }
    expect(screen.getByText(/JVTO-77/)).toBeInTheDocument()
    expect(screen.getByText(/2026-11-01/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Lihat pesan sumber' })).toHaveAttribute('href', '/inbox?conversation=c1&message=m9')
  })

  it('execute disabled when write not configured', async () => {
    mockFetch(() => response({ writeEnabled: false }))
    render(<BookingActionsSection conversationId="c1" />)
    const approve = await screen.findByRole('button', { name: 'Setujui' })
    expect(approve).toBeDisabled()
    expect(screen.getByText('Aktif setelah sambungan ke my-booking tersedia')).toBeInTheDocument()
  })

  it('enables Setujui when the server says write is enabled', async () => {
    mockFetch(() => response({ writeEnabled: true }))
    render(<BookingActionsSection conversationId="c1" />)
    expect(await screen.findByRole('button', { name: 'Setujui' })).toBeEnabled()
    expect(screen.queryByText(/Aktif setelah sambungan/)).not.toBeInTheDocument()
  })

  it('reject calls PATCH and refreshes', async () => {
    let current = response()
    const fn = mockFetch(() => current)
    const changed = vi.fn()
    window.addEventListener(SUMMARY_ITEMS_CHANGED, changed)
    render(<BookingActionsSection conversationId="c1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Tolak' }))
    current = response({ actions: [] })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Tolak' })).not.toBeInTheDocument())
    const patch = fn.mock.calls.find(([, init]) => init?.method === 'PATCH')
    expect(patch?.[0]).toBe('/api/booking-actions/a1')
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ op: 'reject' })
    expect(changed).toHaveBeenCalled()
    window.removeEventListener(SUMMARY_ITEMS_CHANGED, changed)
  })

  it('shows the server error when PATCH fails (409)', async () => {
    mockFetch(() => response(), { ok: false, status: 409, body: { error: 'Tindakan sudah ditutup' } })
    render(<BookingActionsSection conversationId="c1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Tolak' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Tindakan sudah ditutup')
  })

  it('shows vendor notices for tshirt and BALI', async () => {
    mockFetch(() =>
      response({
        actions: [
          { ...base, id: 't', field: 'tshirt_sizes', proposedValue: 'M, L', oldValue: 'M' },
          { ...base, id: 'b', tier: 'BALI', proposedValue: 'Bali Hotel' },
        ],
      })
    )
    render(<BookingActionsSection conversationId="c1" />)
    expect(await screen.findByText('Vendor kaos akan diberi tahu.')).toBeInTheDocument()
    expect(screen.getByText('Vendor transport Bali akan diberi tahu.')).toBeInTheDocument()
    expect(screen.queryByText(/add-on|biaya/i)).not.toBeInTheDocument()
  })

  it('MISMATCH shows chat vs booking and dismisses via "Chat yang salah"', async () => {
    const fn = mockFetch(() =>
      response({ actions: [{ ...base, id: 'm', type: 'MISMATCH', field: 'total_pax', proposedValue: 5, oldValue: '4' }] })
    )
    render(<BookingActionsSection conversationId="c1" />)
    expect(await screen.findByText(/Chat: 5 orang · Booking: 4/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Chat yang salah' }))
    await waitFor(() => expect(fn.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(true))
    const patch = fn.mock.calls.find(([, i]) => i?.method === 'PATCH')
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ op: 'dismiss' })
  })

  it('TASK shows impact (or unavailable) with Selesai / Tidak perlu', async () => {
    const task = { ...base, id: 'k', type: 'TASK' as const, field: 'travel_date', proposedValue: '2026-11-05', oldValue: '2026-11-01' }
    mockFetch(() =>
      response({
        actions: [
          { ...task, impact: { crewClashes: ['Andi'], hotelNights: [], medicalCheckupDate: null } },
          { ...task, id: 'k2', impact: { crewClashes: [], hotelNights: [], medicalCheckupDate: null, unavailable: true } },
        ],
      })
    )
    render(<BookingActionsSection conversationId="c1" />)
    expect(await screen.findByText('Bentrok crew: Andi')).toBeInTheDocument()
    expect(screen.getByText('Dampak tidak bisa dihitung')).toBeInTheDocument()
    expect(screen.getAllByText('Ubah di backoffice. Kartu tertutup sendiri.')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Selesai' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Tidak perlu' })).toHaveLength(2)
  })

  it('history lists events newest first with actor names', async () => {
    mockFetch(() =>
      response({
        actions: [],
        history: [
          { id: 'e2', event: 'REJECTED', actor: 'ACCOUNT', accountName: 'Rina', reason: null, oldValue: null, newValue: null, createdAt: '2026-10-20T02:00:00Z' },
          { id: 'e1', event: 'CREATED', actor: 'BOT', accountName: null, reason: null, oldValue: 'A', newValue: 'B', createdAt: '2026-10-20T01:00:00Z' },
        ],
      })
    )
    render(<BookingActionsSection conversationId="c1" />)
    await screen.findByText(/Riwayat \(2\)/)
    const items = within(screen.getByRole('list', { name: 'Riwayat tindakan booking' })).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Ditolak · Rina')
    expect(items[1]).toHaveTextContent('Dibuat · Bot')
  })

  it('reloads on booking-actions.changed for this conversation only', async () => {
    const fn = mockFetch(() => response())
    render(<BookingActionsSection conversationId="c1" />)
    await screen.findByRole('button', { name: 'Tolak' })
    const getCalls = () => fn.mock.calls.filter(([, i]) => !i).length
    const before = getCalls()
    act(() => FakeEventSource.instances[0].emit({ type: 'booking-actions.changed', conversationId: 'other' }))
    expect(getCalls()).toBe(before)
    act(() => FakeEventSource.instances[0].emit({ type: 'booking-actions.changed', conversationId: 'c1' }))
    await waitFor(() => expect(getCalls()).toBe(before + 1))
  })

  it('renders nothing when there are no actions and no history', async () => {
    mockFetch(() => response({ actions: [], history: [] }))
    const { container } = render(<BookingActionsSection conversationId="c1" />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
