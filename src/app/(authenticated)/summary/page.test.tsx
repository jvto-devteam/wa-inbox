import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import DailySummaryPage from './page'

const review = {
  status: 'perlu_tindakan',
  alasan: 'Pelanggan menanyakan harga dan belum dijawab.',
  jenisKontak: 'calon_tamu',
  topik: 'Paket Ijen 2 orang',
  pertanyaan: ['Berapa harga untuk 2 orang?'],
  poinPenting: ['3 Oktober'],
  statusAgen: 'Belum ada balasan.',
  langkahBerikut: 'Kirim harga paket Ijen.',
}

const payload = {
  version: 1,
  date: '2026-09-21',
  windowStart: '2026-09-20T17:00:00.000Z',
  windowEnd: '2026-09-21T17:00:00.000Z',
  generatedAt: '2026-09-21T17:03:00.000Z',
  thresholds: { unrepliedMinMs: 3600000, dormantMinMs: 172800000, lookbackMs: 1209600000 },
  counts: { activeConversations: 5, inbound: 20, outbound: 18, newConversations: 1, reviewed: 5, reviewFailed: 1 },
  filteredOut: { unreplied: 2, dormant: 0 },
  unreplied: [
    {
      conversationId: 'conv_1',
      contactName: 'Anna',
      pipelineStage: 'new',
      lastMessageAt: '2026-09-21T14:00:00.000Z',
      lastMessageId: 'msg_in_1',
      waitingMs: 3 * 3600000,
      snippet: 'Berapa harga Ijen untuk 2 orang?',
      review,
    },
  ],
  dormant: [
    {
      conversationId: 'conv_2',
      contactName: 'Marco',
      pipelineStage: 'nego',
      lastMessageAt: '2026-09-18T17:00:00.000Z',
      silentMs: 72 * 3600000,
      snippet: 'Harga paket 3D2N ...',
      review: null,
    },
  ],
  newLeads: [],
  handoffs: [],
  gaps: { newCount: 0, openTotal: 4, byReason: [], byTopic: [], items: [] },
  conversations: [{ conversationId: 'conv_1', contactName: 'Anna', pipelineStage: 'new', inbound: 3, outbound: 0, review }],
}

function response(summary: unknown) {
  return { dates: summary ? [{ date: '2026-09-21', status: 'PARTIAL' }] : [], summary }
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

function stubFetch({ role, body }: { role: 'ADMIN' | 'AGENT'; body: unknown }) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url)}`
    const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json }) as Response
    if (key === 'GET /api/session') return ok({ role, name: 'Tester' })
    if (key.startsWith('GET /api/daily-summary')) return ok(body)
    if (key === 'POST /api/daily-summary/generate') return ok({ date: '2026-09-21', status: 'DONE' })
    throw new Error(`fetch tak terduga: ${key}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('DailySummaryPage', () => {
  it('menampilkan bagian-bagian ringkasan dari payload tersimpan', async () => {
    stubFetch({ role: 'AGENT', body: response(summaryRow) })
    render(<DailySummaryPage />)

    // Tab pertama terbuka: Belum dibalas.
    expect(await screen.findByText('menunggu 3 jam')).toBeInTheDocument()
    expect(screen.getByText(/2 percakapan lain disaring/)).toBeInTheDocument()
    expect(screen.getByText(/1 percakapan gagal dicek LLM/)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Anna' })[0]).toHaveAttribute('href', '/inbox?conversation=conv_1')
    // Bagian lain tidak dirender sampai tabnya dipilih.
    expect(screen.queryByText('diam 3 hari')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Pelanggan diam/ }))
    expect(screen.getByText('diam 3 hari')).toBeInTheDocument()
    expect(screen.getAllByText('Belum dicek LLM').length).toBeGreaterThan(0)
    expect(screen.getByRole('tab', { name: /Pelanggan diam/ })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('tab', { name: /Ringkasan percakapan/ }))
    expect(screen.getByText('Berapa harga untuk 2 orang?')).toBeInTheDocument()
  })

  it('setiap tab menyebut jumlah isinya', async () => {
    stubFetch({ role: 'AGENT', body: response(summaryRow) })
    render(<DailySummaryPage />)
    expect(await screen.findByRole('tab', { name: 'Belum dibalas, 1' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Lead baru, 0' })).toBeInTheDocument()
  })

  it('setiap bagian punya tombol tindakan ke Inbox', async () => {
    stubFetch({ role: 'AGENT', body: response(summaryRow) })
    render(<DailySummaryPage />)
    // Belum dibalas: pesan pelanggan yang menunggu ikut tersorot.
    expect(await screen.findByRole('link', { name: 'Balas' })).toHaveAttribute('href', '/inbox?conversation=conv_1&message=msg_in_1')
    // Pelanggan diam dari baris lama tanpa id pesan: tetap membuka percakapannya.
    fireEvent.click(screen.getByRole('tab', { name: /Pelanggan diam/ }))
    expect(screen.getByRole('link', { name: 'Follow up' })).toHaveAttribute('href', '/inbox?conversation=conv_2')
    fireEvent.click(screen.getByRole('tab', { name: /Ringkasan percakapan/ }))
    expect(screen.getByRole('link', { name: 'Buka chat' })).toHaveAttribute('href', '/inbox?conversation=conv_1')
  })

  it('tombol Buat ulang hanya untuk admin', async () => {
    stubFetch({ role: 'AGENT', body: response(summaryRow) })
    render(<DailySummaryPage />)
    await screen.findByText('menunggu 3 jam')
    expect(screen.queryByRole('button', { name: 'Buat ulang' })).not.toBeInTheDocument()
  })

  it('admin membuat ulang tanggal yang sedang dibuka', async () => {
    const fetchMock = stubFetch({ role: 'ADMIN', body: response(summaryRow) })
    render(<DailySummaryPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Buat ulang' }))

    await waitFor(() => expect(screen.getByText('Ringkasan selesai dibuat ulang.')).toBeInTheDocument())
    const post = fetchMock.mock.calls.find(([url, init]) => String(url) === '/api/daily-summary/generate' && init?.method === 'POST')
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ date: '2026-09-21' })
  })

  it('keadaan kosong sebelum job pertama', async () => {
    stubFetch({ role: 'AGENT', body: response(null) })
    render(<DailySummaryPage />)
    expect(await screen.findByText('Belum ada ringkasan.')).toBeInTheDocument()
  })
})
