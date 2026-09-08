/**
 * Gerbang perilaku halaman Alur Live (bagian C).
 *
 * Yang diuji di sini bukan "kanvasnya terlihat bagus", melainkan lima janji yang membuat halaman
 * ini layak dipercaya sebagai alat pandang operator:
 *
 *   (a) event live menyalakan kotak YANG BENAR — bukan kotak apa pun;
 *   (b) beberapa run yang berjalan bersamaan tetap bisa dibedakan, tidak saling menimpa;
 *   (c) satu step kasar bisa dibuka dan isinya nyata (sub-langkah + letaknya di kode);
 *   (d) run lama yang jejaknya tidak pernah terekam disebut apa adanya, BUKAN sebagai gagal;
 *   (e) halaman tanpa satu pun run adalah keadaan normal yang tergambar, bukan spinner abadi.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import PipelineLivePage from './page'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent)
  }
}

/** Persis bentuk yang disiarkan `src/lib/pipeline/tracer.ts`. */
function stepEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'pipeline.step',
    runId: 'run_live_1',
    conversationId: 'conv_1',
    stepId: 'pahami-kebutuhan',
    status: 'mulai',
    at: '2026-09-08T04:00:00.000Z',
    ...overrides,
  }
}

function historyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run_1',
    conversationId: 'conv_1',
    contactName: 'Bruno Figarola',
    contactPhone: '6281234567890',
    mode: 'faq',
    status: 'REPLIED',
    inboundPreview: 'berapa harga ijen 3d2n?',
    latencyMs: 2400,
    error: null,
    startedAt: '2026-09-08T03:00:00.000Z',
    finishedAt: '2026-09-08T03:00:02.400Z',
    stepsRecorded: true,
    stepCount: 4,
    lastStepId: 'kirim-balasan',
    lastStepStatus: 'selesai',
    ...overrides,
  }
}

function runDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run_1',
    conversationId: 'conv_1',
    contactName: 'Bruno Figarola',
    contactPhone: '6281234567890',
    mode: 'faq',
    status: 'REPLIED',
    inboundPreview: 'berapa harga ijen 3d2n?',
    latencyMs: 2400,
    error: null,
    startedAt: '2026-09-08T03:00:00.000Z',
    finishedAt: '2026-09-08T03:00:02.400Z',
    steps: [
      { stepId: 'terima-pesan', status: 'selesai', at: '2026-09-08T03:00:00.000Z' },
      {
        stepId: 'kumpulkan-burst',
        status: 'berhenti',
        at: '2026-09-08T03:00:00.100Z',
        detail: { alasan: 'rate limit percakapan terlampaui' },
      },
    ],
    ...overrides,
  }
}

type FetchOptions = { history?: unknown[]; detail?: unknown; funnelStages?: { id: string; count: number }[]; funnelTotal?: number }

function stubFetch(options: FetchOptions = {}) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/pipeline/funnel')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            stages: options.funnelStages ?? [
              { id: 'MASUK', count: 3 },
              { id: 'TANYA', count: 2 },
              { id: 'ADA_TUJUAN', count: 1 },
              { id: 'ADA_ASAL_LAMA', count: 0 },
              { id: 'ADA_KOTA_AKHIR', count: 0 },
              { id: 'DITERUSKAN', count: 4 },
            ],
            total: options.funnelTotal ?? 10,
            windowSize: 500,
          }),
      } as Response)
    }
    if (/\/pipeline\/runs\/[^?]+$/.test(url)) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(options.detail ?? runDetail()) } as Response)
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ items: options.history ?? [historyRow()], limit: 20 }),
    } as Response)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function node(container: HTMLElement, stepId: string): HTMLElement {
  const element = container.querySelector(`[data-step-id="${stepId}"]`)
  if (!element) throw new Error(`kotak ${stepId} tidak ada di kanvas`)
  return element as HTMLElement
}

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// `src/lib/pipeline/tracer.ts` menarik `@/lib/realtime` dan hanya boleh hidup di server. Yang
// menjaganya tetap begitu di sisi klien adalah kebiasaan menulis `import type`, dan kebiasaan
// tidak menggagalkan build. Test ini yang menggagalkannya.
describe('sisi klien tidak menarik nilai apa pun dari tracer', () => {
  const clientFiles = [
    path.join(process.cwd(), 'src', 'app', '(authenticated)', 'bot-control', 'pipeline', 'page.tsx'),
    path.join(process.cwd(), 'src', 'components', 'bot-control', 'PipelineCanvas.tsx'),
    path.join(process.cwd(), 'src', 'components', 'bot-control', 'PipelineStepDetail.tsx'),
  ]

  it('mengimpor tracer hanya sebagai tipe', () => {
    for (const file of clientFiles) {
      const source = readFileSync(file, 'utf-8')
      for (const line of source.split('\n')) {
        if (!line.includes('@/lib/pipeline/tracer')) continue
        expect(line.trimStart(), file).toMatch(/^import type /)
      }
    }
  })
})

