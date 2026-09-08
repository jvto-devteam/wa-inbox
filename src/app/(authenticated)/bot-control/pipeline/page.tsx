'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SkeletonText } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { PipelineCanvas, RUN_COLOR_CLASSES, STEP_STATUS_LABEL, type CanvasLiveMarker } from '@/components/bot-control/PipelineCanvas'
import { PipelineStepDetail } from '@/components/bot-control/PipelineStepDetail'
import { PipelineFunnelBar, type FunnelCounts } from '@/components/bot-control/PipelineFunnelBar'
import { getPipelineStep, type PipelineStepId } from '@/lib/pipeline/steps'
import { fetchJson } from '@/lib/fetch-json'
import { cn } from '@/lib/utils'
// HANYA tipe. `src/lib/pipeline/tracer.ts` menarik `@/lib/realtime` dan hanya boleh hidup di
// server; `import type` terhapus saat kompilasi, jadi tidak ada satu byte pun dari modul itu
// yang ikut ke browser.
import type { PipelineStepRecord, PipelineStepStatus } from '@/lib/pipeline/tracer'
import { PageHeader } from '@/components/ui/page-header'

/**
 * Alur Live — kanvas alur pesan masuk sampai balasan terkirim, plus funnel penjualan.
 *
 * Halaman ini MEMBACA. Tidak ada tombol yang mengubah runtime, tidak ada mutasi, tidak ada
 * konfigurasi. Itu sebabnya route pendukungnya cukup GET untuk setiap user yang login.
 *
 * --- Tiga sumber yang dijahit di sini ---
 *
 *   1. Peta: `PIPELINE_STEPS` (statis, dari kode).
 *   2. Live: event `pipeline.step` lewat satu `EventSource('/api/sse')`.
 *   3. Riwayat: `BotDecisionRun` lewat /api/bot-control/pipeline/runs.
 *
 * Ketiganya bertemu di `runId`: tracer membuat id run di awal dan menyerahkannya ke
 * `recordBotDecisionRun` sebagai `id` baris, jadi run yang barusan berkedip live adalah baris
 * yang sama yang muncul di riwayat sesaat kemudian — dan juga baris yang sama di Decision Logs.
 *
 * --- Kenapa penyaringan dan pembatasan ada di klien ---
 *
 * `/api/sse` menyiarkan SEMUA event ke SEMUA tab; belum ada penyaringan per-halaman di server.
 * Tab ini karena itu menyaring sendiri (`event.type === 'pipeline.step'`) dan, yang lebih
 * penting, MEMBATASI apa yang disimpannya: sebuah tab yang dibiarkan terbuka semalaman akan
 * menerima ribuan event, dan menyimpan semuanya berarti satu tab yang menggelembung sampai
 * dimatikan paksa. Batasnya dua lapis dan keduanya keras:
 *   - `MAX_LIVE_RUNS` run yang disimpan; yang paling lama tidak bergerak dibuang lebih dulu.
 *   - `MAX_STEPS_PER_LIVE_RUN` langkah per run.
 * Jadi pemakaian memori halaman ini punya PLAFON, bukan pertumbuhan.
 */

/** Plafon run live yang disimpan di memori. Delapan sudah lebih banyak daripada jumlah run yang
 * bisa berjalan bersamaan pada satu nomor WhatsApp; yang ke-9 mengusir yang paling lama diam. */
const MAX_LIVE_RUNS = 8
/** Plafon langkah per run live. Sama dengan batas tulis tracer (MAX_STEPS_PER_RUN = 64). */
const MAX_STEPS_PER_LIVE_RUN = 64
/** Jumlah run riwayat yang diambil. Sengaja pendek: ini jendela "barusan", bukan arsip. */
const HISTORY_LIMIT = 20

type RunSummary = {
  id: string
  conversationId: string
  contactName: string | null
  contactPhone: string | null
  mode: string
  status: string
  inboundPreview: string
  latencyMs: number | null
  error: string | null
  startedAt: string
  finishedAt: string | null
  /** false = jejak langkah run ini TIDAK PERNAH terekam. Bukan sinonim dari gagal. */
  stepsRecorded: boolean
  stepCount: number
  lastStepId: PipelineStepId | null
  lastStepStatus: PipelineStepStatus | null
}

