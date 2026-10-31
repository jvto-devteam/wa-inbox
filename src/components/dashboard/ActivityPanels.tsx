'use client'
import { Panel, PanelError, PanelLoading, Stat } from './Panel'
import { HBar, LegendSwatch, SegmentBar, type ChartTone } from './charts'
import { formatLatency, formatNumber } from './data'

/** Label Indonesia untuk `BotDecisionRun.status` (pemetaan aslinya di decision-recorder.ts). */
const DECISION_LABEL: Record<string, string> = {
  REPLIED: 'Dijawab',
  CLARIFIED: 'Klarifikasi',
  HANDOFF: 'Diserahkan',
  FAILED: 'Gagal',
  SKIPPED: 'Dilewati',
}

/**
 * Urutan dan warna sebaran keputusan. Bukan palet: tiga nada netral untuk hasil yang normal, dan
 * warna semantik HANYA untuk dua hasil yang berarti bot tidak menyelesaikan tugasnya.
 */
const DECISION_TONES: { key: string; tone: ChartTone }[] = [
  { key: 'REPLIED', tone: 'ink' },
  { key: 'CLARIFIED', tone: 'muted' },
  { key: 'HANDOFF', tone: 'warning' },
  { key: 'FAILED', tone: 'danger' },
  { key: 'SKIPPED', tone: 'line' },
]

/**
 * KESEHATAN BOT — apakah bot masih menyelesaikan percakapan sendiri.
 *
 * Yang dicari bukan "berapa banyak keputusan" melainkan PROPORSI yang berakhir diserahkan atau
 * gagal: bot yang menjawab dua ribu kali dan menyerah seribu kali sedang membebani agen, bukan
 * membantunya, dan dua angka yang berjajar menyembunyikan itu sampai seseorang membaginya sendiri.
 */
export function BotHealthPanel({
  decisions,
  rangeDays,
  error,
  loading,
  onRetry,
  className,
}: {
  decisions: {
    total: number
    byStatus: Record<string, number>
    flagged: number
    avgLatencyMs: number | null
    maxLatencyMs: number | null
  } | null
  rangeDays: number
  error: string | null
  loading: boolean
  onRetry?: () => void
  className?: string
}) {
  const segments = DECISION_TONES.map((t) => ({
    key: t.key,
    tone: t.tone,
    value: decisions?.byStatus[t.key] ?? 0,
  })).filter((s) => s.value > 0)

  // Status yang tidak dikenal (baru ditambahkan di decision-recorder, belum di sini) tetap
  // dihitung dalam total dan disebut apa adanya, bukan dijatuhkan diam-diam.
  const extras = Object.entries(decisions?.byStatus ?? {}).filter(
    ([key]) => !DECISION_TONES.some((t) => t.key === key)
  )

  const handoffShare =
    decisions && decisions.total > 0
      ? Math.round(((decisions.byStatus.HANDOFF ?? 0) / decisions.total) * 100)
      : 0

  return (
    <Panel
      title="Kesehatan bot"
      subtitle={loading || error ? undefined : `${rangeDays} hari terakhir`}
      href="/bot-control/decisions"
      hrefLabel="Keputusan"
      className={className}
    >
      {loading ? (
        <PanelLoading rows={4} />
      ) : error || !decisions ? (
        <PanelError message={error ?? 'Keputusan bot tidak terbaca'} onRetry={onRetry} />
      ) : decisions.total === 0 ? (
        <p className="text-sm text-ink-muted">
          Bot tidak mengambil satu keputusan pun dalam {rangeDays} hari terakhir.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Stat value={formatNumber(decisions.total)} label="Keputusan" />
            <Stat
              value={`${handoffShare}%`}
              label="Diserahkan"
              tone={handoffShare >= 50 ? 'warning' : 'ink'}
            />
            <Stat value={formatLatency(decisions.avgLatencyMs)} label="Latensi rata-rata" />
          </div>

          <SegmentBar segments={segments} />

          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {segments.map((s) => (
              <li key={s.key}>
                <LegendSwatch
                  tone={s.tone}
                  label={`${DECISION_LABEL[s.key] ?? s.key} ${formatNumber(s.value)}`}
                />
              </li>
            ))}
            {extras.map(([key, value]) => (
              <li key={key} className="text-xs text-ink-muted">
                {key} {formatNumber(value)}
              </li>
            ))}
          </ul>

          <p className="text-xs text-ink-muted">
            Terlama {formatLatency(decisions.maxLatencyMs)}
            {decisions.flagged > 0 && ` · ${formatNumber(decisions.flagged)} keputusan ditandai untuk diperbaiki`}
          </p>
        </div>
      )}
    </Panel>
  )
}

