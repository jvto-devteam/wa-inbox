import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import KnowledgeGapsPage from './page'

function gap(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gap_1',
    conversationId: 'conv_1',
    contactName: 'Bruno',
    topic: 'price',
    reason: 'reply_unsourced',
    messageText: 'berapa harga ATV sekarang?',
    createdAt: '2026-09-12T02:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  }
}

function stubFetch(gaps: unknown[], resolveBody: unknown = { id: 'gap_1', resolvedAt: '2026-09-12T03:00:00.000Z' }) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url)}`
    if (key.startsWith('GET /api/bot/knowledge-gaps')) {
      return { ok: true, status: 200, json: async () => gaps } as Response
    }
    if (key === 'POST /api/inbox/gaps/gap_1/resolve') {
      return { ok: true, status: 200, json: async () => resolveBody } as Response
    }
    throw new Error(`fetch tak terduga: ${key}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('KnowledgeGapsPage — status dan penandaan', () => {
  it('memberi nama alasan baru dan menawarkan tombol tandai selesai', async () => {
    stubFetch([gap()])

    render(<KnowledgeGapsPage />)

    expect(await screen.findByText('Jawaban tanpa sumber')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tandai selesai' })).toBeInTheDocument()
  })

  it('memberi nama reason saat bot menunda sub-pertanyaan karena knowledge kurang', async () => {
    stubFetch([gap({ reason: 'reply_deferred_knowledge' })])

    render(<KnowledgeGapsPage />)

    expect(await screen.findByText('Butuh knowledge tambahan')).toBeInTheDocument()
  })

  it('menandai selesai dan menggantinya dengan lencana, tanpa memuat ulang daftar', async () => {
    const fetchMock = stubFetch([gap()])

    render(<KnowledgeGapsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Tandai selesai' }))

    expect(await screen.findByText('Selesai')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tandai selesai' })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/inbox/gaps/gap_1/resolve')).toBe(true)
  })

  it('baris yang sudah selesai langsung tampil dengan lencana', async () => {
    stubFetch([gap({ resolvedAt: '2026-09-11T01:00:00.000Z' })])

    render(<KnowledgeGapsPage />)

    expect(await screen.findByText('Selesai')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tandai selesai' })).not.toBeInTheDocument()
  })

  it('kegagalan penandaan membiarkan tombolnya bisa ditekan lagi', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${String(url)}`
      if (key.startsWith('GET /api/bot/knowledge-gaps')) {
        return { ok: true, status: 200, json: async () => [gap()] } as Response
      }
      return { ok: false, status: 500, json: async () => ({ error: 'Gagal menandai gap selesai' }) } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<KnowledgeGapsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Tandai selesai' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Tandai selesai' })).not.toBeDisabled())
    expect(screen.queryByText('Selesai')).not.toBeInTheDocument()
  })
})
