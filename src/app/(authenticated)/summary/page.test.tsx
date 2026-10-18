import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import DailySummaryPage from './page'

let mockSearchParams = new URLSearchParams()
const replace = vi.fn()

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace }),
}))

const payload = {
  version: 1,
  date: '2026-09-21',
  windowStart: '2026-09-20T17:00:00.000Z',
  windowEnd: '2026-09-21T17:00:00.000Z',
  generatedAt: '2026-09-21T17:03:00.000Z',
  thresholds: { unrepliedMinMs: 3600000, dormantMinMs: 172800000, lookbackMs: 1209600000 },
  counts: { activeConversations: 5, inbound: 20, outbound: 18, newConversations: 1, reviewed: 5, reviewFailed: 1 },
  filteredOut: { unreplied: 2, dormant: 0 },
  unreplied: [],
  dormant: [],
  newLeads: [],
  handoffs: [],
  gaps: { newCount: 0, openTotal: 4, byReason: [], byTopic: [], items: [] },
  conversations: [],
}

const summaryRow = {
  date: '2026-09-21',
  status: 'PARTIAL',
  model: 'gemma4:31b-cloud',
  startedAt: '2026-09-21T17:00:00.000Z',
  finishedAt: '2026-09-21T17:03:00.000Z',
  error: null,
  payload,
}

function summaryResponse(summary: unknown, items: Record<string, unknown> = {}) {
  return {
    dates: summary
      ? [
          { date: '2026-09-21', status: 'PARTIAL' },
          { date: '2026-09-20', status: 'DONE' },
        ]
      : [],
    summary,
    items,
  }
}

/** Ringkasan 20 September: satu percakapan belum dibalas yang SEKARANG sudah ditindaklanjuti. */
const pastPayload = {
  ...payload,
  date: '2026-09-20',
  counts: { activeConversations: 3, inbound: 9, outbound: 8, newConversations: 1, reviewed: 3, reviewFailed: 0 },
  unreplied: [
    {
      conversationId: 'conv_old',
      contactName: 'Bima',
      pipelineStage: 'new',
      lastMessageAt: '2026-09-20T10:00:00.000Z',
      waitingMs: 1,
      snippet: 'Masih ada slot?',
      review: null,
    },
  ],
}
const pastResponse = summaryResponse(
  { ...summaryRow, date: '2026-09-20', status: 'DONE', payload: pastPayload },
  { conv_old: { id: 'si_old', kind: 'REPLY', state: 'DONE', dueAt: null, closedReason: 'REPLIED', note: null, closedAt: null } }
)

const openItem = {
  id: 'item_1',
  conversationId: 'conv_1',
  contactName: 'Anna',
  pipelineStage: 'new',
  kind: 'REPLY',
  state: 'OPEN',
  anchorAt: '2026-09-21T14:00:00.000Z',
  anchorMessageId: 'msg_in_1',
  snippet: 'Berapa harga Ijen untuk 2 orang?',
  review: null,
  handoff: false,
  newLead: false,
  openedOn: '2026-09-21',
  dueAt: null,
}

function stubFetch({
  role,
  summary = summaryResponse(summaryRow),
  queue = { open: [openItem], scheduled: [], openGapTotal: 4 },
}: {
  role: 'ADMIN' | 'AGENT'
  summary?: unknown
  queue?: unknown
}) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url)}`
    const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json }) as Response
    if (key === 'GET /api/session') return ok({ role, name: 'Tester' })
    if (key === 'GET /api/daily-summary') return ok(summary)
    if (key === 'GET /api/daily-summary?date=2026-09-20') return ok(pastResponse)
    if (key === 'GET /api/summary-items') return ok(queue)
    if (key === 'POST /api/daily-summary/generate') return ok({ date: '2026-09-21', status: 'DONE' })
    throw new Error(`fetch tak terduga: ${key}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function callsTo(fetchMock: ReturnType<typeof stubFetch>, url: string) {
  return fetchMock.mock.calls.filter(([u, init]) => String(u) === url && (init?.method ?? 'GET') === 'GET').length
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  mockSearchParams = new URLSearchParams()
  replace.mockClear()
})

