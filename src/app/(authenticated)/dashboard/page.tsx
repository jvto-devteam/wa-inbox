'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { RangeSwitch } from '@/components/dashboard/Panel'
import { RemindersPanel } from '@/components/dashboard/RemindersPanel'
import { FunnelPanel, OutboundPanel } from '@/components/dashboard/OpsPanels'
import { BotHealthPanel, DecisionTopicPanel } from '@/components/dashboard/ActivityPanels'
import type { ChannelStatus, DueReminder } from '@/components/dashboard/data'
import type { DashboardActivity } from '@/app/api/dashboard/activity/route'
import type { DashboardOperations } from '@/app/api/dashboard/operations/route'
import { fetchJson, FetchJsonError } from '@/lib/fetch-json'

/**
 * BERANDA — keadaan bisnis dan mesinnya, sekali lihat.
 *
 * Sejak audit 2026-10-31 hanya berisi hal yang tidak dijawab layar lain: chat yang perlu dibalas
 * ada di /summary (antrean bertindakan, tertua dulu), jadi panel bacaan Antrean chat, Volume,
 * Pertanyaan tak terjawab, dan Ringkasan inbox dilepas.
 *
 * Yang sengaja tetap:
 *   - Funnel: permintaan pemilik, "di mana pelanggan menumpuk" tidak dijawab layar mana pun.
 *   - Reminder jatuh tempo: satu-satunya tempat reminder manual muncul.
 *   - Keputusan per cluster topik/job (R53): tanpa panel ini kolomnya ditulis dan tak terbaca.
 *
 * URUTAN PANEL:
 *   0. Peringatan saluran — HANYA kalau rusak. Kalau pesan tidak bisa keluar, semua di bawahnya
 *      tidak bisa dikerjakan.
 *   1. Funnel, kesehatan bot, antrean outbound. Keadaan bisnis dan mesinnya.
 *   2. Reminder + keputusan bot per cluster.
 *
 * SUMBER DATA BERDIRI SENDIRI. Setiap panel gagal sendirian dan mengaku sendiri; satu endpoint
 * yang 500 tidak boleh mengosongkan panel yang datanya baik-baik saja. Pengecualiannya adalah
 * 401: fetchJson sudah melempar browser ke /login, dan menulis "gagal" di layar yang sedang
 * ditinggalkan hanya menakuti orang tanpa memberi tahu apa pun.
 */

/**
 * Sengaja disalin dari ALLOWED_DAYS di /api/dashboard/activity dan bukan diimpor: mengimpor
 * sebuah NILAI dari file route akan menarik seluruh modul route (dan Prisma di belakangnya) ke
 * dalam bundel klien. Route tetap yang menegakkannya — nilai di luar daftarnya dijawab 400 —
 * jadi salinan ini hanya menentukan tombol yang ditawarkan, bukan apa yang boleh diminta.
 */
const RANGE_OPTIONS = [7, 14, 30] as const

/** Rentang default. Seminggu adalah jendela yang benar-benar dipakai tim ini untuk memutuskan. */
const DEFAULT_RANGE = 7

type Loadable<T> = {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
}

/**
 * Satu endpoint, satu keadaan.
 *
 * `loading` DITURUNKAN dari kunci yang terakhir benar-benar selesai dimuat, bukan diset di awal
 * effect: menyetel state serentak di dalam effect memicu render berantai (aturan yang sama yang
 * dipatuhi halaman Histori Biaya dan Pertanyaan Tak Terjawab). Karena kuncinya memuat URL,
 * mengganti rentang otomatis mengembalikan panel ke kerangka pemuatannya tanpa satu baris pun
 * kode tambahan.
 */
function useEndpoint<T>(url: string): Loadable<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)

  const key = `${attempt}:${url}`

  useEffect(() => {
    let cancelled = false
    fetchJson<T>(url)
      .then((next) => {
        if (cancelled) return
        setData(next ?? null)
        setError(null)
        setLoadedKey(key)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // Sesi habis: biarkan panel tetap di kerangka pemuatan sementara browser berpindah.
        if (err instanceof FetchJsonError && err.status === 401) return
        setData(null)
        setError(err instanceof Error ? err.message : 'Permintaan gagal')
        setLoadedKey(key)
      })
    return () => {
      cancelled = true
    }
  }, [url, key])

  return { data, error, loading: loadedKey !== key, reload: () => setAttempt((a) => a + 1) }
}

