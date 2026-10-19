import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { SummaryDayView } from './SummaryDayView'
import { SUMMARY_ITEMS_CHANGED } from '@/lib/summary-items/events'
import type { ConversationReview, DailySummaryPayload } from '@/lib/daily-summary/payload-schema'
import type { SummaryItemStatus } from '@/lib/summary-items/status'

const review: ConversationReview = {
  status: 'perlu_tindakan',
  alasan: 'Harga belum dikirim.',
  jenisKontak: 'calon_tamu',
  topik: 'Paket Ijen 2 orang',
  pertanyaan: [{ teks: 'Berapa harga untuk 2 orang?', terjawab: false }, { teks: 'Termasuk jemput?', terjawab: true }, 'Bisa bayar di tempat?'],
  poinPenting: [],
  statusAgen: '',
  langkahBerikut: 'Kirim harga paket Ijen.',
}

const ref = (id: string, contactName: string | null) => ({ conversationId: id, contactName, pipelineStage: 'new' })

function payload(overrides: Partial<DailySummaryPayload> = {}): DailySummaryPayload {
  return {
    version: 1,
    date: '2026-10-18',
    windowStart: '2026-10-17T17:00:00.000Z',
    windowEnd: '2026-10-18T17:00:00.000Z',
    generatedAt: '2026-10-18T17:03:00.000Z',
    thresholds: { unrepliedMinMs: 3600000, dormantMinMs: 172800000, lookbackMs: 1209600000 },
    counts: { activeConversations: 7, inbound: 30, outbound: 25, newConversations: 2, reviewed: 4, reviewFailed: 0 },
    filteredOut: { unreplied: 0, dormant: 0 },
    unreplied: [{ ...ref('c_anna', 'Anna'), lastMessageAt: '2026-10-18T10:00:00.000Z', waitingMs: 1, snippet: 'harga?', review }],
    dormant: [{ ...ref('c_budi', 'Budi'), lastMessageAt: '2026-10-15T10:00:00.000Z', silentMs: 1, snippet: 'ok', review: null }],
    newLeads: [{ ...ref('c_anna', 'Anna'), createdAt: '2026-10-18T09:00:00.000Z', tripBrief: null, review }],
    handoffs: [
      { runId: 'r1', conversationId: 'c_anna', contactName: 'Anna', at: '2026-10-18T11:00:00.000Z', inboundText: 'admin', stillWaiting: true },
    ],
    gaps: { newCount: 3, openTotal: 9, byReason: [], byTopic: [], items: [] },
    conversations: [
      { ...ref('c_citra', 'Citra'), inbound: 4, outbound: 4, review: { ...review, pertanyaan: ['Jam berapa berangkat?'], topik: 'Jadwal' } },
      { ...ref('c_anna', 'Anna'), inbound: 3, outbound: 0, review },
      { ...ref('c_dewi', 'Dewi'), inbound: 1, outbound: 1, review: { ...review, topik: 'Dewi topik' } },
    ],
    ...overrides,
  }
}

function status(overrides: Partial<SummaryItemStatus> = {}): SummaryItemStatus {
  return { id: 'si', kind: 'REPLY', state: 'OPEN', dueAt: null, closedReason: null, note: null, closedAt: null, ...overrides }
}

const items: Record<string, SummaryItemStatus> = {
  c_anna: status({ id: 'si_anna', state: 'DONE', closedReason: 'REPLIED' }),
  c_budi: status({ id: 'si_budi', kind: 'FOLLOW_UP', state: 'SCHEDULED', dueAt: '2026-10-20T02:00:00.000Z' }),
  c_dewi: status({ id: 'si_dewi', kind: 'REPLY', state: 'OPEN' }),
}

