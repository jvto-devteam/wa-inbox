import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { ChatReviewTab } from './ChatReviewTab'
import { followUpStatus, summaryItemKindLabel } from '@/lib/summary-items/status'
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
  janjiTim: [],
  profil: [],
  statusAgen: 'Tim sudah menjelaskan rute.',
  langkahBerikut: 'Kirim harga paket Ijen.',
}

const NO_REPLY = { respondedAt: null, respondedMessageId: null, respondedBy: null } as const

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
    pinned: [],
    changeHistory: [],
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
    expect(followUpStatus(item({ state: 'DONE', closedReason: 'JUDGED_DONE' })).detail).toBe('dinilai selesai')
    expect(followUpStatus(item({ state: 'DROPPED', note: 'Sudah booking lewat agen' }))).toMatchObject({
      label: 'Dilepas',
      detail: 'Sudah booking lewat agen',
    })
    expect(followUpStatus(null).label).toBe('Tidak ada di antrean')
  })

  it('janji tim: OPEN = "Janji belum ditepati", PROMISE_KEPT = "janji ditepati", label jenis "Janji tim"', () => {
    expect(followUpStatus(item({ kind: 'PROMISE', state: 'OPEN' }))).toMatchObject({ label: 'Janji belum ditepati', variant: 'warning' })
    expect(followUpStatus(item({ kind: 'PROMISE', state: 'DONE', closedReason: 'PROMISE_KEPT' }))).toMatchObject({
      label: 'Sudah ditindaklanjuti',
      detail: 'janji ditepati',
    })
    expect(summaryItemKindLabel('PROMISE')).toBe('Janji tim')
    expect(summaryItemKindLabel('REPLY')).toBe('Belum dibalas')
    expect(summaryItemKindLabel('LAIN')).toBe('LAIN')
  })
})

describe('ChatReviewTab: janji tim', () => {
  it('status PROMISE berlabel "Janji tim", daftar janji ✅ ditepati / ⏳ belum, butir ber-messageId jadi tautan lihat=1', async () => {
    const withPromises = {
      ...review,
      janjiTim: [
        { teks: 'Kirim invoice', terpenuhi: false, messageId: 'msg_9' },
        { teks: 'Cek ketersediaan jeep', terpenuhi: true },
        'Janji lama',
      ],
    }
    stubFetch(() => json(response({ latest: { review: withPromises, at: '2026-10-19T02:00:00.000Z' }, item: item({ kind: 'PROMISE' }) })))
    render(<ChatReviewTab conversationId="conv_1" />)

    const status = await screen.findByRole('region', { name: 'Ringkasan chat' })
    expect(within(status).getByText('Janji tim')).toBeInTheDocument()
    expect(within(status).getByText('Janji belum ditepati')).toBeInTheDocument()
    expect(within(status).getByRole('button', { name: 'Ingatkan' })).toBeInTheDocument()

    // Ringkas (owner 2026-10-22): yang belum dipenuhi tampil; yang sudah ditepati dilipat.
    const open = within(status).getByRole('list', { name: 'Janji tim belum dipenuhi' })
    const rows = within(open).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Kirim invoice⏳ belum')
    expect(rows[1]).toHaveTextContent(/^Janji lama$/)
    expect(within(rows[0]).getByRole('link', { name: 'Lihat pesan: Kirim invoice' })).toHaveAttribute(
      'href',
      '/inbox?conversation=conv_1&message=msg_9&lihat=1'
    )
    expect(within(status).getByText('1 janji ditepati').closest('summary')).not.toBeNull()
    const kept = within(status).getByRole('list', { name: 'Sudah ditepati' })
    expect(within(kept).getByRole('listitem')).toHaveTextContent('Cek ketersediaan jeep✅ ditepati')
    expect(within(kept).queryByRole('link')).not.toBeInTheDocument()
  })

  it('tanpa janji: daftar "Janji tim" tidak dirender dan item REPLY tanpa label jenis', async () => {
    stubFetch(() => json(response()))
    render(<ChatReviewTab conversationId="conv_1" />)
    const status = await screen.findByRole('region', { name: 'Ringkasan chat' })
    expect(within(status).queryByText('Janji tim')).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Janji tim' })).not.toBeInTheDocument()
  })
})