export default function DashboardPage() {
  const [range, setRange] = useState<number>(DEFAULT_RANGE)

  const channels = useEndpoint<ChannelStatus>('/api/numbers/status')
  const reminders = useEndpoint<DueReminder[]>('/api/reminders/due')
  const operations = useEndpoint<DashboardOperations>('/api/dashboard/operations')
  const activity = useEndpoint<DashboardActivity>(`/api/dashboard/activity?days=${range}`)

  // Ditandai sekali lalu berdetak tiap menit: layar yang dibiarkan terbuka sepanjang pagi tidak
  // boleh terus mengaku reminder "terlambat 1 jam" sampai sore.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(tick)
  }, [])

  const onRangeChange = useCallback((next: number) => setRange(next), [])

  const status = channels.data
  const channelsHealthy = status ? status.officialTokenValid && status.unofficialConfigured : true
  const brokenChannelTitle =
    status && !status.officialTokenValid && !status.unofficialConfigured
      ? 'Kedua saluran WhatsApp tidak siap mengirim'
      : status && !status.officialTokenValid
        ? 'Saluran resmi tidak bisa mengirim pesan'
        : 'Saluran tidak resmi belum diatur'

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-4 p-4 sm:p-6">
      <PageHeader
        title="Beranda"
        description={now.toLocaleDateString('id-ID', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
        actions={
          <RangeSwitch value={range} options={RANGE_OPTIONS} onChange={onRangeChange} />
        }
      />

      {channels.loading ? (
        <DashboardBodySkeleton />
      ) : (
        <>
          {/* Satu-satunya hal di halaman ini yang boleh berteriak, dan ia hanya ada saat memang
              rusak. Kalau pesan tidak bisa keluar, seluruh pekerjaan di bawahnya tidak bisa
              diselesaikan — jadi ia mendahului, bukan jadi lencana di pojok. */}
          {status && !channelsHealthy && (
            <Link
              href="/settings"
              className="focus-ring flex items-start gap-2.5 rounded-lg border border-danger/35 bg-danger-subtle px-4 py-3"
            >
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" strokeWidth={1.75} />
              <div className="min-w-0">
                <p className="text-base font-medium text-danger">{brokenChannelTitle}</p>
                <p className="text-sm text-ink-muted">
                  Balasan bisa gagal terkirim tanpa pemberitahuan. Buka Pengaturan untuk memperbaiki kredensialnya.
                </p>
              </div>
              <ArrowRight aria-hidden="true" className="mt-0.5 ml-auto size-4 shrink-0 text-danger" strokeWidth={1.75} />
            </Link>
          )}

          <Link
            href="/summary"
            className="focus-ring flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-surface-sunken"
          >
            Chat yang perlu dibalas ada di Summary Harian
            <ArrowRight aria-hidden="true" className="size-3.5 text-ink-muted" strokeWidth={1.75} />
          </Link>

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <FunnelPanel
              funnel={operations.data?.funnel ?? []}
              total={operations.data?.conversationTotal ?? 0}
              error={operations.error}
              loading={operations.loading}
              onRetry={operations.reload}
            />
            <BotHealthPanel
              decisions={activity.data?.decisions ?? null}
              rangeDays={range}
              error={activity.error}
              loading={activity.loading}
              onRetry={activity.reload}
            />
            <OutboundPanel
              outbound={operations.data?.outbound ?? null}
              error={operations.error}
              loading={operations.loading}
              onRetry={operations.reload}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <RemindersPanel
              reminders={reminders.data ?? []}
              now={now}
              error={reminders.error}
              loading={reminders.loading}
              onRetry={reminders.reload}
            />
            <DecisionTopicPanel
              className="xl:col-span-2"
              byTopic={activity.data?.byTopic ?? null}
              byJob={activity.data?.byJob ?? null}
              rangeDays={range}
              error={activity.error}
              loading={activity.loading}
              onRetry={activity.reload}
            />
          </div>
        </>
      )}
    </main>
  )
}

/**
 * Kerangka pemuatan: bentuk halaman jadinya, bukan pemintal.
 *
 * Baris grid yang sama persis dengan yang akan menggantikannya, sehingga isi yang datang
 * tidak menggeser apa pun. Ia sengaja HANYA mengganti badan halaman — kepala (judul, tanggal,
 * pemilih rentang) tetap terpasang sepanjang pemuatan, karena menukar seluruh <main> membuat
 * React membongkar dan memasang ulang seluruh pohon, dan judul yang berkedip di setiap muat
 * adalah harga yang tidak perlu dibayar.
 */
function DashboardBodySkeleton() {
  return (
    <div role="status" aria-label="Memuat beranda" className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <SkeletonPanel rows={5} />
        <SkeletonPanel rows={5} />
        <SkeletonPanel rows={5} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <SkeletonPanel rows={3} />
        <SkeletonPanel rows={5} className="xl:col-span-2" />
      </div>
    </div>
  )
}

function SkeletonPanel({ rows, className }: { rows: number; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-lg border border-line bg-surface ${className ?? ''}`}>
      <div className="border-b border-line px-4 py-3">
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="space-y-2 p-4">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className={`h-3.5 ${i % 3 === 2 ? 'w-2/5' : i % 3 === 1 ? 'w-3/5' : 'w-4/5'}`} />
        ))}
      </div>
    </div>
  )
}