/** Satu baris cluster: nama, total, batang, dan pemecahan tiga hasil (R53). */
type ClusterRow = { total: number; replied: number; clarified: number; handoff: number }

function ClusterRows<T extends ClusterRow>({
  rows,
  name,
}: {
  rows: T[]
  name: (row: T) => string
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.total), 0)
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={name(r)}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm text-ink">{name(r)}</span>
            <span className="shrink-0 font-mono text-sm text-ink tabular-nums">{formatNumber(r.total)}</span>
          </div>
          <div className="mt-1">
            <HBar value={r.total} max={max} tone="ink" />
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            Dijawab <span className="font-mono text-ink tabular-nums">{formatNumber(r.replied)}</span>
            {' · '}Klarifikasi <span className="font-mono text-ink tabular-nums">{formatNumber(r.clarified)}</span>
            {' · '}Diserahkan <span className="font-mono text-ink tabular-nums">{formatNumber(r.handoff)}</span>
          </p>
        </li>
      ))}
    </ul>
  )
}

/**
 * KEPUTUSAN BOT PER CLUSTER — dua sumbu klasifikasi giliran (`topic`, `job`, lihat komentar
 * kolomnya di schema) sebagai laporan yang benar-benar bisa dilihat (Ruling R53).
 *
 * Tanpa panel ini, `topic` dan `job` adalah kolom yang ditulis tiap giliran dan tidak pernah
 * dibaca siapa pun — persis kesalahan yang dicatat R53. Dua bagian, bukan digabung jadi satu
 * daftar: `topic` adalah SUBJEK percakapan (harga, jadwal) dan `job` adalah TUGAS yang sedang
 * dikerjakan bot untuknya (booking, refund) — sumbu yang berbeda, jadi baris yang sama tidak
 * bisa digabung tanpa kehilangan salah satunya.
 */
export function DecisionTopicPanel({
  byTopic,
  byJob,
  rangeDays,
  error,
  loading,
  onRetry,
  className,
}: {
  byTopic: (ClusterRow & { topic: string })[] | null
  byJob: (ClusterRow & { job: string })[] | null
  rangeDays: number
  error: string | null
  loading: boolean
  onRetry?: () => void
  className?: string
}) {
  const hasData = byTopic !== null && byJob !== null
  const empty = hasData && byTopic.length === 0 && byJob.length === 0

  return (
    <Panel
      title="Keputusan bot per cluster"
      subtitle={loading || error || !hasData ? undefined : `${rangeDays} hari terakhir`}
      href="/bot-control/decisions"
      hrefLabel="Semua keputusan"
      className={className}
    >
      {loading ? (
        <PanelLoading rows={4} />
      ) : error || !hasData ? (
        <PanelError message={error ?? 'Cluster keputusan tidak terbaca'} onRetry={onRetry} />
      ) : empty ? (
        <p className="text-sm text-ink-muted">
          Tidak ada keputusan bertopik atau berjob dalam {rangeDays} hari terakhir.
        </p>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium text-ink-muted">Topik percakapan</p>
            {byTopic.length === 0 ? (
              <p className="text-sm text-ink-muted">Tidak ada topik tercatat.</p>
            ) : (
              <ClusterRows rows={byTopic} name={(r) => r.topic} />
            )}
          </div>
          <div className="border-t border-line pt-3">
            <p className="mb-2 text-xs font-medium text-ink-muted">Tugas bot (job)</p>
            {byJob.length === 0 ? (
              <p className="text-sm text-ink-muted">Tidak ada job tercatat.</p>
            ) : (
              <ClusterRows rows={byJob} name={(r) => r.job} />
            )}
          </div>
        </div>
      )}
    </Panel>
  )
}