function card(name: string) {
  return screen.getByRole('listitem', { name })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SummaryDayView', () => {
  it('angka hari itu satu baris, plus gap baru bila ada', () => {
    render(<SummaryDayView payload={payload()} items={items} onChanged={() => {}} />)
    expect(screen.getByText('7 aktif · 30 masuk · 25 keluar · 2 kontak baru · 3 gap baru hari itu')).toBeInTheDocument()
    cleanup()
    render(<SummaryDayView payload={payload({ gaps: { newCount: 0, openTotal: 0, byReason: [], byTopic: [], items: [] } })} items={items} onChanged={() => {}} />)
    expect(screen.getByText('7 aktif · 30 masuk · 25 keluar · 2 kontak baru')).toBeInTheDocument()
  })

  it('satu kartu per percakapan, diurutkan OPEN → SCHEDULED → lainnya', () => {
    render(<SummaryDayView payload={payload()} items={items} onChanged={() => {}} />)
    const names = within(screen.getByRole('region', { name: 'Percakapan hari itu' }))
      .getAllByRole('listitem')
      .filter((li) => li.parentElement?.parentElement?.tagName === 'SECTION')
      .map((li) => li.getAttribute('aria-label'))
    expect(names).toEqual(['Dewi', 'Budi', 'Anna', 'Citra'])
  })

  it('label hari itu, tautan nama ke Inbox, dan status sekarang', () => {
    render(<SummaryDayView payload={payload()} items={items} onChanged={() => {}} />)
    const anna = card('Anna')
    expect(within(anna).getByRole('link', { name: 'Anna' })).toHaveAttribute('href', '/inbox?conversation=c_anna')
    for (const label of ['Belum dibalas', 'Lead baru', 'Handoff']) expect(within(anna).getByText(label)).toBeInTheDocument()
    expect(within(anna).queryByText('Pelanggan diam')).not.toBeInTheDocument()
    expect(within(anna).getByText('Sudah ditindaklanjuti')).toBeInTheDocument()
    expect(within(anna).getByText('dibalas')).toBeInTheDocument()

    expect(within(card('Budi')).getByText('Pelanggan diam')).toBeInTheDocument()
    expect(within(card('Budi')).getByText(/^Dijadwalkan .+ WIB$/)).toBeInTheDocument()
    expect(within(card('Dewi')).getByText('Belum dijawab')).toBeInTheDocument()
    expect(within(card('Citra')).getByText('Tidak ada di antrean')).toBeInTheDocument()
  })

  it('ringkasan hari itu: topik, alasan → langkah berikut, tanda pertanyaan; tanpa review = Belum dicek LLM', () => {
    render(<SummaryDayView payload={payload()} items={items} onChanged={() => {}} />)
    const anna = card('Anna')
    expect(within(anna).getByText('Paket Ijen 2 orang')).toBeInTheDocument()
    expect(within(anna).getByText('→ Kirim harga paket Ijen.', { exact: false })).toBeInTheDocument()
    const questions = within(within(anna).getByRole('list', { name: 'Yang ditanyakan' })).getAllByRole('listitem')
    expect(questions[0]).toHaveTextContent('Berapa harga untuk 2 orang?⏳ belum')
    expect(questions[1]).toHaveTextContent('Termasuk jemput?✅ terjawab')
    expect(questions[2]).toHaveTextContent(/^Bisa bayar di tempat\?$/)

    expect(within(card('Budi')).getByText('Belum dicek LLM')).toBeInTheDocument()
  })

  it('Ingatkan/Lepas hanya untuk item OPEN/SCHEDULED; Buka chat selalu ada', () => {
    render(<SummaryDayView payload={payload()} items={items} onChanged={() => {}} />)
    for (const name of ['Anna', 'Budi', 'Citra', 'Dewi']) {
      expect(within(card(name)).getByRole('link', { name: 'Buka chat' })).toHaveAttribute(
        'href',
        `/inbox?conversation=c_${name.toLowerCase()}`
      )
    }
    for (const name of ['Dewi', 'Budi']) {
      expect(within(card(name)).getByRole('button', { name: 'Ingatkan' })).toBeInTheDocument()
      expect(within(card(name)).getByRole('button', { name: 'Lepas' })).toBeInTheDocument()
    }
    for (const name of ['Anna', 'Citra']) {
      expect(within(card(name)).queryByRole('button', { name: 'Ingatkan' })).not.toBeInTheDocument()
      expect(within(card(name)).queryByRole('button', { name: 'Lepas' })).not.toBeInTheDocument()
    }
  })

  it('Lepas mengirim body JSON, mengumumkan perubahan, lalu memuat ulang', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) as Response)
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = vi.fn()
    const events = vi.fn()
    window.addEventListener(SUMMARY_ITEMS_CHANGED, events)
    render(<SummaryDayView payload={payload()} items={items} onChanged={onChanged} />)

    const dewi = card('Dewi')
    fireEvent.click(within(dewi).getByRole('button', { name: 'Lepas' }))
    fireEvent.click(within(dewi).getByRole('button', { name: 'Lepas item' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/summary-items/si_dewi/drop')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({})
    expect(events).toHaveBeenCalledTimes(1)
    window.removeEventListener(SUMMARY_ITEMS_CHANGED, events)
  })

  it('pertanyaan dengan messageId jadi tautan ke pesan sumbernya; string lama tetap teks', () => {
    const linked = { ...review, pertanyaan: [{ teks: 'Jam berapa berangkat?', terjawab: false, messageId: 'm_7' }, 'Bawa jaket?'] }
    render(
      <SummaryDayView
        payload={payload({ conversations: [{ ...ref('c_citra', 'Citra'), inbound: 1, outbound: 1, review: linked }] })}
        items={{}}
        onChanged={() => {}}
      />
    )
    const citra = card('Citra')
    expect(within(citra).getByRole('link', { name: 'Lihat pesan: Jam berapa berangkat?' })).toHaveAttribute(
      'href',
      '/inbox?conversation=c_citra&message=m_7&lihat=1'
    )
    expect(within(citra).getByText('Bawa jaket?').closest('a')).toBeNull()
  })

  it('payload tanpa percakapan menampilkan keadaan kosong', () => {
    render(
      <SummaryDayView
        payload={payload({ unreplied: [], dormant: [], newLeads: [], handoffs: [], conversations: [] })}
        items={{}}
        onChanged={() => {}}
      />
    )
    expect(screen.getByText('Tidak ada percakapan pada hari itu.')).toBeInTheDocument()
  })
})