describe('halaman Alur Live', () => {
  it('menggambar kesebelas step meski belum ada satu pun run', async () => {
    stubFetch({ history: [] })
    const { container } = render(<PipelineLivePage />)

    await screen.findByText('Belum ada run yang tercatat.')
    expect(container.querySelectorAll('[data-step-id]')).toHaveLength(11)
  })

  // (a)
  it('event pipeline.step yang masuk menyalakan node yang benar', async () => {
    stubFetch()
    const { container } = render(<PipelineLivePage />)
    await screen.findByText('berapa harga ijen 3d2n?')

    act(() => {
      FakeEventSource.instances.at(-1)!.emit(stepEvent({ stepId: 'pahami-kebutuhan', status: 'mulai' }))
    })

    const lit = node(container, 'pahami-kebutuhan')
    expect(lit).toHaveAttribute('data-live-count', '1')
    // Namanya ikut, bukan hanya warnanya: sorotan yang hanya berupa warna tidak memberi tahu
    // siapa pun run milik siapa.
    expect(within(lit).getByText(/Bruno Figarola/)).toBeInTheDocument()
    expect(within(lit).getByText(/Sedang berjalan/)).toBeInTheDocument()

    // Tetangganya tidak ikut menyala. Tanpa janji ini, "menyalakan semua kotak" juga lulus (a).
    expect(node(container, 'cek-booking')).toHaveAttribute('data-live-count', '0')
    expect(node(container, 'susun-balasan')).toHaveAttribute('data-live-count', '0')
  })

  // (b)
  it('dua run bersamaan tidak saling menimpa sorotan', async () => {
    stubFetch({
      history: [historyRow(), historyRow({ id: 'run_2', conversationId: 'conv_2', contactName: 'Sari Dewi' })],
    })
    const { container } = render(<PipelineLivePage />)
    await screen.findByText('Sari Dewi')

    const source = FakeEventSource.instances.at(-1)!
    act(() => {
      source.emit(stepEvent({ runId: 'run_a', conversationId: 'conv_1', stepId: 'cek-eskalasi' }))
      source.emit(stepEvent({ runId: 'run_b', conversationId: 'conv_2', stepId: 'susun-balasan' }))
    })

    // Dua run di dua step: masing-masing di tempatnya sendiri.
    expect(within(node(container, 'cek-eskalasi')).getByText(/Bruno Figarola/)).toBeInTheDocument()
    expect(within(node(container, 'susun-balasan')).getByText(/Sari Dewi/)).toBeInTheDocument()

    // Dua run di SATU step: dua penanda berdampingan, bukan satu yang menang.
    act(() => {
      source.emit(stepEvent({ runId: 'run_b', conversationId: 'conv_2', stepId: 'cek-eskalasi', status: 'selesai' }))
    })
    const shared = node(container, 'cek-eskalasi')
    expect(shared).toHaveAttribute('data-live-count', '2')
    expect(within(shared).getByText(/Bruno Figarola/)).toBeInTheDocument()
    expect(within(shared).getByText(/Sari Dewi/)).toBeInTheDocument()
    // Dan run yang pindah tidak meninggalkan bayangan di step lamanya.
    expect(node(container, 'susun-balasan')).toHaveAttribute('data-live-count', '0')
  })

  it('membatasi jumlah run live yang disimpan supaya tab yang dibiarkan terbuka tidak menggelembung', async () => {
    stubFetch({ history: [] })
    const { container } = render(<PipelineLivePage />)
    await screen.findByText('Belum ada run yang tercatat.')

    const source = FakeEventSource.instances.at(-1)!
    act(() => {
      // 30 run berturut-turut — semalam penuh lalu lintas, dipadatkan.
      for (let i = 0; i < 30; i++) {
        source.emit(stepEvent({ runId: `run_${i}`, conversationId: `conv_${i}`, stepId: 'cek-eskalasi' }))
      }
    })

    expect(within(node(container, 'cek-eskalasi')).getAllByText(/Percakapan/)).toHaveLength(8)
    expect(screen.getByText(/8 run terpantau/)).toBeInTheDocument()
  })

  // (c)
  it('klik step kasar membuka detail berisi subStep + sourceRef', async () => {
    stubFetch()
    const { container } = render(<PipelineLivePage />)
    fireEvent.click(await screen.findByText('berapa harga ijen 3d2n?'))
    // Jejak run yang dipilih sudah sampai — kotaknya sudah berwarna sesuai jalurnya.
    await waitFor(() => expect(node(container, 'kumpulkan-burst')).toHaveAttribute('data-step-status', 'berhenti'))

    fireEvent.click(node(container, 'kumpulkan-burst'))

    // Sub-langkah aslinya, yaitu node registry lama yang dikelompokkan step kasar ini.
    expect(screen.getByText('Debounce pesan beruntun')).toBeInTheDocument()
    expect(screen.getByText('Cek ulang botEnabled')).toBeInTheDocument()
    expect(screen.getByText('Rate limit percakapan')).toBeInTheDocument()
    // Letaknya di kode — inilah yang membuat kanvas ini bisa diperiksa, bukan sekadar dipercaya.
    expect(screen.getByText('src/lib/bot/rate-limiter.ts · checkAndRecordRateLimit')).toBeInTheDocument()
    // Setiap sub-langkah membawa penunjuk kodenya SENDIRI, bukan mewarisi punya step kasarnya.
    const subStep = screen.getByText('Debounce pesan beruntun').closest('li') as HTMLElement
    expect(within(subStep).getByText('src/lib/inbound.ts · scheduleBotRun')).toBeInTheDocument()
    // Dan apa yang benar-benar terjadi pada run yang sedang dipilih di step itu.
    expect(screen.getByText(/rate limit percakapan terlampaui/)).toBeInTheDocument()
  })

  // (d)
  it('run lama ber-steps NULL ditampilkan sebagai tidak terekam, bukan gagal', async () => {
    stubFetch({
      history: [historyRow({ stepsRecorded: false, stepCount: 0, lastStepId: null, lastStepStatus: null })],
      detail: runDetail({ steps: null }),
    })
    const { container } = render(<PipelineLivePage />)

    const row = (await screen.findByText('berapa harga ijen 3d2n?')).closest('button') as HTMLElement
    expect(within(row).getByText('Jejak langkah tidak terekam')).toBeInTheDocument()
    // Statusnya sendiri tetap apa adanya, dan tidak ada satu pun kata "gagal" di baris itu.
    expect(within(row).getByText('REPLIED')).toBeInTheDocument()
    expect(row.textContent?.toLowerCase()).not.toContain('gagal')

    fireEvent.click(row)
    fireEvent.click(node(container, 'kumpulkan-burst'))

    await waitFor(() =>
      expect(screen.getByText(/run berjalan sebelum instrumentasi ada/)).toBeInTheDocument()
    )
    expect(screen.getByText(/Bukan berarti run-nya gagal/)).toBeInTheDocument()
    // Kanvasnya tidak berpura-pura tahu jalurnya: tidak ada kotak yang diwarnai status.
    expect(container.querySelectorAll('[data-step-status]:not([data-step-status=""])')).toHaveLength(0)
  })

  // (e)
  it('halaman kosong merender keadaan kosong yang wajar, bukan spinner abadi', async () => {
    stubFetch({ history: [], funnelStages: [], funnelTotal: 0 })
    const { container } = render(<PipelineLivePage />)

    await screen.findByText(/Belum ada satu pun run/)
    // Tidak ada yang menggantung: pemuatan riwayat dan funnel keduanya sudah selesai.
    expect(screen.queryByText('Memuat riwayat run...')).not.toBeInTheDocument()
    expect(screen.queryByText('Memuat sebaran funnel...')).not.toBeInTheDocument()
    // Kosong itu normal, dan dikatakan begitu.
    expect(screen.getByText(/keadaan normal saat tidak ada pesan masuk/)).toBeInTheDocument()
    expect(screen.getByText(/Belum ada percakapan yang bisa dipetakan ke funnel/)).toBeInTheDocument()
    // Petanya tetap ada — halaman kosong bukan halaman putih.
    expect(container.querySelectorAll('[data-step-id]')).toHaveLength(11)
  })

  it('mengabaikan event SSE yang bukan miliknya tanpa menyalakan apa pun', async () => {
    stubFetch({ history: [] })
    const { container } = render(<PipelineLivePage />)
    await screen.findByText('Belum ada run yang tercatat.')

    act(() => {
      const source = FakeEventSource.instances.at(-1)!
      source.emit({ type: 'message.created', conversationId: 'conv_1', message: {} })
      source.emit({ type: 'handoff.alert', conversationId: 'conv_1', contactName: 'Bruno' })
      // Bentuk pipeline.step yang rusak: step yang tidak ada di registry, status karangan.
      source.emit(stepEvent({ stepId: 'langkah-karangan' }))
      source.emit(stepEvent({ runId: 'run_x', status: 'entah' }))
      source.onmessage?.({ data: 'bukan json' } as MessageEvent)
    })

    expect(container.querySelectorAll('[data-live-count="0"]')).toHaveLength(11)
    expect(screen.getByText(/Belum ada run yang berjalan/)).toBeInTheDocument()
  })

  it('menutup EventSource saat halaman ditinggalkan', async () => {
    stubFetch({ history: [] })
    const { unmount } = render(<PipelineLivePage />)
    await screen.findByText('Belum ada run yang tercatat.')

    unmount()
    expect(FakeEventSource.instances.at(-1)!.close).toHaveBeenCalled()
  })

  it('menautkan run riwayat yang dipilih ke penalarannya di Decision Logs', async () => {
    stubFetch()
    render(<PipelineLivePage />)
    fireEvent.click(await screen.findByText('berapa harga ijen 3d2n?'))

    // Id-nya sama persis dengan baris BotDecisionRun, jadi tautannya mendarat di keputusan itu
    // sendiri — bukan di daftar yang harus dicari ulang.
    const link = await screen.findByRole('link', { name: /Decision Logs/ })
    expect(link).toHaveAttribute('href', '/bot-control/decisions?run=run_1')
  })

  it('menyalakan jalur run riwayat yang dipilih di kanvas yang sama', async () => {
    stubFetch()
    const { container } = render(<PipelineLivePage />)
    fireEvent.click(await screen.findByText('berapa harga ijen 3d2n?'))

    await waitFor(() => expect(node(container, 'terima-pesan')).toHaveAttribute('data-step-status', 'selesai'))
    expect(node(container, 'kumpulkan-burst')).toHaveAttribute('data-step-status', 'berhenti')
    // Step yang tidak dilewati run itu tetap netral, bukan ditebak.
    expect(node(container, 'susun-balasan')).toHaveAttribute('data-step-status', '')
  })
})
