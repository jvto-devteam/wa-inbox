'use client'
import Link from 'next/link'
import { CheckCircle2, PauseCircle, TriangleAlert } from 'lucide-react'
import { Panel, PanelError, PanelLoading } from './Panel'
import { HBar } from './charts'
import { formatNumber, type Summary } from './data'
import { cn } from '@/lib/utils'

type Funnel = { stage: string; label: string; count: number }[]

type Outbound = {
  inFlight: Record<string, number>
  inFlightTotal: number
  failedRecent: number
  stuck: number
  pausedProviders: string[]
}

/**
 * FUNNEL PENJUALAN — di tahap mana pelanggan menumpuk.
 *
 * Angka telanjang tidak bisa menjawab itu: "48 nego" hanya berarti sesuatu di sebelah "112 baru"
 * dan "9 booked". Yang dicari mata di sini adalah BENTUKNYA — di mana corongnya menyempit
 * mendadak — dan bentuk adalah satu-satunya hal yang memang butuh gambar.
 *
 * POTRET, BUKAN TREN, dan panel ini mengatakannya. `Conversation.pipelineStage` hanya menyimpan
 * tahap yang berlaku sekarang; tidak ada satu pun kolom di skema yang mencatat kapan sebuah
 * percakapan berpindah tahap, jadi "berapa yang masuk tahap booked minggu ini" tidak punya
 * jawaban dan tidak ditampilkan. Karena itu pemilih rentang di kepala halaman sengaja tidak
 * menyentuh panel ini.
 */
