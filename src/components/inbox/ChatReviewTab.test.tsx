import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { ChatReviewTab, hasMessagesSince } from './ChatReviewTab'
import { followUpStatus } from '@/lib/summary-items/status'
import { SUMMARY_ITEMS_CHANGED } from '@/lib/summary-items/events'
import type { ChatReviewItem, ChatReviewResponse } from '@/app/api/conversations/[id]/chat-review/route'

const URL = '/api/conversations/conv_1/chat-review'

const review: ChatReviewResponse['history'][number]['review'] = {
  status: 'perlu_tindakan',
  alasan: 'Harga belum dikirim.',
  jenisKontak: 'calon_tamu',
  topik: 'Paket Ijen 2 orang',
  pertanyaan: [
    { teks: 'Berapa harga untuk 2 orang?', terjawab: false },
    { teks: 'Apakah termasuk penjemputan?', terjawab: true },
    'Bisa bayar di tempat?',
  ],
  poinPenting: ['Tanggal 12 November', 'Dari Surabaya'],
  statusAgen: 'Tim sudah menjelaskan rute.',
  langkahBerikut: 'Kirim harga paket Ijen.',
}

function item(overrides: Partial<ChatReviewItem> = {}): ChatReviewItem {
  return {
    id: 'item_1',
    kind: 'REPLY',
    state: 'OPEN',
    anchorAt: '2026-10-18T13:30:00.000Z',
    dueAt: null,
    closedReason: null,
    note: null,
    closedAt: null,
    ...overrides,
  }
}

function response(overrides: Partial<ChatReviewResponse> = {}): ChatReviewResponse {
  return {
    latest: { review, at: '2026-10-19T02:00:00.000Z' },
    item: item(),
    history: [],
    lastMessageAt: null,
    ...overrides,
  }
}

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => handler(String(url), init))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('followUpStatus', () => {
  it('label per status item antrean', () => {
    expect(followUpStatus(item({ kind: 'REPLY', state: 'OPEN' })).label).toBe('Belum dijawab')
    expect(followUpStatus(item({ kind: 'FOLLOW_UP', state: 'OPEN' })).label).toBe('Perlu follow up')
    // 02.00 UTC = 09.00 WIB.
    expect(followUpStatus(item({ state: 'SCHEDULED', dueAt: '2026-10-20T02:00:00.000Z' })).label).toMatch(
      /^Dijadwalkan .*20 Okt.*09[.:]00 WIB$/
    )
    expect(followUpStatus(item({ state: 'DONE', closedReason: 'REPLIED' }))).toMatchObject({
      label: 'Sudah ditindaklanjuti',
      detail: 'dibalas',
    })
    expect(followUpStatus(item({ state: 'DONE', closedReason: 'REMINDER_DONE' })).detail).toBe('pengingat selesai')
    expect(followUpStatus(item({ state: 'DONE', closedReason: 'STAGE_ADVANCED' })).detail).toBe('tahap pipeline naik')
    expect(followUpStatus(item({ state: 'DROPPED', note: 'Sudah booking lewat agen' }))).toMatchObject({
      label: 'Dilepas',
      detail: 'Sudah booking lewat agen',
    })
    expect(followUpStatus(null).label).toBe('Tidak ada di antrean')
  })
})

