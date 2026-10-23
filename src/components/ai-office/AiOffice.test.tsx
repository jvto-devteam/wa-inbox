import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { AiOffice } from './AiOffice'

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
    expect(screen.getByRole('img', { name: /Kantor AI/ })).toBeInTheDocument()
  })

  it('event live menggerakkan meja: label balon, kartu status, log, lalu kembali siaga', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    stub()
    render(<AiOffice />)
    expect(onmessage).not.toBeNull()
    act(() => onmessage!({ data: JSON.stringify({ type: 'ai.activity', agent: 'ringkasan', state: 'mulai', label: 'Meringkas chat & poin penting', conversationId: 'c9', at: new Date().toISOString() }) }))
    expect(screen.getAllByText('Meringkas chat & poin penting').length).toBeGreaterThan(0)
    const log = screen.getByRole('region', { name: 'Kegiatan terbaru' })
    expect(within(log).getByText('Sari')).toBeInTheDocument()
    expect(within(log).getByRole('link', { name: 'Lihat chat' })).toHaveAttribute('href', '/inbox?conversation=c9')

    act(() => onmessage!({ data: JSON.stringify({ type: 'ai.activity', agent: 'ringkasan', state: 'selesai', label: 'Ringkasan & poin penting diperbarui', conversationId: 'c9', at: new Date().toISOString(), deliver: true }) }))
    expect(screen.getAllByText('Ringkasan & poin penting diperbarui').length).toBeGreaterThan(0)
    expect(screen.getByText(/Mengantar hasil/)).toBeInTheDocument()

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
})