describe('DailySummaryPage', () => {
  it('menampilkan antrean dan status ringkasan terbaru, tanpa tab atau kartu statistik', async () => {
    stubFetch({ role: 'AGENT' })
    render(<DailySummaryPage />)

    expect(await screen.findByRole('link', { name: 'Balas' })).toHaveAttribute('href', '/inbox?conversation=conv_1&message=msg_in_1')
    expect(screen.getByRole('heading', { name: 'Summary Harian' })).toBeInTheDocument()
    expect(
      screen.getByText('Antrean tindakan dari ringkasan chat harian. Item selesai saat dibalas, dijadwalkan, atau dilepas.')
    ).toBeInTheDocument()
    expect(await screen.findByText('Status: Sebagian')).toBeInTheDocument()
    expect(screen.getByText('Model: gemma4:31b-cloud')).toBeInTheDocument()
    expect(screen.getByText(/1 percakapan gagal dicek LLM/)).toBeInTheDocument()

    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByText('Pesan masuk')).not.toBeInTheDocument()
    // Default = antrean; tanpa query `date`.
    expect(screen.getByRole('combobox', { name: 'Pilih tampilan' })).toHaveValue('')
  })

  it('pemilih tampilan: antrean dulu, lalu satu opsi per tanggal', async () => {
    stubFetch({ role: 'AGENT' })
    render(<DailySummaryPage />)
    const select = screen.getByRole('combobox', { name: 'Pilih tampilan' })
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(3))
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Antrean sekarang',
      'Senin, 21 September 2026',
      'Minggu, 20 September 2026',
    ])
  })

  it('memilih tanggal menulis ?date= ke URL, memuat tanggal itu, dan menampilkan status sekarang', async () => {
    const fetchMock = stubFetch({ role: 'AGENT' })
    render(<DailySummaryPage />)
    await screen.findByRole('link', { name: 'Balas' })
    const select = screen.getByRole('combobox', { name: 'Pilih tampilan' })
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(3))

    fireEvent.change(select, { target: { value: '2026-09-20' } })

    expect(replace).toHaveBeenCalledWith('/summary?date=2026-09-20', { scroll: false })
    const card = await screen.findByRole('listitem', { name: 'Bima' })
    expect(callsTo(fetchMock, '/api/daily-summary?date=2026-09-20')).toBe(1)
    expect(within(card).getByText('Belum dibalas')).toBeInTheDocument()
    expect(within(card).getByText('Sudah ditindaklanjuti')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Buka chat' })).toHaveAttribute('href', '/inbox?conversation=conv_old')
    expect(screen.getByText('3 aktif · 9 masuk · 8 keluar · 1 kontak baru')).toBeInTheDocument()
    expect(screen.getByText('Status: Selesai')).toBeInTheDocument()
    expect(screen.getByText(/^Ringkasan:/)).toBeInTheDocument()
    // Antrean tidak tampil di tampilan tanggal.
    expect(screen.queryByRole('link', { name: 'Balas' })).not.toBeInTheDocument()

    fireEvent.change(select, { target: { value: '' } })
    expect(replace).toHaveBeenLastCalledWith('/summary', { scroll: false })
    expect(await screen.findByRole('link', { name: 'Balas' })).toBeInTheDocument()
  })

  it('?date= di URL langsung membuka tanggal itu; Buat ulang membuat ulang tanggal itu', async () => {
    mockSearchParams = new URLSearchParams('date=2026-09-20')
    const fetchMock = stubFetch({ role: 'ADMIN' })
    render(<DailySummaryPage />)

    expect(await screen.findByRole('listitem', { name: 'Bima' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Pilih tampilan' })).toHaveValue('2026-09-20')
    expect(callsTo(fetchMock, '/api/daily-summary')).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Buat ulang' }))
    await waitFor(() => expect(screen.getByText('Ringkasan selesai dibuat ulang.')).toBeInTheDocument())
    const post = fetchMock.mock.calls.find(([url, init]) => String(url) === '/api/daily-summary/generate' && init?.method === 'POST')
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ date: '2026-09-20' })
    expect(callsTo(fetchMock, '/api/daily-summary?date=2026-09-20')).toBe(2)
  })

  it('tautan gap knowledge hanya tampil bila ada yang terbuka', async () => {
    stubFetch({ role: 'AGENT' })
    render(<DailySummaryPage />)
    expect(await screen.findByRole('link', { name: '4 gap knowledge terbuka →' })).toHaveAttribute('href', '/settings/knowledge-gaps')
    cleanup()

    stubFetch({ role: 'AGENT', queue: { open: [], scheduled: [], openGapTotal: 0 } })
    render(<DailySummaryPage />)
    expect(await screen.findByText('Tidak ada item terbuka. Semua sudah dibalas, dijadwalkan, atau dilepas.')).toBeInTheDocument()
    expect(screen.queryByText(/gap knowledge terbuka/)).not.toBeInTheDocument()
  })

  it('tombol Buat ulang hanya untuk admin', async () => {
    stubFetch({ role: 'AGENT' })
    render(<DailySummaryPage />)
    await screen.findByRole('link', { name: 'Balas' })
    expect(screen.queryByRole('button', { name: 'Buat ulang' })).not.toBeInTheDocument()
  })

  it('admin membuat ulang ringkasan terbaru, lalu antrean dan lencana menu dimuat ulang', async () => {
    const fetchMock = stubFetch({ role: 'ADMIN' })
    const events = vi.fn()
    window.addEventListener('summary-items:changed', events)
    render(<DailySummaryPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Buat ulang' }))

    await waitFor(() => expect(screen.getByText('Ringkasan selesai dibuat ulang.')).toBeInTheDocument())
    const post = fetchMock.mock.calls.find(([url, init]) => String(url) === '/api/daily-summary/generate' && init?.method === 'POST')
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ date: '2026-09-21' })
    await waitFor(() => expect(callsTo(fetchMock, '/api/summary-items')).toBe(2))
    expect(callsTo(fetchMock, '/api/daily-summary')).toBe(2)
    expect(events).toHaveBeenCalledTimes(1)
    window.removeEventListener('summary-items:changed', events)
  })

  it('tanpa ringkasan sama sekali, admin ditawari membuat ringkasan kemarin', async () => {
    stubFetch({ role: 'ADMIN', summary: summaryResponse(null), queue: { open: [], scheduled: [], openGapTotal: 0 } })
    render(<DailySummaryPage />)
    expect(await screen.findByText(/Belum ada ringkasan\./)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Buat ringkasan kemarin' })).toBeInTheDocument()
  })

  it('kegagalan memuat antrean tampil sebagai pesan error', async () => {
    stubFetch({ role: 'AGENT' })
    const base = vi.mocked(fetch)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url) === '/api/summary-items') {
          return { ok: false, status: 500, json: async () => ({ error: 'Gagal memuat antrean' }) } as Response
        }
        return base(url, init)
      })
    )
    render(<DailySummaryPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memuat antrean')
  })
})
