import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { SummaryQueue, jakartaMorningIso } from './SummaryQueue'
import { SUMMARY_ITEMS_CHANGED } from '@/lib/summary-items/events'
import type { SummaryItemView } from '@/lib/summary-items/view'

const review = {
  status: 'perlu_tindakan' as const,
  alasan: 'Pelanggan menanyakan harga dan belum dijawab.',
  jenisKontak: 'calon_tamu' as const,
  topik: 'Paket Ijen 2 orang',
  pertanyaan: ['Berapa harga untuk 2 orang?'],
  poinPenting: [],
  janjiTim: [],
  statusAgen: 'Belum ada balasan.',
  langkahBerikut: 'Kirim harga paket Ijen.',
}

// 23.30 WIB, 18 Oktober (16.30 UTC). Pilihan "Besok 09.00" harus jatuh 19 Oktober 09.00 WIB.
const NOW = new Date('2026-10-18T16:30:00.000Z')

function item(overrides: Partial<SummaryItemView> = {}): SummaryItemView {
  return {
    id: 'item_1',
    conversationId: 'conv_1',
    contactName: 'Anna',
    pipelineStage: 'new',
    kind: 'REPLY',
    state: 'OPEN',
    anchorAt: '2026-10-18T13:30:00.000Z',
    anchorMessageId: 'msg_in_1',
    snippet: 'Berapa harga Ijen untuk 2 orang?',
    review,
    handoff: false,
    newLead: false,
    openedOn: '2026-10-17',
    dueAt: null,
    ...overrides,
  }
}

