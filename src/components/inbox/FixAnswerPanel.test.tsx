import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { FixAnswerPanel } from './FixAnswerPanel'
import type { BotDecision } from '@/lib/bot/types'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const REASON = 'Harga ATV sudah naik sejak Agustus'
const QUESTION = 'Berapa harga ATV sekarang?'

const trace: BotDecision = {
  mode: 'faq',
  draft: 'Harga ATV Rp350.000.',
  sourceTopic: 'price',
  knowledge: {
    catalogLines: [],
    managedLines: [
      { line: 'ATV 1 jam: IDR 350000', source: 'FAQ Harga ATV (v3)', sourceId: 'ks_1', sourceKey: 'managed/atv', version: 3 },
      { line: 'Berapa harga ATV? — Mulai Rp350.000.', source: 'FAQ Harga ATV (v3)', sourceId: 'ks_1', sourceKey: 'managed/atv', version: 3 },
      { line: 'Cuaca dingin -- bawa jaket.', source: 'Info Umum (v1)' },
    ],
    rejected: [],
    gateBypassed: false,
  },
}

type Route = { status?: number; body: unknown }

/** Kunci = "<METHOD> <url>"; permintaan yang tidak terdaftar membuat test gagal keras. */
function stubFetch(routes: Record<string, Route>) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url)}`
    const route = routes[key]
    if (!route) throw new Error(`fetch tak terduga: ${key}`)
    const status = route.status ?? 200
    return { ok: status < 400, status, json: async () => route.body } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const RUN_ROUTES: Record<string, Route> = {
  'GET /api/bot-control/decisions?messageId=msg_bot&limit=1': { body: { items: [{ id: 'run_1' }] } },
  'GET /api/bot-control/decisions/run_1': {
    body: { id: 'run_1', conversationId: 'conv_1', inboundText: QUESTION, replyText: 'Harga ATV Rp350.000.' },
  },
  'GET /api/inbox/gaps?messageId=msg_bot&limit=1': { body: { count: 1, items: [{ id: 'gap_1' }] } },
}

const SAVED = { sourceId: 'ks_1', revisionId: 'krev_4', version: 4, status: 'PUBLISHED', title: 'FAQ Harga ATV', flagged: true }

const KNOWLEDGE_ROUTE: Record<string, Route> = {
  'GET /api/inbox/knowledge/ks_1': {
    body: { title: 'FAQ Harga ATV', summary: null, items: [{ question: 'Berapa harga ATV?', answer: 'Mulai Rp350.000.' }], version: 3 },
  },
}

/** Hasil uji ulang: jawaban baru yang paragrafnya cocok dengan entri `ks_1`. */
function retestBody(overrides: Record<string, unknown> = {}) {
  return {
    reply: 'Harga ATV mulai Rp400.000 per orang.',
    knowledge: {
      catalogLines: [],
      managedLines: [{ line: 'ATV 1 jam: IDR 400000', source: 'FAQ Harga ATV (v4)', sourceId: 'ks_1', sourceKey: 'managed/atv', version: 4 }],
      rejected: [],
      gateBypassed: false,
      attributions: [{ paragraph: 0, lines: [{ kind: 'managed', line: 'ATV 1 jam: IDR 400000', sourceId: 'ks_1', title: 'FAQ Harga ATV', version: 4 }] }],
    },
    ...overrides,
  }
}

/** Menyimpan dari editor yang sudah terbuka, sampai revisi aktif. */
function saveFromEditor(answer = 'Mulai Rp400.000.') {
  fireEvent.change(screen.getByLabelText('Jawaban item 1'), { target: { value: answer } })
  fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: REASON } })
  fireEvent.click(screen.getByRole('button', { name: 'Simpan & aktifkan' }))
}

function renderPanel() {
  render(<FixAnswerPanel messageId="msg_bot" trace={trace} replyText="Harga ATV Rp350.000." onClose={() => {}} />)
}

function fixBody(fetchMock: ReturnType<typeof stubFetch>): unknown {
  const call = fetchMock.mock.calls.find(([url]) => String(url) === '/api/inbox/decisions/run_1/fix')
  return JSON.parse(String(call?.[1]?.body))
}

describe('FixAnswerPanel', () => {
  it('menampilkan pertanyaan pelanggan, jawaban bot, dan knowledge unik per sumber', async () => {
    stubFetch(RUN_ROUTES)
    renderPanel()

    expect(await screen.findByText(QUESTION)).toBeInTheDocument()
    expect(screen.getByText('Harga ATV Rp350.000.')).toBeInTheDocument()
    expect(screen.getAllByText('FAQ Harga ATV (v3)')).toHaveLength(1)
    // Baris lama tanpa sourceId tetap tampil, tetapi tanpa tombol Edit.
    expect(screen.getByText('Info Umum (v1)')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1)
  })

  it('Edit: membuka editor dari revisi PUBLISHED terkini, lalu menyimpan & mengaktifkan', async () => {
    const fetchMock = stubFetch({
      ...RUN_ROUTES,
      'GET /api/inbox/knowledge/ks_1': {
        body: { title: 'FAQ Harga ATV', summary: null, items: [{ question: 'Berapa harga ATV?', answer: 'Mulai Rp350.000.' }], version: 3 },
      },
      'POST /api/inbox/decisions/run_1/fix': {
        body: { sourceId: 'ks_1', revisionId: 'krev_4', version: 4, status: 'PUBLISHED', title: 'FAQ Harga ATV', flagged: true },
      },
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(await screen.findByDisplayValue('Mulai Rp350.000.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Simpan draft' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Jawaban item 1'), { target: { value: 'Mulai Rp400.000.' } })
    fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: REASON } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & aktifkan' }))

    expect(await screen.findByText('Aktif: FAQ Harga ATV v4')).toBeInTheDocument()
    expect(screen.getByText('Jawaban bot ini ditandai perlu diperbaiki.')).toBeInTheDocument()
    expect(fixBody(fetchMock)).toEqual({
      kind: 'edit',
      sourceId: 'ks_1',
      title: 'FAQ Harga ATV',
      items: [{ question: 'Berapa harga ATV?', answer: 'Mulai Rp400.000.' }],
      reason: REASON,
    })
  })

  it('Tambah jawaban yang benar: editor berisi satu item dengan pertanyaan pelanggan', async () => {
    const fetchMock = stubFetch({
      ...RUN_ROUTES,
      'POST /api/inbox/decisions/run_1/fix': {
        body: { sourceId: 'ks_new', revisionId: 'krev_new', version: 1, status: 'PUBLISHED', title: QUESTION, flagged: true },
      },
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Tambah jawaban yang benar' }))
    expect(screen.getByLabelText('Pertanyaan item 1')).toHaveValue(QUESTION)
    expect(screen.getByLabelText('Jawaban item 1')).toHaveValue('')

    fireEvent.change(screen.getByLabelText('Jawaban item 1'), { target: { value: 'ATV 1 jam Rp400.000 per orang.' } })
    fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: REASON } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & aktifkan' }))

    expect(await screen.findByText(`Aktif: ${QUESTION} v1`)).toBeInTheDocument()
    expect(fixBody(fetchMock)).toEqual({
      kind: 'new',
      title: QUESTION,
      items: [{ question: QUESTION, answer: 'ATV 1 jam Rp400.000 per orang.' }],
      reason: REASON,
    })
  })

  it('melaporkan jujur bila revisi aktif tetapi penandaan gagal', async () => {
    stubFetch({
      ...RUN_ROUTES,
      'POST /api/inbox/decisions/run_1/fix': {
        body: { sourceId: 'ks_new', revisionId: 'krev_new', version: 1, status: 'PUBLISHED', title: QUESTION, flagged: false },
      },
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Tambah jawaban yang benar' }))
    fireEvent.change(screen.getByLabelText('Jawaban item 1'), { target: { value: 'ATV 1 jam Rp400.000 per orang.' } })
    fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: REASON } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & aktifkan' }))

    expect(await screen.findByText('Revisi sudah aktif, tetapi jawaban ini gagal ditandai.')).toBeInTheDocument()
  })

  it('galat simpan tampil di editor, dan editor tetap terbuka', async () => {
    stubFetch({
      ...RUN_ROUTES,
      'GET /api/inbox/knowledge/ks_1': {
        body: { title: 'FAQ Harga ATV', summary: null, items: [{ question: 'Berapa harga ATV?', answer: 'Mulai Rp350.000.' }], version: 3 },
      },
      'POST /api/inbox/decisions/run_1/fix': {
        status: 409,
        body: { error: 'Entri ini punya draft v4 yang belum diaktifkan. Selesaikan draft itu di halaman Knowledge dulu supaya tidak tertimpa.' },
      },
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByDisplayValue('Mulai Rp350.000.')
    fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: REASON } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & aktifkan' }))

    expect(await screen.findByText(/punya draft v4/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Simpan & aktifkan' })).toBeInTheDocument()
  })

  it('galat membuka entri tampil tanpa menutup panel', async () => {
    stubFetch({
      ...RUN_ROUTES,
      'GET /api/inbox/knowledge/ks_1': { status: 404, body: { error: 'Entri knowledge aktif tidak ditemukan' } },
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Entri knowledge aktif tidak ditemukan')
    expect(screen.getByText(QUESTION)).toBeInTheDocument()
  })

  it('galat memuat keputusan tampil sebagai alert', async () => {
    stubFetch({
      'GET /api/bot-control/decisions?messageId=msg_bot&limit=1': { status: 500, body: { error: 'Gagal memuat daftar keputusan' } },
    })
    renderPanel()

    expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memuat daftar keputusan')
    expect(screen.queryByRole('button', { name: 'Tambah jawaban yang benar' })).not.toBeInTheDocument()
  })

  it('tanpa run tercatat: menjelaskan, tanpa tombol perbaikan', async () => {
    stubFetch({ 'GET /api/bot-control/decisions?messageId=msg_bot&limit=1': { body: { items: [] } } })
    renderPanel()

    expect(await screen.findByText('Keputusan bot untuk pesan ini tidak tercatat, jadi tidak bisa diperbaiki dari sini.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tambah jawaban yang benar' })).not.toBeInTheDocument()
  })
})

describe('FixAnswerPanel — putaran uji ulang', () => {
  it('menguji ulang sendiri setelah revisi aktif, dan menyatakan jawabannya bersumber dari entri baru', async () => {
    const fetchMock = stubFetch({
      ...RUN_ROUTES,
      ...KNOWLEDGE_ROUTE,
      'POST /api/inbox/decisions/run_1/fix': { body: SAVED },
      'POST /api/inbox/retest': { body: retestBody() },
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByDisplayValue('Mulai Rp350.000.')
    saveFromEditor()

    expect(await screen.findByText('Harga ATV mulai Rp400.000 per orang.')).toBeInTheDocument()
    expect(screen.getByText('Bersumber dari entri yang baru disimpan.')).toBeInTheDocument()
    expect(screen.getByText('Jawaban ini sudah sesuai?')).toBeInTheDocument()

    const retestCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/inbox/retest')
    expect(JSON.parse(String(retestCall?.[1]?.body))).toEqual({ message: QUESTION, conversationId: 'conv_1' })
  })

  it('"Sudah sesuai" menutup gap dan mengakhiri putaran', async () => {
    const fetchMock = stubFetch({
      ...RUN_ROUTES,
      ...KNOWLEDGE_ROUTE,
      'POST /api/inbox/decisions/run_1/fix': { body: SAVED },
      'POST /api/inbox/retest': { body: retestBody() },
      'POST /api/inbox/gaps/gap_1/resolve': { body: { id: 'gap_1', resolvedAt: '2026-09-12T03:00:00.000Z' } },
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByDisplayValue('Mulai Rp350.000.')
    saveFromEditor()
    fireEvent.click(await screen.findByRole('button', { name: 'Sudah sesuai' }))

    expect(await screen.findByText('Gap ditandai selesai.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/inbox/gaps/gap_1/resolve')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Belum sesuai' })).not.toBeInTheDocument()
  })

  it('"Belum sesuai" membuka editor lagi dengan catatan operator sebagai alasan revisi berikutnya', async () => {
    stubFetch({
      ...RUN_ROUTES,
      ...KNOWLEDGE_ROUTE,
      'POST /api/inbox/decisions/run_1/fix': { body: SAVED },
      'POST /api/inbox/retest': { body: retestBody() },
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByDisplayValue('Mulai Rp350.000.')
    saveFromEditor()
    fireEvent.click(await screen.findByRole('button', { name: 'Belum sesuai' }))

    const note = 'Harga ATV per orang belum disebut, hanya per jam'
    fireEvent.change(screen.getByLabelText('Apa yang masih belum benar?'), { target: { value: note } })
    fireEvent.click(screen.getByRole('button', { name: 'Perbaiki lagi' }))

    expect(await screen.findByDisplayValue('Mulai Rp350.000.')).toBeInTheDocument()
    expect(screen.getByLabelText('Alasan perubahan')).toHaveValue(note)
  })

  it('menolak "Perbaiki lagi" sebelum catatannya cukup panjang', async () => {
    stubFetch({
      ...RUN_ROUTES,
      ...KNOWLEDGE_ROUTE,
      'POST /api/inbox/decisions/run_1/fix': { body: SAVED },
      'POST /api/inbox/retest': { body: retestBody() },
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByDisplayValue('Mulai Rp350.000.')
    saveFromEditor()
    fireEvent.click(await screen.findByRole('button', { name: 'Belum sesuai' }))

    fireEvent.change(screen.getByLabelText('Apa yang masih belum benar?'), { target: { value: 'salah' } })
    expect(screen.getByRole('button', { name: 'Perbaiki lagi' })).toBeDisabled()
  })

  it('mengatakan apa adanya saat jawaban barunya tetap tidak bersumber', async () => {
    stubFetch({
      ...RUN_ROUTES,
      ...KNOWLEDGE_ROUTE,
      'POST /api/inbox/decisions/run_1/fix': { body: SAVED },
      'POST /api/inbox/retest': { body: retestBody({ knowledge: { catalogLines: [], managedLines: [], rejected: [], gateBypassed: false, attributions: [] } }) },
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByDisplayValue('Mulai Rp350.000.')
    saveFromEditor()

    expect(await screen.findByText('Belum bersumber: tidak ada paragraf yang cocok dengan fakta mana pun.')).toBeInTheDocument()
  })

  it('kegagalan uji ulang tidak menghapus hasil simpan, dan bisa diulang', async () => {
    stubFetch({
      ...RUN_ROUTES,
      ...KNOWLEDGE_ROUTE,
      'POST /api/inbox/decisions/run_1/fix': { body: SAVED },
      'POST /api/inbox/retest': { status: 500, body: { error: 'Gagal menjalankan uji ulang' } },
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByDisplayValue('Mulai Rp350.000.')
    saveFromEditor()

    expect(await screen.findByText('Aktif: FAQ Harga ATV v4')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Gagal menjalankan uji ulang')
    expect(screen.getByRole('button', { name: 'Coba uji ulang lagi' })).toBeInTheDocument()
  })
})