export function FunnelPanel({
  funnel,
  total,
  error,
  loading,
  onRetry,
  className,
}: {
  funnel: Funnel
  total: number
  error: string | null
  loading: boolean
  onRetry?: () => void
  className?: string
}) {
  const max = funnel.reduce((m, f) => Math.max(m, f.count), 0)

  return (
    <Panel
      title="Funnel penjualan"
      subtitle={loading || error ? undefined : `${formatNumber(total)} percakapan, keadaan sekarang`}
      href="/contacts"
      hrefLabel="Kontak"
      className={className}
    >
      {loading ? (
        <PanelLoading rows={5} />
      ) : error ? (
        <PanelError message={error} onRetry={onRetry} />
      ) : total === 0 ? (
        <p className="text-sm text-ink-muted">Belum ada percakapan yang punya tahap pipeline.</p>
      ) : (
        <ul className="space-y-2.5">
          {funnel.map((f) => (
            <li key={f.stage}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm text-ink">{f.label}</span>
                <span className="shrink-0 font-mono text-sm text-ink tabular-nums">
                  {formatNumber(f.count)}
                  <span className="ml-1.5 text-xs text-ink-subtle">
                    {Math.round((f.count / total) * 100)}%
                  </span>
                </span>
              </div>
              <div className="mt-1">
                <HBar value={f.count} max={max} tone="ink" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/**
 * ANTREAN OUTBOUND — apakah pesan benar-benar keluar.
 *
 * Panel yang paling sering harus DIAM. Antrean yang bersih adalah keadaan normal, dan sebuah
 * kartu yang setiap hari berteriak "0 gagal!" mengajari orang untuk berhenti membacanya — persis
 * pada hari angkanya bukan nol lagi. Jadi: bersih = satu baris hijau tenang; ada yang tertahan,
 * macet, atau provider dijeda = barulah warna semantik muncul.
 *
 * Provider yang dijeda muncul paling atas dan paling keras karena ia satu-satunya keadaan di
 * sini yang TIDAK akan pulih sendiri: retry ladder mengurus sisanya, tapi jeda darurat hanya
 * terangkat kalau ada orang yang mengangkatnya.
 */
export function OutboundPanel({
  outbound,
  error,
  loading,
  onRetry,
  className,
}: {
  outbound: Outbound | null
  error: string | null
  loading: boolean
  onRetry?: () => void
  className?: string
}) {
  const clean =
    outbound !== null &&
    outbound.inFlightTotal === 0 &&
    outbound.failedRecent === 0 &&
    outbound.stuck === 0 &&
    outbound.pausedProviders.length === 0

  return (
    <Panel
      title="Antrean outbound"
      subtitle={loading || error || !outbound ? undefined : 'Keadaan sekarang'}
      href="/bot-control/outbound-queue"
      hrefLabel="Antrean"
      className={className}
    >
      {loading ? (
        <PanelLoading rows={2} />
      ) : error || !outbound ? (
        <PanelError message={error ?? 'Antrean tidak terbaca'} onRetry={onRetry} />
      ) : clean ? (
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-success" strokeWidth={1.75} />
          Antrean bersih — tidak ada pengiriman yang tertahan.
        </p>
      ) : (
        <div className="space-y-3">
          {outbound.pausedProviders.length > 0 && (
            <p className="flex items-start gap-2 rounded-md bg-danger-subtle px-2.5 py-2 text-sm text-danger">
              <PauseCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
              <span>
                <span className="font-medium">Provider dijeda: {outbound.pausedProviders.join(', ')}.</span>{' '}
                Tidak ada pesan yang keluar lewat jalur itu sampai jeda dicabut.
              </span>
            </p>
          )}

          <dl className="grid grid-cols-3 gap-3">
            <OutboundStat
              value={outbound.inFlightTotal}
              label="Sedang jalan"
              tone={outbound.inFlightTotal > 0 ? 'ink' : 'muted'}
            />
            <OutboundStat
              value={outbound.failedRecent}
              label="Gagal 24 jam"
              tone={outbound.failedRecent > 0 ? 'danger' : 'muted'}
            />
            <OutboundStat
              value={outbound.stuck}
              label="Menggantung"
              tone={outbound.stuck > 0 ? 'warning' : 'muted'}
            />
          </dl>

          {outbound.stuck > 0 && (
            <p className="flex items-start gap-2 text-xs text-ink-muted">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-warning" strokeWidth={1.75} />
              Job yang berhenti di tengah pengiriman lebih dari lima menit. Halaman Antrean punya
              tombol pemulihannya.
            </p>
          )}
        </div>
      )}
    </Panel>
  )
}

function OutboundStat({
  value,
  label,
  tone,
}: {
  value: number
  label: string
  tone: 'ink' | 'muted' | 'warning' | 'danger'
}) {
  const toneClass = { ink: 'text-ink', muted: 'text-ink-subtle', warning: 'text-warning', danger: 'text-danger' }[tone]
  return (
    <div className="min-w-0">
      <dt className="sr-only">{label}</dt>
      <dd>
        <span className={cn('block font-mono text-lg leading-none font-semibold tabular-nums', toneClass)}>
          {formatNumber(value)}
        </span>
        <span className="mt-1 block truncate text-xs text-ink-muted">{label}</span>
      </dd>
    </div>
  )
}

/**
 * RINGKASAN INBOX + SALURAN — konteks yang tidak menuntut tindakan, tapi punya tujuan kalau diklik.
 *
 * Tiga angka ini dulu memenuhi bagian atas Beranda sebagai kartu besar yang tidak satu pun bisa
 * diklik. Ukurannya turun, tujuannya naik.
 *
 * Baris saluran ikut di sini karena rail kiri menyembunyikan titik statusnya di bawah md (tooltip
 * tanpa hover), sehingga di ponsel BARIS INI satu-satunya tempat status kedua saluran terbaca —
 * dan karena itu ia menyebut keduanya dengan kata, bukan cuma sebuah titik.
 */
export function ContextPanel({
  summary,
  botHeld,
  error,
  loading,
  onRetry,
  className,
}: {
  summary: Summary | null
  botHeld: number
  error: string | null
  loading: boolean
  onRetry?: () => void
  className?: string
}) {
  return (
    <Panel title="Ringkasan inbox" className={className} bodyClassName={loading || error ? 'p-4' : ''}>
      {loading ? (
        <PanelLoading rows={3} />
      ) : error || !summary ? (
        <PanelError message={error ?? 'Ringkasan tidak terbaca'} onRetry={onRetry} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-px bg-line">
            <ContextCell href="/inbox" value={summary.openCount} label="Percakapan terbuka" />
            <ContextCell href="/inbox" value={botHeld} label="Dipegang bot" />
            <ContextCell
              href="/bot-control/decisions"
              value={summary.handoffTodayCount}
              label="Diserahkan bot hari ini"
            />
          </div>
          <Link
            href="/settings"
            className="focus-ring flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-sm transition-colors hover:bg-surface-sunken"
          >
            <span className="font-medium text-ink">Saluran WhatsApp</span>
            <span className="flex items-center gap-1.5 text-ink-muted">
              <StatusDot ok={summary.officialTokenValid} />
              Resmi — {summary.officialTokenValid ? 'token valid' : 'token tidak valid'}
            </span>
            <span className="flex items-center gap-1.5 text-ink-muted">
              <StatusDot ok={summary.unofficialConfigured} />
              Tidak resmi — {summary.unofficialConfigured ? 'terkonfigurasi' : 'belum diatur'}
            </span>
          </Link>
        </>
      )}
    </Panel>
  )
}

function ContextCell({ href, value, label }: { href: string; value: number; label: string }) {
  return (
    <Link
      href={href}
      className="focus-ring bg-surface px-4 py-2.5 transition-colors hover:bg-surface-sunken"
    >
      <p className="font-mono text-base font-medium text-ink tabular-nums">{formatNumber(value)}</p>
      <p className="mt-0.5 text-xs text-ink-muted">{label}</p>
    </Link>
  )
}

function StatusDot({ ok }: { ok: boolean }) {
  return <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', ok ? 'bg-success' : 'bg-danger')} />
}