describe('ChatReviewTab', () => {
  it('memuat GET untuk percakapan ini dan menampilkan status, ringkasan, dan tanda pertanyaan', async () => {
    const fetchMock = stubFetch(() => json(response()))
    render(<ChatReviewTab conversationId="conv_1" />)

    const latest = await screen.findByRole('region', { name: 'Ringkasan chat' })
    expect(fetchMock).toHaveBeenCalledWith(URL)
    // Satu baris: status tindak lanjut + waktu ringkasan + tombol perbarui (ikon).
    expect(within(latest).getByText('Belum dijawab')).toBeInTheDocument()
    expect(within(latest).getByText(/^Diperbarui .*19 Okt.*09[.:]00 WIB$/)).toBeInTheDocument()
    expect(within(latest).getByRole('button', { name: 'Perbarui sekarang' })).toBeInTheDocument()
    expect(within(latest).getByRole('button', { name: 'Ingatkan' })).toBeInTheDocument()
    expect(within(latest).getByRole('button', { name: 'Lepas' })).toBeInTheDocument()

    // Sengaja tidak tampil lagi (owner 2026-10-22): lencana status/jenis kontak, topik, "sudah dijawab tim".
    for (const gone of ['Perlu tindakan', 'Calon tamu', 'Paket Ijen 2 orang', 'Tim sudah menjelaskan rute.', 'Sudah dijawab tim:']) {
      expect(within(latest).queryByText(gone)).not.toBeInTheDocument()
    }

    const open = within(within(latest).getByRole('list', { name: 'Belum terjawab' })).getAllByRole('listitem')
    expect(open).toHaveLength(2)
    expect(open[0]).toHaveTextContent('Berapa harga untuk 2 orang?')
    expect(within(open[0]).getByText('⏳ belum')).toBeInTheDocument()
    // Ringkasan lama: string polos, tanpa tanda apa pun -- tetap tampil (tidak diketahui sudah terjawab).
    expect(open[1]).toHaveTextContent(/^Bisa bayar di tempat\?$/)
    expect(within(latest).getByText('1 pertanyaan terjawab').closest('summary')).not.toBeNull()
    const answered = within(latest).getByRole('list', { name: 'Sudah terjawab' })
    expect(within(answered).getByText('✅ terjawab')).toBeInTheDocument()

    // Calon tamu: poin penting tampil (satu-satunya tempat data perjalanannya).
    expect(within(latest).getByText('Tanggal 12 November').closest('details')).toBeNull()
    expect(within(latest).getByText('Kirim harga paket Ijen.')).toBeInTheDocument()
    expect(within(latest).getByText('Langkah berikut:')).toBeInTheDocument()
  })

  it('tamu yang sudah booking: poin penting dilipat; calon tamu dengan >5 poin: 5 tampil, sisanya dilipat', async () => {
    const points = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']
    stubFetch(() => json(response({ latest: { review: { ...review, jenisKontak: 'tamu_existing', poinPenting: points }, at: '2026-10-19T02:00:00.000Z' } })))
    render(<ChatReviewTab conversationId="conv_1" />)
    const booked = await screen.findByRole('region', { name: 'Ringkasan chat' })
    expect(within(booked).getByText('Poin penting (7)').closest('summary')).not.toBeNull()
    expect(within(booked).getByText('P1').closest('details')).not.toBeNull()
    cleanup()

    stubFetch(() => json(response({ latest: { review: { ...review, poinPenting: points }, at: '2026-10-19T02:00:00.000Z' } })))
    render(<ChatReviewTab conversationId="conv_1" />)
    const lead = await screen.findByRole('region', { name: 'Ringkasan chat' })
    expect(within(lead).getByText('P5').closest('details')).toBeNull()
    expect(within(lead).getByText('P6').closest('details')).not.toBeNull()
    expect(within(lead).getByText('2 poin lainnya').closest('summary')).not.toBeNull()
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

    const status = await screen.findByRole('region', { name: 'Ringkasan chat' })
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
      json(response({ latest: null, history: [{ date: '2026-10-18', review: { ...review, topik: 'Harga Bromo' }, ...NO_REPLY }] }))
    )
    render(<ChatReviewTab conversationId="conv_1" />)

    const latest = await screen.findByRole('region', { name: 'Ringkasan chat' })
    expect(within(latest).getByText(/^Dari ringkasan harian .*18 Okt/)).toBeInTheDocument()
    expect(within(latest).getByText('Tanggal 12 November')).toBeInTheDocument()
    // Entri yang dipakai sebagai "terbaru" tidak tampil dua kali di riwayat.
    expect(screen.queryByRole('group', { name: 'Riwayat' })).not.toBeInTheDocument()
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

    const status = screen.getByRole('region', { name: 'Ringkasan chat' })
    expect(await within(status).findByText('Gagal memuat ringkasan')).toBeInTheDocument()
    expect(within(status).getByText('Gagal memuat ringkasan')).toHaveAttribute('role', 'alert')
    expect(screen.getByText('Kirim harga paket Ijen.')).toBeInTheDocument()
  })

  it('"Perbarui sekarang" memanggil POST, tombol nonaktif selama menunggu, lalu menampilkan hasilnya', async () => {
    let resolvePost: (r: Response) => void = () => {}
    const fetchMock = stubFetch((_url, init) => {
      if (init?.method === 'POST') return new Promise<Response>((resolve) => (resolvePost = resolve))
      return json(response({ latest: null }))
    })
    const listener = vi.fn()
    window.addEventListener(SUMMARY_ITEMS_CHANGED, listener)
    render(<ChatReviewTab conversationId="conv_1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Perbarui sekarang' }))
    const busy = screen.getByRole('button', { name: 'Meringkas…' })
    expect(listener).not.toHaveBeenCalled()
    expect(busy).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledWith(URL, { method: 'POST' })

    resolvePost(json(response({ latest: { review: { ...review, langkahBerikut: 'Langkah baru dari LLM' }, at: '2026-10-19T05:00:00.000Z' } })))
    expect(await screen.findByText('Langkah baru dari LLM')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Perbarui sekarang' })).toBeEnabled()
    expect(screen.queryByText('Belum ada ringkasan.')).not.toBeInTheDocument()
    // Perbarui bisa mengubah item "Janji tim": lencana menu diberi tahu, sekali.
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(SUMMARY_ITEMS_CHANGED, listener)
  })

  it('502 dari POST tampil inline, ringkasan lama tetap terlihat', async () => {
    stubFetch((_url, init) => {
      if (init?.method === 'POST') return json({ error: 'Gagal meringkas. Coba lagi.' }, 502)
      return json(response())
    })
    const listener = vi.fn()
    window.addEventListener(SUMMARY_ITEMS_CHANGED, listener)
    render(<ChatReviewTab conversationId="conv_1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Perbarui sekarang' }))
    const latest = screen.getByRole('region', { name: 'Ringkasan chat' })
    expect(await within(latest).findByRole('alert')).toHaveTextContent('Gagal meringkas. Coba lagi.')
    expect(within(latest).getByText('Kirim harga paket Ijen.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Perbarui sekarang' })).toBeEnabled()
    expect(listener).not.toHaveBeenCalled()
    window.removeEventListener(SUMMARY_ITEMS_CHANGED, listener)
  })

  it('riwayat: dilipat dalam satu "Riwayat (n hari)", satu <details> per tanggal dengan tanggal, badge, dan isi ringkas', async () => {
    stubFetch(() =>
      json(
        response({
          history: [
            { date: '2026-10-18', review: { ...review, status: 'selesai', topik: 'Harga Bromo' }, ...NO_REPLY },
            { date: '2026-10-17', review: { ...review, status: 'tidak_jelas', topik: 'Sapaan awal', pertanyaan: ['Halo?'] }, ...NO_REPLY },
          ],
        })
      )
    )
    const { container } = render(<ChatReviewTab conversationId="conv_1" />)

    const history = await screen.findByRole('group', { name: 'Riwayat' })
    expect(history).not.toHaveAttribute('open')
    expect(within(history).getByText('Riwayat (2 hari)')).toBeInTheDocument()
    const days = container.querySelectorAll('details[aria-label="Riwayat"] > div > details')
    expect(days).toHaveLength(2)
    const first = within(days[0] as HTMLElement)
    expect(days[0].querySelector('summary')).toHaveTextContent(/18 Okt 2026/)
    expect(first.getByText('Saat itu: selesai')).toBeInTheDocument()
    expect(first.getByText('⏳ belum')).toBeInTheDocument()
    expect(within(days[1] as HTMLElement).getByText('Saat itu: tidak jelas')).toBeInTheDocument()
    expect(within(days[1] as HTMLElement).getByText('Halo?')).toBeInTheDocument()
    expect(history).toBeInTheDocument()
  })

  it('riwayat kosong: bagiannya tidak tampil', async () => {
    stubFetch(() => json(response({ history: [] })))
    render(<ChatReviewTab conversationId="conv_1" />)
    await screen.findByRole('region', { name: 'Ringkasan chat' })
    expect(screen.queryByRole('group', { name: 'Riwayat' })).not.toBeInTheDocument()
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

    const latest = await screen.findByRole('region', { name: 'Ringkasan chat' })
    const q = within(latest).getByRole('link', { name: 'Lihat pesan: Berapa harga?' })
    expect(q).toHaveAttribute('href', '/inbox?conversation=conv_1&message=msg_3&lihat=1')
    const p = within(latest).getByRole('link', { name: 'Lihat pesan: Tanggal 12 November' })
    expect(p).toHaveAttribute('href', '/inbox?conversation=conv_1&message=msg%205&lihat=1')
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

describe('riwayat harian', () => {
  describe('riwayat: potret status dan penanda Ditanggapi', () => {
    async function renderHistory(history: ChatReviewResponse['history']) {
      stubFetch(() => json(response({ history })))
      const { container } = render(<ChatReviewTab conversationId="conv_1" />)
      await screen.findByRole('group', { name: 'Riwayat' })
      return container.querySelectorAll('details[aria-label="Riwayat"] > div > details')
    }

    it('badge riwayat netral (muted, bukan destructive) dan berlabel "Saat itu: ..."', async () => {
      const days = await renderHistory([{ date: '2026-10-18', review, ...NO_REPLY }])
      const badge = within(days[0] as HTMLElement).getByText('Saat itu: perlu tindakan')
      expect(badge.className).not.toMatch(/danger|destructive|red/)
    })

    it('ada tanggapan tim: tautan ke pesan dengan lihat=1 dan teks bantuan', async () => {
      const days = await renderHistory([
        { date: '2026-10-18', review, respondedAt: '2026-10-19T03:00:00.000Z', respondedMessageId: 'msg_9', respondedBy: 'AGENT' },
      ])
      const link = within(days[0] as HTMLElement).getByRole('link', { name: /^Ditanggapi/ })
      expect(link).toHaveAttribute('href', '/inbox?conversation=conv_1&message=msg_9&lihat=1')
      expect(link).toHaveTextContent('19 Okt 10.00')
      expect(link.closest('summary')).not.toBeNull() // terlihat saat <details> tertutup
      expect(days[0]).not.toHaveAttribute('open')
      expect(link).toHaveAttribute('title', expect.stringContaining('belum tentu semua pertanyaan terjawab'))
      expect(days[0].textContent).toContain('belum tentu semua pertanyaan terjawab')

      // Klik tautan tidak membuka/menutup <details>.
      fireEvent.click(link)
      expect(days[0]).not.toHaveAttribute('open')
    })

    it('dibalas bot: kata-katanya "Dibalas bot"', async () => {
      const days = await renderHistory([
        { date: '2026-10-18', review: { ...review, status: 'tidak_jelas' }, respondedAt: '2026-10-19T03:00:00.000Z', respondedMessageId: 'msg_9', respondedBy: 'BOT' },
      ])
      expect(within(days[0] as HTMLElement).getByRole('link', { name: /Dibalas bot/ })).toBeInTheDocument()
      expect(within(days[0] as HTMLElement).queryByText(/^Ditanggapi/)).not.toBeInTheDocument()
    })

    it('belum ada tanggapan: "Belum ditanggapi" bernada peringatan, tanpa tautan', async () => {
      const days = await renderHistory([{ date: '2026-10-18', review, ...NO_REPLY }])
      const note = within(days[0] as HTMLElement).getByText('Belum ditanggapi')
      expect(note.className).toMatch(/warning/)
      expect(note.closest('summary')).not.toBeNull()
      expect(within(days[0] as HTMLElement).queryByRole('link', { name: /tim|bot/i })).not.toBeInTheDocument()
    })

    it('status selesai: tanpa penanda apa pun', async () => {
      const days = await renderHistory([{ date: '2026-10-18', review: { ...review, status: 'selesai' }, ...NO_REPLY }])
      expect(days[0].textContent).not.toMatch(/ditanggapi|dibalas bot|belum ditanggapi/i)
      expect(within(days[0] as HTMLElement).queryByRole('link')).not.toBeInTheDocument()
      expect(days[0].querySelector('summary a, summary [title]')).toBeNull()
    })
  })
})

describe('ChatReviewTab: poin berjenis + label profil (owner 2026-10-22)', () => {
  it('poin berjenis tampil berurutan dengan nama jenisnya (Komplain paling atas), juga untuk tamu ber-booking; label profil tampil sebagai chip di atasnya', async () => {
    const typed = {
      ...review,
      jenisKontak: 'tamu_existing' as const,
      profil: [
        { label: 'komplain' as const, messageId: 'msg_2' },
        { label: 'pasangan' as const, messageId: 'msg_1' },
      ],
      poinPenting: [
        { jenis: 'komplain' as const, teks: 'Jemputan telat 1 jam; minta maaf' },
        { jenis: 'keputusan' as const, teks: 'Pilih 3D/4D, paling lambat 25 Okt', messageId: 'msg_4' },
        { jenis: 'jemput' as const, teks: 'Jemput 10.00 (booking: 07.00)' },
      ],
    }
    stubFetch(() => json(response({ latest: { review: typed, at: '2026-10-19T02:00:00.000Z' } })))
    render(<ChatReviewTab conversationId="conv_1" />)

    const region = await screen.findByRole('region', { name: 'Ringkasan chat' })
    // Label profil tampil sebagai chip (menaut ke pesan bukti, "Ada komplain" merah) DAN rinciannya tetap di poin penting.
    const chips = within(region).getByRole('list', { name: 'Profil tamu' })
    const complaint = within(chips).getByRole('link', { name: 'Ada komplain (lihat pesan bukti)' })
    expect(complaint).toHaveAttribute('href', '/inbox?conversation=conv_1&message=msg_2&lihat=1')
    expect(complaint.className).toMatch(/danger/)
    expect(within(chips).getByRole('link', { name: 'Pasangan (lihat pesan bukti)' }).className).not.toMatch(/danger/)

    const points = within(within(region).getByRole('list', { name: 'Poin penting' })).getAllByRole('listitem')
    expect(points).toHaveLength(3)
    expect(points[0]).toHaveTextContent(/^Komplain Jemputan telat 1 jam; minta maaf$/)
    expect(points[1]).toHaveTextContent(/^Keputusan Pilih 3D\/4D, paling lambat 25 Okt$/)
    expect(points[2]).toHaveTextContent(/^Jemput\/antar Jemput 10\.00 \(booking: 07\.00\)$/)
    // Tidak dilipat walau tamu sudah booking: isinya hanya perbedaan/tambahan dari data booking.
    expect(points[0].closest('details')).toBeNull()
    expect(within(region).queryByText(/^Poin penting \(/)).not.toBeInTheDocument()
  })

})

describe('ChatReviewTab: Disematkan', () => {
  const pinned = [
    { id: 'a1', type: 'CHANGE' as const, field: 'pickup_point', proposedValue: 'Hotel Santika', sourceMessageId: 'msg_5', createdAt: '2026-10-20T01:00:00.000Z' },
    { id: 'a2', type: 'MISMATCH' as const, field: 'total_pax', proposedValue: 4, sourceMessageId: null, createdAt: '2026-10-20T01:05:00.000Z' },
  ]
  const changeHistory = [
    { id: 'e1', event: 'EXECUTED', actor: 'ACCOUNT' as const, accountName: 'Dewi', reason: null, sourceMessageId: 'msg_7', oldValue: 'A', newValue: 'B', createdAt: '2026-10-20T02:00:00.000Z' },
  ]

  it('Disematkan paling atas, butir ber-sourceMessageId menaut ke pesan; riwayat perubahan tidak di tab ini (ada di tab Kontak)', async () => {
    stubFetch(() => json(response({ pinned, changeHistory })))
    const { container } = render(<ChatReviewTab conversationId="conv_1" />)

    const pin = await screen.findByRole('region', { name: 'Disematkan' })
    expect(container.querySelector('section')).toBe(pin)
    const rows = within(pin).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Pickup: Hotel Santika')
    expect(rows[0]).toHaveTextContent('Permintaan perubahan · belum dipenuhi')
    expect(within(rows[0]).getByRole('link', { name: 'Lihat pesan' })).toHaveAttribute(
      'href',
      '/inbox?conversation=conv_1&message=msg_5&lihat=1'
    )
    expect(within(rows[1]).queryByRole('link')).not.toBeInTheDocument()

    expect(screen.queryByRole('region', { name: 'Riwayat perubahan' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Dewi/)).not.toBeInTheDocument()
  })

  it('tanpa aksi: Disematkan tidak dirender', async () => {
    stubFetch(() => json(response()))
    render(<ChatReviewTab conversationId="conv_1" />)
    await screen.findByRole('region', { name: 'Ringkasan chat' })
    expect(screen.queryByRole('region', { name: 'Disematkan' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Riwayat perubahan' })).not.toBeInTheDocument()
  })

  it('memuat ulang saat menerima booking-actions.changed / conversation.updated untuk percakapan ini saja', async () => {
    let onmessage: ((e: { data: string }) => void) | null = null
    class FakeES {
      set onmessage(fn: (e: { data: string }) => void) {
        onmessage = fn
      }
      close() {}
    }
    vi.stubGlobal('EventSource', FakeES)
    const fetchMock = stubFetch(() => json(response()))
    render(<ChatReviewTab conversationId="conv_1" />)
    await screen.findByRole('region', { name: 'Ringkasan chat' })
    expect(onmessage).not.toBeNull()
    const calls = () => fetchMock.mock.calls.length
    const before = calls()

    onmessage!({ data: JSON.stringify({ type: 'booking-actions.changed', conversationId: 'conv_lain' }) })
    expect(calls()).toBe(before)
    onmessage!({ data: JSON.stringify({ type: 'booking-actions.changed', conversationId: 'conv_1' }) })
    await waitFor(() => expect(calls()).toBe(before + 1))
    onmessage!({ data: JSON.stringify({ type: 'conversation.updated', conversationId: 'conv_1' }) })
    await waitFor(() => expect(calls()).toBe(before + 2))
  })
})