function stubFetch(handler?: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (handler) return handler(String(url), init)
    return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('jakartaMorningIso', () => {
  it('09.00 WIB pada tanggal kalender Jakarta, dengan offset +07:00', () => {
    expect(jakartaMorningIso(NOW, 1)).toBe('2026-10-19T09:00:00+07:00')
    expect(jakartaMorningIso(NOW, 3)).toBe('2026-10-21T09:00:00+07:00')
    expect(jakartaMorningIso(NOW, 7)).toBe('2026-10-25T09:00:00+07:00')
  })

  it('memakai hari Jakarta, bukan hari UTC', () => {
    // 01.00 WIB 19 Oktober = 18 Oktober 18.00 UTC: besok = 20 Oktober.
    expect(jakartaMorningIso(new Date('2026-10-18T18:00:00.000Z'), 1)).toBe('2026-10-20T09:00:00+07:00')
  })
})

describe('SummaryQueue', () => {
  it('kartu PROMISE: label "Janji tim", daftar janji, dan aksi utama "Buka chat" ke pesan janji', () => {
    const promiseReview = {
      ...review,
      janjiTim: [{ teks: 'Kirim invoice', terpenuhi: false, messageId: 'msg_j' }, { teks: 'Cek jeep', terpenuhi: true }],
      langkahBerikut: '',
    }
    render(
      <SummaryQueue
        open={[item({ kind: 'PROMISE', anchorMessageId: 'msg_j', snippet: 'Kirim invoice', review: promiseReview })]}
        scheduled={[]}
        now={NOW}
        onChanged={() => {}}
      />
    )
    const card = screen.getByRole('listitem', { name: 'Janji tim: Anna' })
    expect(within(card).getByText('Janji tim', { selector: 'span' })).toBeInTheDocument()
    expect(within(card).getByText('terbuka sejak 17 Okt 2026')).toBeInTheDocument()
    const promises = within(within(card).getByRole('list', { name: 'Janji tim' })).getAllByRole('listitem')
    expect(promises[0]).toHaveTextContent('Kirim invoice⏳ belum')
    expect(promises[1]).toHaveTextContent('Cek jeep✅ ditepati')
    expect(within(card).getByRole('link', { name: 'Buka chat' })).toHaveAttribute('href', '/inbox?conversation=conv_1&message=msg_j&lihat=1')
    expect(within(card).queryByRole('link', { name: 'Balas' })).not.toBeInTheDocument()
    expect(within(card).queryByRole('link', { name: 'Follow up' })).not.toBeInTheDocument()
    // Ingatkan/Lepas tetap berlaku; catatan awal menyebut janji bila LLM tidak memberi langkah berikut.
    fireEvent.click(within(card).getByRole('button', { name: 'Ingatkan' }))
    expect(within(card).getByRole('textbox', { name: 'Catatan pengingat' })).toHaveValue('Tepati janji ke Anna')
  })

  it('kartu PROMISE tanpa review: snippet janji tampil, Buka chat tanpa pesan bila anchor tidak diketahui', () => {
    render(<SummaryQueue open={[item({ kind: 'PROMISE', anchorMessageId: null, snippet: 'Itinerary besok', review: null })]} scheduled={[]} now={NOW} onChanged={() => {}} />)
    const card = screen.getByRole('listitem', { name: 'Janji tim: Anna' })
    expect(within(card).getByText('Janji: “Itinerary besok”')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Buka chat' })).toHaveAttribute('href', '/inbox?conversation=conv_1')
  })

  it('baris dijadwalkan memakai label jenis yang sama', () => {
    render(<SummaryQueue open={[]} scheduled={[item({ kind: 'PROMISE', state: 'SCHEDULED' })]} now={NOW} onChanged={() => {}} />)
    expect(within(screen.getByRole('listitem', { name: 'Dijadwalkan: Anna' })).getByText('Janji tim')).toBeInTheDocument()
  })

  it('merender item OPEN dengan badge, stage, waktu tunggu, snippet, dan review', () => {
    render(
      <SummaryQueue
        open={[item({ handoff: true, newLead: true, dueAt: '2026-10-18T02:00:00.000Z' })]}
        scheduled={[]}
        now={NOW}
        onChanged={() => {}}
      />
    )
    const card = screen.getByRole('listitem', { name: 'Belum dibalas: Anna' })
    expect(within(card).getByRole('link', { name: 'Anna' })).toHaveAttribute('href', '/inbox?conversation=conv_1')
    expect(within(card).getByText('Belum dibalas')).toBeInTheDocument()
    expect(within(card).getByText('Handoff')).toBeInTheDocument()
    expect(within(card).getByText('Lead baru')).toBeInTheDocument()
    expect(within(card).getByText('Pengingat jatuh tempo')).toBeInTheDocument()
    expect(within(card).getByText('Baru')).toBeInTheDocument()
    expect(within(card).getByText(/menunggu 3 jam · sejak 17 Okt 2026/)).toBeInTheDocument()
    expect(within(card).getByText('“Berapa harga Ijen untuk 2 orang?”')).toBeInTheDocument()
    expect(within(card).getByText('Paket Ijen 2 orang')).toBeInTheDocument()
    expect(within(card).getByText(/→ Kirim harga paket Ijen\./)).toBeInTheDocument()
  })

  it('tanpa badge opsional dan dengan "Belum dicek LLM" saat review kosong', () => {
    render(<SummaryQueue open={[item({ review: null })]} scheduled={[]} now={NOW} onChanged={() => {}} />)
    expect(screen.getByText('Belum dicek LLM')).toBeInTheDocument()
    expect(screen.queryByText('Handoff')).not.toBeInTheDocument()
    expect(screen.queryByText('Lead baru')).not.toBeInTheDocument()
    expect(screen.queryByText('Pengingat jatuh tempo')).not.toBeInTheDocument()
  })

  it('tautan Balas membawa id pesan; Follow up membuka percakapannya saja', () => {
    render(
      <SummaryQueue
        open={[
          item(),
          item({
            id: 'item_2',
            conversationId: 'conv_2',
            contactName: 'Marco',
            kind: 'FOLLOW_UP',
            anchorAt: '2026-10-15T16:30:00.000Z',
            anchorMessageId: 'msg_out_2',
          }),
        ]}
        scheduled={[]}
        now={NOW}
        onChanged={() => {}}
      />
    )
    expect(screen.getByRole('link', { name: 'Balas' })).toHaveAttribute('href', '/inbox?conversation=conv_1&message=msg_in_1')
    const followUp = screen.getByRole('listitem', { name: 'Follow up: Marco' })
    expect(within(followUp).getByRole('link', { name: 'Follow up' })).toHaveAttribute('href', '/inbox?conversation=conv_2')
    expect(within(followUp).getByText(/diam 3 hari/)).toBeInTheDocument()
  })

  it('Ingatkan mengirim POST schedule dengan 09.00+07:00 dan catatan awal = langkahBerikut', async () => {
    const fetchMock = stubFetch()
    const onChanged = vi.fn()
    const events = vi.fn()
    window.addEventListener(SUMMARY_ITEMS_CHANGED, events)
    render(<SummaryQueue open={[item()]} scheduled={[]} now={NOW} onChanged={onChanged} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ingatkan' }))
    expect(screen.getByRole('textbox', { name: 'Catatan pengingat' })).toHaveValue('Kirim harga paket Ijen.')
    expect(screen.getByRole('button', { name: 'Besok 09.00' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '3 hari' }))
    fireEvent.click(screen.getByRole('button', { name: 'Jadwalkan' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('/api/summary-items/item_1/schedule')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ dueAt: '2026-10-21T09:00:00+07:00', note: 'Kirim harga paket Ijen.' })
    expect(events).toHaveBeenCalledTimes(1)
    window.removeEventListener(SUMMARY_ITEMS_CHANGED, events)
  })

  it('catatan awal "Follow up {nama}" bila review tidak punya langkah berikut', () => {
    render(<SummaryQueue open={[item({ review: null })]} scheduled={[]} now={NOW} onChanged={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ingatkan' }))
    expect(screen.getByRole('textbox', { name: 'Catatan pengingat' })).toHaveValue('Follow up Anna')
  })

  it('Lepas mengirim POST drop dengan body JSON, juga tanpa catatan', async () => {
    const fetchMock = stubFetch()
    const onChanged = vi.fn()
    render(<SummaryQueue open={[item()]} scheduled={[]} now={NOW} onChanged={onChanged} />)

    fireEvent.click(screen.getByRole('button', { name: 'Lepas' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lepas item' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('/api/summary-items/item_1/drop')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({})
  })

  it('Lepas meneruskan catatan yang diisi', async () => {
    const fetchMock = stubFetch()
    const onChanged = vi.fn()
    render(<SummaryQueue open={[item()]} scheduled={[]} now={NOW} onChanged={onChanged} />)

    fireEvent.click(screen.getByRole('button', { name: 'Lepas' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Catatan (opsional)' }), { target: { value: '  spam  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lepas item' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ note: 'spam' })
  })

  it('kegagalan tampil di kartu dan tidak memuat ulang daftar', async () => {
    stubFetch(() => ({ ok: false, status: 409, json: async () => ({ error: 'Item sudah selesai' }) }) as Response)
    const onChanged = vi.fn()
    render(<SummaryQueue open={[item()]} scheduled={[]} now={NOW} onChanged={onChanged} />)

    fireEvent.click(screen.getByRole('button', { name: 'Lepas' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lepas item' }))

    const card = screen.getByRole('listitem', { name: 'Belum dibalas: Anna' })
    expect(await within(card).findByRole('alert')).toHaveTextContent('Item sudah selesai')
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('item SCHEDULED dikelompokkan di "Dijadwalkan (N)" dengan waktu pengingat WIB', () => {
    render(
      <SummaryQueue
        open={[]}
        scheduled={[item({ id: 'item_3', conversationId: 'conv_3', contactName: 'Lena', state: 'SCHEDULED', kind: 'FOLLOW_UP', dueAt: '2026-10-21T02:00:00.000Z' })]}
        now={NOW}
        onChanged={() => {}}
      />
    )
    expect(screen.getByText('Dijadwalkan (1)')).toBeInTheDocument()
    const row = screen.getByRole('listitem', { name: 'Dijadwalkan: Lena' })
    expect(within(row).getByText('Follow up')).toBeInTheDocument()
    expect(within(row).getByText(/diingatkan .*21 Okt.*09\.00 WIB/)).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: 'Buka chat' })).toHaveAttribute('href', '/inbox?conversation=conv_3')
    // Grup tertutup secara default.
    expect(screen.getByText('Dijadwalkan (1)').closest('details')).not.toHaveAttribute('open')
  })

  it('keadaan kosong saat tidak ada item OPEN', () => {
    render(<SummaryQueue open={[]} scheduled={[]} now={NOW} onChanged={() => {}} />)
    expect(screen.getByText('Tidak ada item terbuka. Semua sudah dibalas, dijadwalkan, atau dilepas.')).toBeInTheDocument()
    expect(screen.queryByText(/Dijadwalkan/)).not.toBeInTheDocument()
  })
})