type RunDetail = Omit<RunSummary, 'stepsRecorded' | 'stepCount' | 'lastStepId' | 'lastStepStatus'> & {
  /** null = tidak terekam. */
  steps: PipelineStepRecord[] | null
}

type LiveRun = {
  runId: string
  conversationId: string
  colorIndex: number
  steps: PipelineStepRecord[]
  updatedAt: number
}

type Selection = { source: 'live' | 'riwayat'; runId: string }

/** Bentuk event yang disiarkan `src/lib/pipeline/tracer.ts`. */
type PipelineStepEvent = {
  type: 'pipeline.step'
  runId: string
  conversationId: string
  stepId: PipelineStepId
  status: PipelineStepStatus
  at: string
  detail?: unknown
}

const STEP_STATUSES: readonly string[] = ['mulai', 'selesai', 'dilewati', 'berhenti', 'gagal']

/**
 * Menyaring apa pun yang datang dari SSE menjadi event pipeline yang benar-benar bisa digambar.
 *
 * Bukan sekadar cek `type`: `stepId` dicocokkan ke registry, karena satu-satunya hal yang bisa
 * dilakukan kanvas dengan step yang tidak punya kotak adalah salah menggambar. Event dari versi
 * server yang lebih baru diabaikan diam-diam, bukan meledak.
 */
function toPipelineStepEvent(payload: unknown): PipelineStepEvent | null {
  if (typeof payload !== 'object' || payload === null) return null
  const event = payload as Record<string, unknown>
  if (event.type !== 'pipeline.step') return null
  if (typeof event.runId !== 'string' || event.runId === '') return null
  if (typeof event.conversationId !== 'string') return null
  if (typeof event.stepId !== 'string' || getPipelineStep(event.stepId) === null) return null
  if (typeof event.status !== 'string' || !STEP_STATUSES.includes(event.status)) return null
  return {
    type: 'pipeline.step',
    runId: event.runId,
    conversationId: event.conversationId,
    stepId: event.stepId as PipelineStepId,
    status: event.status as PipelineStepStatus,
    at: typeof event.at === 'string' ? event.at : '',
    ...(event.detail === undefined ? {} : { detail: event.detail }),
  }
}

/**
 * Menyisipkan satu event ke daftar run live, dengan kedua plafon memori ditegakkan di sini.
 *
 * Run BARU dapat slot warna berikutnya (`nextColorIndex`) — bukan posisi arraynya — supaya
 * warna sebuah run tidak berubah ketika run lain diusir dari daftar.
 */
function applyEvent(runs: LiveRun[], event: PipelineStepEvent, nextColorIndex: number): LiveRun[] {
  const record: PipelineStepRecord = {
    stepId: event.stepId,
    status: event.status,
    at: event.at,
    ...(event.detail === undefined ? {} : { detail: event.detail }),
  }
  const now = Date.now()
  const existing = runs.find((run) => run.runId === event.runId)

  if (existing) {
    return runs.map((run) =>
      run.runId === event.runId
        ? { ...run, updatedAt: now, steps: [...run.steps, record].slice(-MAX_STEPS_PER_LIVE_RUN) }
        : run
    )
  }

  const added: LiveRun = {
    runId: event.runId,
    conversationId: event.conversationId,
    colorIndex: nextColorIndex,
    steps: [record],
    updatedAt: now,
  }
  const next = [...runs, added]
  if (next.length <= MAX_LIVE_RUNS) return next
  // Yang dibuang adalah yang paling lama tidak bergerak, bukan yang paling awal muncul: sebuah
  // run panjang yang masih berjalan tidak boleh terusir oleh run-run pendek yang datang belakangan.
  const oldest = next.reduce((a, b) => (a.updatedAt <= b.updatedAt ? a : b))
  return next.filter((run) => run.runId !== oldest.runId)
}

/** Status terakhir per step untuk satu jejak — itulah yang diwarnai kanvas. */
function statusesByStep(steps: PipelineStepRecord[]): Partial<Record<PipelineStepId, PipelineStepStatus>> {
  const result: Partial<Record<PipelineStepId, PipelineStepStatus>> = {}
  for (const step of steps) result[step.stepId] = step.status
  return result
}