describe('ChatReviewTab', () => {
  it('memuat GET untuk percakapan ini dan menampilkan status, ringkasan, dan tanda pertanyaan', async () => {
    const fetchMock = stubFetch(() => json(response()))
    render(<ChatReviewTab conversationId="conv_1" />)

    const status = await screen.findByRole('region', { name: 'Status tindak lanjut' })
    expect(fetchMock).toHaveBeenCalledWith(URL)
    expect(within(status).getByText('Belum dijawab')).toBeInTheDocument()
    expect(within(status).getByRole('button', { name: 'Ingatkan' })).toBeInTheDocument()
    expect(within(status).getByRole('button', { name: 'Lepas' })).toBeInTheDocument()

    const latest = screen.getByRole('region', { name: 'Poin penting terbaru' })
    expect(within(latest).getByText(/^Diperbarui .*19 Okt.*09[.:]00 WIB$/)).toBeInTheDocument()
    expect(within(latest).getByText('Perlu tindakan')).toBeInTheDocument()
    expect(within(latest).getByText('Calon tamu')).toBeInTheDocument()
    expect(within(latest).getByText('Paket Ijen 2 orang')).toBeInTheDocument()

    const questions = within(latest).getAllByRole('listitem').filter((li) => li.closest('ul')?.getAttribute('aria-label') === 'Yang ditanyakan')
    expect(questions).toHaveLength(3)
    expect(questions[0]).toHaveTextContent('Berapa harga untuk 2 orang?')
    expect(within(questions[0]).getByText('⏳ belum')).toBeInTheDocument()
    expect(within(questions[1]).getByText('✅ terjawab')).toBeInTheDocument()
    // Ringkasan lama: string polos, tanpa tanda apa pun.
    expect(questions[2]).toHaveTextContent(/^Bisa bayar di tempat\?$/)

    expect(within(latest).getByText('Tanggal 12 November')).toBeInTheDocument()
    expect(within(latest).getByText('Tim sudah menjelaskan rute.')).toBeInTheDocument()
    expect(within(latest).getByText('Sudah dijawab tim:')).toBeInTheDocument()
    expect(within(latest).getByText('Kirim harga paket Ijen.')).toBeInTheDocument()
    expect(within(latest).getByText('Langkah berikut:')).toBeInTheDocument()
  })

  it.each([
    [item({ kind: 'FOLLOW_UP', state: 'OPEN' }), 'Perlu follow up', true],
    [item({ state: 'SCHEDULED', dueAt: '2026-10-20T02:00:00.000Z' }), /^Dijadwalkan .*09[.:]00 WIB$/, true],
    [item({ state: 'DONE', closedReason: 'REPLIED' }), 'Sudah ditindaklanjuti', false],
    [item({ state: 'DROPPED', note: 'Salah sambung' }), 'Dilepas', false],
    [null, 'Tidak ada di antrean', false],
  ] as const)('status %#: label tampil, tombol hanya untuk OPEN/SCHEDULED', async (queueItem, label, actionable) => {
    stubFetch(() => json(response({ item: queueItem })))
    render(<ChatReviewTab conversationId="conv_1" />)

    const status = await screen.findByRole('region', { name: 'Status tindak lanjut' })
    expect(within(status).getByText(label)).toBeInTheDocument()
    if (actionable) expect(within(status).getByRole('button', { name: 'Ingatkan' })).toBeInTheDocument()
    else expect(within(status).queryByRole('button', { name: 'Ingatkan' })).not.toBeInTheDocument()
  })

  it('alasan DONE dan catatan DROPPED tampil di samping status', async () => {
    stubFetch(() => json(response({ item: item({ state: 'DONE', closedReason: 'STAGE_ADVANCED' }) })))
    render(<ChatReviewTab conversationId="conv_1" />)
    expect(await screen.findByText('tahap pipeline naik')).toBeInTheDocument()
    cleanup()

    stubFetch(() => json(response({ item: item({ state: 'DROPPED', note: 'Salah sambung' }) })))
    render(<ChatReviewTab conversationId="conv_1" />)
    expect(await screen.findByText('Salah sambung')).toBeInTheDocument()
  })

  it('tanpa ringkasan: "Belum ada ringkasan." dan tombol Perbarui tetap ada', async () => {
    stubFetch(() => json(response({ latest: null })))
    render(<ChatReviewTab conversationId="conv_1" />)

    expect(await screen.findByText('Belum ada ringkasan.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Perbarui sekarang' })).toBeEnabled()
  })

  it('latest kosong tetapi riwayat ada: riwayat terbaru jadi ringkasan, berlabel tanggal harian', async () => {
    stubFetch(() =>
      json(response({ latest: null, history: [{ date: '2026-10-18', review: { ...review, topik: 'Harga Bromo' } }] }))
    )
    render(<ChatReviewTab conversationId="conv_1" />)

    const latest = await screen.findByRole('region', { name: 'Poin penting terbaru' })
    expect(within(latest).getByText(/^Dari ringkasan harian .*18 Okt/)).toBeInTheDocument()
    expect(within(latest).getByText('Harga Bromo')).toBeInTheDocument()
    expect(within(latest).getByText('Tanggal 12 November')).toBeInTheDocument()
    expect(within(latest).queryByText(/^Diperbarui/)).not.toBeInTheDocument()
    expect(screen.queryByText('Belum ada ringkasan.')).not.toBeInTheDocument()
  })

  it('muat ulang gagal setelah Lepas berhasil: galat tampil inline, data lama tetap terlihat', async () => {
    let gets = 0
    stubFetch((url) => {
      if (url === '/api/summary-items/item_1/drop') return json({ ok: true })
      gets++
      return gets === 1 ? json(response()) : json({ error: 'Gagal memuat ringkasan' }, 500)
    })
    render(<ChatReviewTab conversationId="conv_1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Lepas' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lepas item' }))

    const status = screen.getByRole('region', { name: 'Status tindak lanjut' })
    expect(await within(status).findByText('Gagal memuat ringkasan')).toBeInTheDocument()
    expect(within(status).getByText('Gagal memuat ringkasan')).toHaveAttribute('role', 'alert')
    expect(screen.getByText('Paket Ijen 2 orang')).toBeInTheDocument()
  })

  it('"Perbarui sekarang" memanggil POST, tombol nonaktif selama menunggu, lalu menampilkan hasilnya', async () => {
    let resolvePost: (r: Response) => void = () => {}
    const fetchMock = stubFetch((_url, init) => {
      if (init?.method === 'POST') return new Promise<Response>((resolve) => (resolvePost = resolve))
      return json(response({ latest: null }))
    })
    render(<ChatReviewTab conversationId="conv_1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Perbarui sekarang' }))
    const busy = screen.getByRole('button', { name: 'Meringkas…' })
    expect(busy).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledWith(URL, { method: 'POST' })

    resolvePost(json(response({ latest: { review: { ...review, topik: 'Topik baru dari LLM' }, at: '2026-10-19T05:00:00.000Z' } })))
    expect(await screen.findByText('Topik baru dari LLM')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Perbarui sekarang' })).toBeEnabled()
    expect(screen.queryByText('Belum ada ringkasan.')).not.toBeInTheDocument()
  })

  it('502 dari POST tampil inline, ringkasan lama tetap terlihat', async () => {
    stubFetch((_url, init) => {
      if (init?.method === 'POST') return json({ error: 'Gagal meringkas. Coba lagi.' }, 502)
      return json(response())
    })
    render(<ChatReviewTab conversationId="conv_1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Perbarui sekarang' }))
    const latest = screen.getByRole('region', { name: 'Poin penting terbaru' })
    expect(await within(latest).findByRole('alert')).toHaveTextContent('Gagal meringkas. Coba lagi.')
    expect(within(latest).getByText('Paket Ijen 2 orang')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Perbarui sekarang' })).toBeEnabled()
  })

  it('riwayat: satu <details> per tanggal dengan tanggal, topik, badge, dan isi yang sama formatnya', async () => {
    stubFetch(() =>
      json(
        response({
          history: [
            { date: '2026-10-18', review: { ...review, status: 'selesai', topik: 'Harga Bromo' } },
            { date: '2026-10-17', review: { ...review, status: 'tidak_jelas', topik: 'Sapaan awal', pertanyaan: ['Halo?'] } },
          ],
        })
      )
    )
    const { container } = render(<ChatReviewTab conversationId="conv_1" />)

    const history = await screen.findByRole('region', { name: 'Riwayat' })
    const days = container.querySelectorAll('details')
    expect(days).toHaveLength(2)
    const first = within(days[0] as HTMLElement)
    expect(days[0].querySelector('summary')).toHaveTextContent(/18 Okt 2026/)
    expect(first.getByText('Harga Bromo')).toBeInTheDocument()
    expect(first.getByText('Selesai')).toBeInTheDocument()
    expect(first.getByText('⏳ belum')).toBeInTheDocument()
    expect(within(days[1] as HTMLElement).getByText('Tidak jelas')).toBeInTheDocument()
    expect(within(days[1] as HTMLElement).getByText('Halo?')).toBeInTheDocument()
    expect(history).toBeInTheDocument()
  })

  it('riwayat kosong: bagiannya tidak tampil', async () => {
    stubFetch(() => json(response({ history: [] })))
    render(<ChatReviewTab conversationId="conv_1" />)
    await screen.findByRole('region', { name: 'Status tindak lanjut' })
    expect(screen.queryByRole('region', { name: 'Riwayat' })).not.toBeInTheDocument()
  })

  it('Lepas memakai panel antrean: POST drop dengan body {}, event dikirim, lalu dimuat ulang', async () => {
    let gets = 0
    const fetchMock = stubFetch((url) => {
      if (url === '/api/summary-items/item_1/drop') return json({ ok: true })
      gets++
      return json(response({ item: gets === 1 ? item() : item({ state: 'DROPPED', note: null }) }))
    })
    const listener = vi.fn()
    window.addEventListener(SUMMARY_ITEMS_CHANGED, listener)
    render(<ChatReviewTab conversationId="conv_1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Lepas' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lepas item' }))

    expect(await screen.findByText('Dilepas')).toBeInTheDocument()
    const drop = fetchMock.mock.calls.find(([u]) => String(u) === '/api/summary-items/item_1/drop')
    expect(drop?.[1]).toMatchObject({ method: 'POST', body: '{}' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(gets).toBe(2)
    window.removeEventListener(SUMMARY_ITEMS_CHANGED, listener)
  })

  it('Ingatkan mengisi catatan dari langkah berikut dan menjadwalkan 09.00 WIB', async () => {
    const fetchMock = stubFetch((url) => {
      if (url === '/api/summary-items/item_1/schedule') return json({ ok: true })
      return json(response())
    })
    render(<ChatReviewTab conversationId="conv_1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Ingatkan' }))
    expect(screen.getByLabelText('Catatan pengingat')).toHaveValue('Kirim harga paket Ijen.')
    fireEvent.click(screen.getByRole('button', { name: 'Jadwalkan' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u) === '/api/summary-items/item_1/schedule')).toBe(true))
    const call = fetchMock.mock.calls.find(([u]) => String(u) === '/api/summary-items/item_1/schedule')
    const body = JSON.parse(String(call?.[1]?.body)) as { dueAt: string; note: string }
    expect(body.note).toBe('Kirim harga paket Ijen.')
    expect(body.dueAt).toMatch(/^\d{4}-\d{2}-\d{2}T09:00:00\+07:00$/)
  })

  it('GET gagal: pesan error tampil, bukan kerangka selamanya', async () => {
    stubFetch(() => json({ error: 'Percakapan tidak ditemukan' }, 404))
    render(<ChatReviewTab conversationId="conv_1" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Percakapan tidak ditemukan')
  })
})

describe('butir yang bisa diklik', () => {
  it('pertanyaan dan poin dengan messageId jadi tautan ke pesan sumber; yang lain teks biasa', async () => {
    const linked = {
      ...review,
      pertanyaan: [{ teks: 'Berapa harga?', terjawab: false, messageId: 'msg_3' }, { teks: 'Jemput?', terjawab: true }, 'Bayar di tempat?'],
      poinPenting: [{ teks: 'Tanggal 12 November', messageId: 'msg 5' }, { teks: 'Dari Surabaya' }, 'Paket Ijen'],
    }
    stubFetch(() => json(response({ latest: { review: linked, at: '2026-10-19T02:00:00.000Z' } })))
    render(<ChatReviewTab conversationId="conv_1" />)

    const latest = await screen.findByRole('region', { name: 'Poin penting terbaru' })
    const q = within(latest).getByRole('link', { name: 'Lihat pesan: Berapa harga?' })
    expect(q).toHaveAttribute('href', '/inbox?conversation=conv_1&message=msg_3')
    const p = within(latest).getByRole('link', { name: 'Lihat pesan: Tanggal 12 November' })
    expect(p).toHaveAttribute('href', '/inbox?conversation=conv_1&message=msg%205')
    expect(within(latest).getAllByRole('link')).toHaveLength(2)
    for (const text of ['Jemput?', 'Bayar di tempat?', 'Dari Surabaya', 'Paket Ijen']) {
      expect(within(latest).getByText(text).closest('a')).toBeNull()
    }
  })

  it('klik butir menggulung ke pesan yang sedang dirender (klik ulang pada URL yang sama)', async () => {
    const linked = { ...review, poinPenting: [{ teks: 'Tanggal 12 November', messageId: 'msg_5' }] }
    stubFetch(() => json(response({ latest: { review: linked, at: '2026-10-19T02:00:00.000Z' } })))
    const bubble = document.createElement('div')
    bubble.id = 'pesan-msg_5'
    const scroll = vi.fn()
    bubble.scrollIntoView = scroll
    document.body.appendChild(bubble)
    render(<ChatReviewTab conversationId="conv_1" />)

    const link = await screen.findByRole('link', { name: 'Lihat pesan: Tanggal 12 November' })
    // Klik tanpa navigasi sungguhan: jsdom tidak punya router Next.
    link.addEventListener('click', (e) => e.preventDefault())
    fireEvent.click(link)
    expect(scroll).toHaveBeenCalledWith({ block: 'center' })
    bubble.remove()
  })
})

describe('tanda "Ada pesan baru"', () => {
  it('hasMessagesSince membandingkan waktu, null tidak pernah memicu', () => {
    expect(hasMessagesSince('2026-10-19T03:00:00.000Z', '2026-10-19T02:00:00.000Z')).toBe(true)
    expect(hasMessagesSince('2026-10-19T02:00:00.000Z', '2026-10-19T02:00:00.000Z')).toBe(false)
    expect(hasMessagesSince('2026-10-19T01:00:00.000Z', '2026-10-19T02:00:00.000Z')).toBe(false)
    expect(hasMessagesSince(null, '2026-10-19T02:00:00.000Z')).toBe(false)
    expect(hasMessagesSince('2026-10-19T03:00:00.000Z', null)).toBe(false)
  })

  it('pesan sesudah latest.at: tanda tampil dan menjelaskan tombol Perbarui', async () => {
    stubFetch(() => json(response({ lastMessageAt: '2026-10-19T02:30:00.000Z' })))
    render(<ChatReviewTab conversationId="conv_1" />)
    const hint = await screen.findByText('Ada pesan baru sejak ringkasan ini.')
    expect(screen.getByRole('button', { name: 'Perbarui sekarang' })).toHaveAttribute('aria-describedby', hint.id)
  })

  it('tidak ada pesan sesudah latest.at: tanpa tanda', async () => {
    stubFetch(() => json(response({ lastMessageAt: '2026-10-19T02:00:00.000Z' })))
    render(<ChatReviewTab conversationId="conv_1" />)
    await screen.findByRole('region', { name: 'Poin penting terbaru' })
    expect(screen.queryByText('Ada pesan baru sejak ringkasan ini.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Perbarui sekarang' })).not.toHaveAttribute('aria-describedby')
  })

  it.each([
    // Akhir 18 Okt WIB = 2026-10-18T17:00:00Z.
    ['2026-10-18T16:59:00.000Z', false],
    ['2026-10-18T17:01:00.000Z', true],
  ])('cadangan riwayat dibandingkan dengan akhir hari WIB (pesan %s → %s)', async (lastMessageAt, shown) => {
    stubFetch(() => json(response({ latest: null, lastMessageAt, history: [{ date: '2026-10-18', review }] })))
    render(<ChatReviewTab conversationId="conv_1" />)
    await screen.findByText(/^Dari ringkasan harian/)
    expect(screen.queryByText('Ada pesan baru sejak ringkasan ini.') !== null).toBe(shown)
  })

  it('belum ada ringkasan sama sekali: tanpa tanda', async () => {
    stubFetch(() => json(response({ latest: null, lastMessageAt: '2026-10-19T02:30:00.000Z' })))
    render(<ChatReviewTab conversationId="conv_1" />)
    await screen.findByText('Belum ada ringkasan.')
    expect(screen.queryByText('Ada pesan baru sejak ringkasan ini.')).not.toBeInTheDocument()
  })
})
