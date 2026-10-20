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

const DETAIL_LABEL = 'Detail (nama hotel / nomor flight / stasiun / lokasi)'

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
    await screen.findByRole('button', { name: 'Tolak' })
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

  it('card shows booking code and trip dates', async () => {
    mockFetch(() => response({ writeEnabled: true }))
    render(<BookingActionsSection conversationId="c1" />)
    const card = await screen.findByRole('listitem', { name: 'CHANGE: Pickup' })
    expect(within(card).getByText('JVTO-77 · 2026-11-01 – 2026-11-02')).toBeInTheDocument()
  })

  it('Setujui sends execute with the (corrected) value; the field is prefilled with the proposal', async () => {
    let current = response({ writeEnabled: true, actions: [{ ...base, field: 'pickup_time', proposedValue: '09:00', oldValue: '10:30' }] })
    const fn = mockFetch(() => current)
    render(<BookingActionsSection conversationId="c1" />)
    const input = await screen.findByLabelText('Nilai yang ditulis')
    expect(input).toHaveValue('09:00')
    expect(input.className).toContain('min-h-11')
    fireEvent.change(input, { target: { value: '09:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Setujui' }))
    current = response({ writeEnabled: true, actions: [] })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Setujui' })).not.toBeInTheDocument())
    const patch = fn.mock.calls.find(([, init]) => init?.method === 'PATCH')
    expect(patch?.[0]).toBe('/api/booking-actions/a1')
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ op: 'execute', value: '09:30' })
  })

  it('point cards offer the known points as a select', async () => {
    mockFetch(() => response({ writeEnabled: true }))
    render(<BookingActionsSection conversationId="c1" />)
    const select = await screen.findByLabelText('Nilai yang ditulis')
    expect(select.tagName).toBe('SELECT')
    expect(select).toHaveValue('Surabaya Hotel')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toContain('Bali Hotel')
  })

  it('Setujui and the input are disabled while executing, and the server error is shown', async () => {
    let resolvePatch: (r: Response) => void = () => undefined
    const fn = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return new Promise<Response>((r) => { resolvePatch = r })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(response({ writeEnabled: true })) } as Response)
    })
    vi.stubGlobal('fetch', fn)
    render(<BookingActionsSection conversationId="c1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Setujui' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Menulis…' })).toBeDisabled())
    expect(screen.getByLabelText('Nilai yang ditulis')).toBeDisabled()
    resolvePatch({ ok: false, status: 502, json: () => Promise.resolve({ error: 'Backoffice menolak perubahan' }) } as Response)
    expect(await screen.findByRole('alert')).toHaveTextContent('Backoffice menolak perubahan')
    expect(screen.getByRole('button', { name: 'Setujui' })).toBeEnabled()
  })

  it('fields without a write path (R16) show Tolak/Selesai but no Setujui and no input', async () => {
    const fn = mockFetch(() => response({ writeEnabled: true, actions: [{ ...base, field: 'note', proposedValue: 'vegetarian', oldValue: null }] }))
    render(<BookingActionsSection conversationId="c1" />)
    await screen.findByRole('button', { name: 'Tolak' })
    expect(screen.queryByRole('button', { name: 'Setujui' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Nilai yang ditulis')).not.toBeInTheDocument()
    expect(screen.getByText(/Ubah di backoffice lalu tandai Selesai/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Selesai' }))
    await waitFor(() => expect(fn.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(true))
    const patch = fn.mock.calls.find(([, i]) => i?.method === 'PATCH')
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ op: 'done' })
  })

  it('R17/R20: point card prefills its detail input from the open detail card; time cards are not companions; last error shown', async () => {
    mockFetch(() =>
      response({
        writeEnabled: true,
        actions: [
          { ...base, lastError: 'Isi detail titik baru dulu' },
          { ...base, id: 'd1', field: 'pickup_detail', proposedValue: 'Hotel Tunjungan', oldValue: 'GA 300' },
          { ...base, id: 't1', field: 'pickup_time', proposedValue: '08:00', oldValue: '10:30' },
          { ...base, id: 'x1', field: 'drop_detail', proposedValue: 'Hotel Y', oldValue: null },
        ],
      })
    )
    render(<BookingActionsSection conversationId="c1" />)
    const card = await screen.findByRole('listitem', { name: 'CHANGE: Pickup' })
    expect(within(card).getByLabelText(DETAIL_LABEL)).toHaveValue('Hotel Tunjungan')
    expect(within(card).getByText('Kartu Detail pickup ikut ditulis dan ditutup.')).toBeInTheDocument()
    expect(within(card).queryByText(/08:00|Hotel Y/)).not.toBeInTheDocument()
    expect(within(card).getByText('Gagal terakhir: Isi detail titik baru dulu')).toBeInTheDocument()
    const detailCard = screen.getByRole('listitem', { name: 'CHANGE: Detail pickup' })
    expect(within(detailCard).getByText('Ditulis bersama: Pickup → Surabaya Hotel')).toBeInTheDocument()
    const timeCard = screen.getByRole('listitem', { name: 'CHANGE: Jam pickup' })
    expect(within(timeCard).queryByText(/Ditulis bersama/)).not.toBeInTheDocument()
  })

  it('R19: point card sends the detail with execute; empty detail is not sent', async () => {
    const fn = mockFetch(() => response({ writeEnabled: true }))
    render(<BookingActionsSection conversationId="c1" />)
    const detail = await screen.findByLabelText(DETAIL_LABEL)
    expect(detail).toHaveValue('')
    expect(detail.className).toContain('min-h-11')
    fireEvent.click(screen.getByRole('button', { name: 'Setujui' }))
    await waitFor(() => expect(fn.mock.calls.filter(([, i]) => i?.method === 'PATCH')).toHaveLength(1))
    expect(JSON.parse(String(fn.mock.calls.find(([, i]) => i?.method === 'PATCH')?.[1]?.body))).toEqual({ op: 'execute', value: 'Surabaya Hotel' })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Setujui' })).toBeEnabled())
    fireEvent.change(screen.getByLabelText(DETAIL_LABEL), { target: { value: 'Hotel Majapahit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Setujui' }))
    await waitFor(() => expect(fn.mock.calls.filter(([, i]) => i?.method === 'PATCH')).toHaveLength(2))
    const second = fn.mock.calls.filter(([, i]) => i?.method === 'PATCH')[1]
    expect(JSON.parse(String(second[1]?.body))).toEqual({ op: 'execute', value: 'Surabaya Hotel', detail: 'Hotel Majapahit' })
  })

  it('non-point cards have no detail input', async () => {
    mockFetch(() => response({ writeEnabled: true, actions: [{ ...base, field: 'pickup_time', proposedValue: '09:00' }] }))
    render(<BookingActionsSection conversationId="c1" />)
    await screen.findByLabelText('Nilai yang ditulis')
    expect(screen.queryByLabelText(DETAIL_LABEL)).not.toBeInTheDocument()
  })
})