function shortId(id: string): string {
  return id.length <= 8 ? id : `…${id.slice(-6)}`
}

export default function PipelineLivePage() {
  const [liveRuns, setLiveRuns] = useState<LiveRun[]>([])
  const [history, setHistory] = useState<RunSummary[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)

  const [funnel, setFunnel] = useState<{ stages: FunnelCounts; total: number; windowSize: number } | null>(null)
  const [funnelError, setFunnelError] = useState<string | null>(null)

  const [selection, setSelection] = useState<Selection | null>(null)
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [selectedStepId, setSelectedStepId] = useState<PipelineStepId | null>(null)
  const [liveConnected, setLiveConnected] = useState(false)

  const colorCounter = useRef(0)

  // Sengaja TIDAK menyalakan `historyLoading` sendiri: state awalnya sudah true, dan tombol
  // "Muat ulang" yang menyalakannya kembali di event handler. Menyetel state secara sinkron di
  // dalam sebuah effect memicu render berantai (dan ditolak eslint react-hooks).
  const loadHistory = useCallback(() => {
    return fetchJson<{ items: RunSummary[] }>(`/api/bot-control/pipeline/runs?limit=${HISTORY_LIMIT}`)
      .then((data) => {
        setHistory(data.items)
        setHistoryError(null)
      })
      .catch((error: unknown) => {
        setHistoryError(error instanceof Error ? error.message : 'Gagal memuat riwayat run')
      })
      .finally(() => setHistoryLoading(false))
  }, [])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  useEffect(() => {
    fetchJson<{ stages: FunnelCounts; total: number; windowSize: number }>('/api/bot-control/pipeline/funnel')
      .then((data) => {
        setFunnel(data)
        setFunnelError(null)
      })
      .catch((error: unknown) => {
        setFunnelError(error instanceof Error ? error.message : 'Gagal memuat sebaran funnel')
      })
  }, [])

  // Satu EventSource untuk halaman ini, ditutup saat halaman ditinggalkan. Setiap tab menerima
  // SEMUA event; penyaringannya di `toPipelineStepEvent`.
  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const source = new EventSource('/api/sse')
    source.onopen = () => setLiveConnected(true)
    source.onmessage = (message: MessageEvent) => {
      let payload: unknown
      try {
        payload = JSON.parse(String(message.data))
      } catch {
        // Baris yang tidak bisa diurai bukan alasan menjatuhkan halaman.
        return
      }
      const event = toPipelineStepEvent(payload)
      if (!event) return
      setLiveConnected(true)
      setLiveRuns((previous) => {
        const known = previous.some((run) => run.runId === event.runId)
        const colorIndex = known ? 0 : colorCounter.current++
        return applyEvent(previous, event, colorIndex)
      })
    }
    source.onerror = () => setLiveConnected(false)
    return () => source.close()
  }, [])

  // Riwayat memberi nama kontak; live hanya membawa conversationId. Run live pada percakapan
  // yang pernah muncul di riwayat karena itu langsung punya nama, dan yang belum pernah muncul
  // memakai potongan id — bukan sel kosong yang tidak bisa dibedakan dari run lain.
  const nameByConversation = useMemo(() => {
    const map = new Map<string, string>()
    for (const run of history) {
      const name = run.contactName ?? run.contactPhone
      if (name && !map.has(run.conversationId)) map.set(run.conversationId, name)
    }
    return map
  }, [history])

  const labelForLiveRun = useCallback(
    (run: LiveRun) => nameByConversation.get(run.conversationId) ?? `Percakapan ${shortId(run.conversationId)}`,
    [nameByConversation]
  )

  const selectedLiveRun = selection?.source === 'live' ? liveRuns.find((run) => run.runId === selection.runId) : undefined

  // Jejak yang sedang diputar ulang di kanvas: dari memori untuk run live, dari route detail
  // untuk run riwayat.
  const replaySteps: PipelineStepRecord[] = useMemo(() => {
    if (selection?.source === 'live') return selectedLiveRun?.steps ?? []
    if (selection?.source === 'riwayat' && detail?.id === selection.runId) return detail.steps ?? []
    return []
  }, [selection, selectedLiveRun, detail])

  const replayStatuses = useMemo(() => statusesByStep(replaySteps), [replaySteps])

  /** Setiap run live disorot di step TERAKHIRNYA — di situlah ia berada sekarang. */
  const liveMarkers = useMemo(() => {
    const markers: Partial<Record<PipelineStepId, CanvasLiveMarker[]>> = {}
    for (const run of liveRuns) {
      const last = run.steps[run.steps.length - 1]
      if (!last) continue
      const list = markers[last.stepId] ?? []
      list.push({ runId: run.runId, label: labelForLiveRun(run), colorIndex: run.colorIndex, status: last.status })
      markers[last.stepId] = list
    }
    return markers
  }, [liveRuns, labelForLiveRun])

  // Detail satu run riwayat diambil hanya ketika run itu benar-benar dibuka — jejak lengkap
  // untuk 20 baris sekaligus adalah 20 array yang 19-nya tidak pernah dilihat.
  useEffect(() => {
    if (selection?.source !== 'riwayat') return
    let cancelled = false
    fetchJson<RunDetail>(`/api/bot-control/pipeline/runs/${selection.runId}`)
      .then((data) => {
        if (cancelled) return
        setDetail(data)
        setDetailError(null)
      })
      .catch((error: unknown) => {
        if (!cancelled) setDetailError(error instanceof Error ? error.message : 'Gagal memuat detail run')
      })
    return () => {
      cancelled = true
    }
  }, [selection])

  const selectedStep = selectedStepId ? getPipelineStep(selectedStepId) : null
  const recordsForSelectedStep = replaySteps.filter((step) => step.stepId === selectedStepId)

  const selectedHistoryRow = selection?.source === 'riwayat' ? history.find((run) => run.id === selection.runId) : undefined
  const selectedRunLabel = selectedLiveRun
    ? labelForLiveRun(selectedLiveRun)
    : selectedHistoryRow
      ? (selectedHistoryRow.contactName ?? selectedHistoryRow.contactPhone ?? shortId(selectedHistoryRow.conversationId))
      : null
  // "Tidak terekam" hanya berlaku untuk run riwayat: run live selalu punya jejak, karena
  // jejaknya justru yang membuatnya muncul di sini.
  const selectedRunUnrecorded = selection?.source === 'riwayat' && selectedHistoryRow?.stepsRecorded === false

  const nothingYet = !historyLoading && history.length === 0 && liveRuns.length === 0

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-6">
      <PageHeader
        title="Alur Live"
        description="Perjalanan satu pesan pelanggan, dari webhook masuk sampai balasan terkirim. Kotak menyala saat ada run yang sedang melewatinya; run yang sudah lewat bisa diputar ulang di kanvas yang sama. Antrean kirim, retry, dan safety guard bukan bagian dari peta ini — itu ada di Outbound Queue."
      />

      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
        <Badge variant={liveConnected ? 'success' : 'muted'}>
          {liveConnected ? 'Aliran live tersambung' : 'Menunggu aliran live'}
        </Badge>
        <span>
          {liveRuns.length === 0
            ? 'Belum ada run yang berjalan — itu keadaan normal saat tidak ada pesan masuk.'
            : `${liveRuns.length} run terpantau (maksimum ${MAX_LIVE_RUNS} disimpan di memori).`}
        </span>
      </div>

      <PipelineCanvas
        replayStatuses={replayStatuses}
        liveMarkers={liveMarkers}
        selectedStepId={selectedStepId}
        onSelectStep={(id) => setSelectedStepId(id)}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)_minmax(0,18rem)]">
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-base font-semibold text-ink">Run</p>
            <Button variant="outline" size="sm" onClick={() => void loadHistory()} disabled={historyLoading}>
              Muat ulang riwayat
            </Button>
          </div>

          {historyError && <p className="text-base text-danger">{historyError}</p>}

          <div className="space-y-1">
            <p className="text-xs font-medium text-ink-subtle">Sedang berjalan</p>
            {liveRuns.length === 0 ? (
              <p className="text-sm text-ink-muted">Tidak ada run yang sedang berjalan.</p>
            ) : (
              <ul className="space-y-1">
                {liveRuns.map((run) => {
                  const last = run.steps[run.steps.length - 1]
                  const step = last ? getPipelineStep(last.stepId) : null
                  const active = selection?.source === 'live' && selection.runId === run.runId
                  return (
                    <li key={run.runId}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => setSelection({ source: 'live', runId: run.runId })}
                        className={cn(
                          'focus-ring w-full rounded-md border p-2 text-left text-sm transition-colors',
                          RUN_COLOR_CLASSES[run.colorIndex % RUN_COLOR_CLASSES.length],
                          active && 'ring-2 ring-ink'
                        )}
                      >
                        <span className="block font-semibold">{labelForLiveRun(run)}</span>
                        <span className="block text-xs opacity-80">
                          {step ? step.label : 'Menunggu langkah pertama'}
                          {last ? ` · ${STEP_STATUS_LABEL[last.status]}` : ''}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-ink-subtle">Riwayat terakhir</p>
            {historyLoading && <SkeletonText lines={3} />}
            {!historyLoading && history.length === 0 && (
              <p className="text-sm text-ink-muted">Belum ada run yang tercatat.</p>
            )}
            <ul className="space-y-1">
              {history.map((run) => {
                const step = run.lastStepId ? getPipelineStep(run.lastStepId) : null
                const active = selection?.source === 'riwayat' && selection.runId === run.id
                return (
                  <li key={run.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelection({ source: 'riwayat', runId: run.id })}
                      className={cn(
                        'focus-ring w-full rounded-md border border-line bg-surface p-2 text-left text-sm transition-colors hover:bg-surface-sunken',
                        active && 'ring-2 ring-ink'
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-ink">
                          {run.contactName ?? run.contactPhone ?? `Percakapan ${shortId(run.conversationId)}`}
                        </span>
                        <span className="font-mono text-xs text-ink-muted">
                          {new Date(run.startedAt).toLocaleTimeString('id-ID')}
                        </span>
                      </span>
                      <span className="block truncate text-xs text-ink-muted">{run.inboundPreview}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1">
                        <Badge variant="muted">{run.status}</Badge>
                        {run.stepsRecorded ? (
                          <span className="text-xs text-ink-muted tabular-nums">
                            {run.stepCount} langkah{step ? ` · berhenti di ${step.label}` : ''}
                          </span>
                        ) : (
                          // Baris lama, dari sebelum instrumentasi ada. Menampilkannya sebagai
                          // kegagalan akan membuat seluruh riwayat lama terlihat seperti bot
                          // yang rusak.
                          <span className="text-xs text-ink-muted">Jejak langkah tidak terekam</span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>

          {nothingYet && (
            <p className="border-t border-line pt-2 text-sm text-ink-muted">
              Belum ada satu pun run. Kanvas di atas tetap menampilkan alurnya — sorotan muncul sendiri begitu ada pesan
              pelanggan yang masuk.
            </p>
          )}
        </Card>

        <Card className="space-y-2 p-4">
          {detailError && <p className="text-base text-danger">{detailError}</p>}
          <PipelineStepDetail
            step={selectedStep}
            records={recordsForSelectedStep}
            runLabel={selectedRunLabel}
            runUnrecorded={selectedRunUnrecorded === true}
          />
          {/* runId di sini ADALAH id baris BotDecisionRun (tracer membuatnya di awal dan
              menyerahkannya ke recordBotDecisionRun), jadi tautan ini selalu mendarat di
              keputusan yang sama — bukan di hasil pencarian yang mirip. Penalarannya sendiri
              memang tidak dibawa halaman ini; ini jalan ke sana. */}
          {selection?.source === 'riwayat' && (
            <Link
              href={`/bot-control/decisions?run=${selection.runId}`}
              className="focus-ring block rounded-sm border-t border-line pt-2 text-sm text-accent hover:underline"
            >
              Buka penalaran run ini di Decision Logs &rarr;
            </Link>
          )}
        </Card>

        <Card className="space-y-2 p-4">
          {funnelError && <p className="text-base text-danger">{funnelError}</p>}
          {funnel ? (
            <PipelineFunnelBar stages={funnel.stages} total={funnel.total} windowSize={funnel.windowSize} />
          ) : (
            !funnelError && <SkeletonText lines={6} />
          )}
        </Card>
      </div>
    </main>
  )
}
