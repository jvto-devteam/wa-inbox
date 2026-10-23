import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { AiOffice } from './AiOffice'

// WebGL tidak ada di jsdom: adegan 3D diganti stub yang mencatat status meja yang diterimanya.
vi.mock('./Office3D', () => ({
  default: ({ agents, onSelect }: { agents: Array<{ key: string; name: string; mode: string }>; onSelect: (k: string) => void }) => (
    <ul aria-label="Adegan 3D">
      {agents.map((a) => (
        <li key={a.key}>
          <button type="button" onClick={() => onSelect(a.key)}>{`${a.key}:${a.mode}`}</button>
        </li>
      ))}
    </ul>
  ),
}))

let onmessage: ((e: { data: string }) => void) | null = null
class FakeES {
  set onmessage(fn: (e: { data: string }) => void) {
    onmessage = fn
  }
  close() {}
}

function stub() {
  vi.stubGlobal('EventSource', FakeES)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    agents: [
      { agent: 'topik', lastAt: null, lastLabel: null, lastConversationId: null, todayCount: 0 },
      { agent: 'bot', lastAt: '2026-10-23T01:00:00.000Z', lastLabel: 'Menjawab dari knowledge base', lastConversationId: 'c1', todayCount: 4 },
      { agent: 'booking', lastAt: null, lastLabel: null, lastConversationId: null, todayCount: 0 },
      { agent: 'ringkasan', lastAt: null, lastLabel: null, lastConversationId: null, todayCount: 1 },
    ],
  }), { status: 200 })))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('AiOffice', () => {
  it('empat asisten tampil dengan status awal dari API', async () => {
    stub()
    render(<AiOffice />)
    const roster = screen.getByRole('list', { name: 'Asisten AI' })
    expect(within(roster).getAllByRole('listitem')).toHaveLength(4)
    expect(await within(roster).findByText('Hari ini: 4 pekerjaan')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /Kantor AI/ })).toBeInTheDocument()
    expect(await screen.findByText('bot:idle')).toBeInTheDocument()
  })

  it('event live menggerakkan meja: label balon, kartu status, log, lalu kembali siaga', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    stub()
    render(<AiOffice />)
    expect(onmessage).not.toBeNull()
    act(() => onmessage!({ data: JSON.stringify({ type: 'ai.activity', agent: 'ringkasan', state: 'mulai', label: 'Meringkas chat & poin penting', conversationId: 'c9', at: new Date().toISOString() }) }))
    expect(screen.getAllByText('Meringkas chat & poin penting').length).toBeGreaterThan(0)
    const log = screen.getByRole('region', { name: 'Kegiatan terbaru' })
    expect(within(log).getByText('Asep')).toBeInTheDocument()
    expect(within(log).getByRole('link', { name: 'Lihat chat' })).toHaveAttribute('href', '/inbox?conversation=c9')

    act(() => onmessage!({ data: JSON.stringify({ type: 'ai.activity', agent: 'ringkasan', state: 'selesai', label: 'Ringkasan & poin penting diperbarui', conversationId: 'c9', at: new Date().toISOString(), deliver: true }) }))
    expect(screen.getAllByText('Ringkasan & poin penting diperbarui').length).toBeGreaterThan(0)
    expect(screen.getByText(/Mengantar hasil/)).toBeInTheDocument()
    expect(await screen.findByText('ringkasan:handoff')).toBeInTheDocument()

    await act(async () => { vi.advanceTimersByTime(7000) })
    expect(screen.getAllByText('Siap meringkas chat').length).toBeGreaterThan(0)
  })

  it('langkah bot yang berulang dengan label sama hanya dicatat sekali di log', () => {
    stub()
    render(<AiOffice />)
    const step = (stepId: string) => act(() => onmessage!({ data: JSON.stringify({ type: 'pipeline.step', conversationId: 'c1', stepId, status: 'mulai', at: new Date().toISOString() }) }))
    step('susun-balasan')
    step('knowledge-resolution')
    step('llm-composition')
    const log = screen.getByRole('region', { name: 'Kegiatan terbaru' })
    expect(within(log).getAllByText('Susun balasan dari knowledge')).toHaveLength(1)
  })

  it('klik asisten membuka obrolan di kanan; usulan baru dijalankan sesudah "Jalankan"', async () => {
    stub()
    const fetchMock = vi.mocked(fetch)
    render(<AiOffice />)
    fireEvent.click(await screen.findByText('booking:idle'))
    const panel = screen.getByRole('region', { name: 'Obrolan dengan Samsul' })

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ reply: 'Kartu jam jemput David masih terbuka.', proposal: { action: 'setujui_kartu', args: { kartuId: 'k1' }, summary: 'Setujui kartu pickup_time → "05:00" (David)' }, used: ['kartu booking terbuka'] }), { status: 200 })
    )
    fireEvent.change(within(panel).getByLabelText('Pesan untuk Samsul'), { target: { value: 'Setujui kartu jemput David' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Kirim' }))
    expect(await within(panel).findByText('Kartu jam jemput David masih terbuka.')).toBeInTheDocument()
    expect(within(panel).getByText(/Data: kartu booking terbuka/)).toBeInTheDocument()
    const chatCall = fetchMock.mock.calls.find((c) => c[0] === '/api/ai-office/chat')
    expect(JSON.parse(String((chatCall?.[1] as RequestInit).body))).toEqual({ agent: 'booking', messages: [{ role: 'user', content: 'Setujui kartu jemput David' }] })
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/ai-office/action')).toBe(false)

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ result: 'Tertulis ke backoffice: pickup_time.', conversationId: 'c1' }), { status: 200 }))
    fireEvent.click(within(panel).getByRole('button', { name: /Jalankan/ }))
    expect(await within(panel).findByText('Tertulis ke backoffice: pickup_time.')).toBeInTheDocument()
    const actionCall = fetchMock.mock.calls.find((c) => c[0] === '/api/ai-office/action')
    expect(JSON.parse(String((actionCall?.[1] as RequestInit).body))).toEqual({ agent: 'booking', action: 'setujui_kartu', args: { kartuId: 'k1' } })
    expect(within(panel).getByText('Sudah dijalankan')).toBeInTheDocument()

    fireEvent.click(within(panel).getByRole('button', { name: 'Tutup obrolan' }))
    expect(screen.queryByRole('region', { name: 'Obrolan dengan Samsul' })).toBeNull()
  })
})
