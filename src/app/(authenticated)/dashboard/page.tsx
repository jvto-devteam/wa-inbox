'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { RangeSwitch } from '@/components/dashboard/Panel'
import { WaitingQueuePanel, RemindersPanel } from '@/components/dashboard/WaitingPanels'
import { ContextPanel, FunnelPanel, OutboundPanel } from '@/components/dashboard/OpsPanels'
import { BotHealthPanel, DecisionTopicPanel, KnowledgeGapsPanel, VolumePanel } from '@/components/dashboard/ActivityPanels'
import {
  buildWaitingList,
  countBotHeld,
  type ConversationRow,
  type DueReminder,
  type Summary,
} from '@/components/dashboard/data'
import type { DashboardActivity } from '@/app/api/dashboard/activity/route'
import type { DashboardOperations } from '@/app/api/dashboard/operations/route'
import { fetchJson, FetchJsonError } from '@/lib/fetch-json'

/**
 * BERANDA — jendela ke seluruh aplikasi, bukan ke satu daftar.
 *
 * Bentuk sebelumnya menjawab satu pertanyaan dengan sangat baik ("siapa yang paling lama
 * menunggu dibalas") dan tidak menjawab apa pun selain itu, di dalam kolom selebar 768px di
 * layar 2880px. Pemiliknya membacanya persis seperti itu: isinya sedikit, datar, dan kanan
 * kirinya kosong.
 *
 * Yang berubah, dan alasannya:
 *
 *  1. LEBAR. `max-w-3xl` diganti `max-w-[1600px]`. Batasnya tetap ada — di layar ultrawide
 *     baris teks selebar dua meter tidak bisa dibaca siapa pun — tapi sekarang ia memuat tiga
 *     kolom panel, bukan satu kolom yang ditarik melar.
 *
 *  2. CAKUPAN. Sembilan panel, satu per wilayah aplikasi yang benar-benar punya datanya:
 *     antrean chat (Inbox), reminder (CRM), funnel penjualan (pipeline), antrean outbound,
 *     volume pesan, kesehatan bot, pertanyaan tak terjawab (knowledge), keputusan bot per
 *     cluster topik/job (R53), dan ringkasan inbox + saluran. Tidak ada satu pun angka di
 *     halaman ini yang tidak berasal dari tabel nyata.
 *
 *  3. INTERAKSI YANG BERARTI. Dua saja, dan keduanya mengubah jawaban: pemilih rentang
 *     (7/14/30 hari) yang benar-benar menarik ulang angkanya dari database, dan sorotan kolom
 *     di grafik volume yang membuka angka satu hari tertentu. Tidak ada animasi yang tidak
 *     menjawab pertanyaan.
 *
 * URUTAN PANEL, bukan urutan menu:
 *   0. Peringatan saluran — HANYA kalau rusak. Kalau pesan tidak bisa keluar, semua di bawahnya
 *      tidak bisa dikerjakan.
 *   1. Funnel, volume, kesehatan bot. Keadaan bisnis dan mesinnya.
 *   2. Antrean chat menunggu (dua kolom) + reminder + antrean outbound. Pekerjaan hari ini.
 *   3. Pertanyaan tak terjawab + ringkasan inbox. Pekerjaan minggu depan.
 *   4. Keputusan bot per cluster topik/job (R53). Sama waktunya dengan baris 1 (activity), tapi
 *      diturunkan ke bawah karena isinya diagnostik -- berguna saat menyelidiki, bukan setiap
 *      kali membuka Beranda.
 *
 * Baris 1 dan 2 SENGAJA dibalik dari urutan mendesaknya, atas permintaan pemilik. Alasannya
 * masuk akal untuk peran yang membuka layar ini: "siapa yang menunggu" sudah dijawab sidebar
 * Inbox sepanjang hari, sedangkan "di mana pelanggan menumpuk" tidak dijawab layar mana pun
 * selain di sini. Antrean tetap di paruh atas, jadi tidak ada yang tenggelam.
 *
 * EMPAT SUMBER DATA YANG BERDIRI SENDIRI. Setiap panel gagal sendirian dan mengaku sendiri;
 * satu endpoint yang 500 tidak boleh mengosongkan delapan panel yang datanya baik-baik saja.
 * Pengecualiannya adalah 401: fetchJson sudah melempar browser ke /login, dan menulis "gagal"
 * di layar yang sedang ditinggalkan hanya menakuti orang tanpa memberi tahu apa pun.
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

type InboxState = {
  summary: Summary | null
  conversations: ConversationRow[] | null
  error: string | null
  loading: boolean
}

/**
 * Ringkasan + daftar percakapan, sengaja SATU keadaan.
 *
 * Antrean chat butuh keduanya sekaligus dan tidak bisa separuh: /api/dashboard/summary adalah
 * satu-satunya yang tahu percakapan mana yang sudah diserahkan bot dan belum dipegang siapa pun
 * (`assignedAgentId` tidak ada di /api/conversations), sementara /api/conversations adalah
 * satu-satunya yang membawa `lastMessageAt` — tanpa itu antrean ini tidak bisa diurutkan menurut
 * lama tunggu sama sekali, dan itulah seluruh alasan panel ini ada.
 */
function useInbox(): InboxState & { reload: () => void } {
  const [state, setState] = useState<InboxState>({
    summary: null,
    conversations: null,
    error: null,
    loading: true,
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchJson<Summary>('/api/dashboard/summary'),
      fetchJson<ConversationRow[]>('/api/conversations'),
    ])
      .then(([summary, conversations]) => {
        if (!cancelled) setState({ summary, conversations, error: null, loading: false })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof FetchJsonError && err.status === 401) return
        setState({
          summary: null,
          conversations: null,
          error: err instanceof Error ? err.message : 'Permintaan gagal',
          loading: false,
        })
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  return { ...state, reload: () => setAttempt((a) => a + 1) }
}

export default function DashboardPage() {
  const [range, setRange] = useState<number>(DEFAULT_RANGE)

  const inbox = useInbox()
  const reminders = useEndpoint<DueReminder[]>('/api/reminders/due')
  const operations = useEndpoint<DashboardOperations>('/api/dashboard/operations')
  const activity = useEndpoint<DashboardActivity>(`/api/dashboard/activity?days=${range}`)

  // Ditandai sekali saat data masuk lalu berdetak tiap menit: isi utama panel teratas adalah
  // "sudah menunggu berapa lama", dan layar yang dibiarkan terbuka sepanjang pagi tidak boleh
  // terus mengaku "4 jam" sampai sore. Dibaca hanya di cabang yang sudah punya data, jadi tidak
  // pernah ikut render server dan tidak bisa memicu ketidakcocokan hidrasi.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(tick)
  }, [])

  const waiting = useMemo(
    () =>
      inbox.summary && inbox.conversations
        ? buildWaitingList(inbox.summary, inbox.conversations)
        : [],
    [inbox.summary, inbox.conversations]
  )
  const botHeld = useMemo(
    () => (inbox.conversations ? countBotHeld(inbox.conversations) : 0),
    [inbox.conversations]
  )

  const onRangeChange = useCallback((next: number) => setRange(next), [])

  const summary = inbox.summary
  const channelsHealthy = summary ? summary.officialTokenValid && summary.unofficialConfigured : true
  const brokenChannelTitle =
    summary && !summary.officialTokenValid && !summary.unofficialConfigured
      ? 'Kedua saluran WhatsApp tidak siap mengirim'
      : summary && !summary.officialTokenValid
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

      {inbox.loading ? (
        <DashboardBodySkeleton />
      ) : (
        <>
          {/* Satu-satunya hal di halaman ini yang boleh berteriak, dan ia hanya ada saat memang
              rusak. Kalau pesan tidak bisa keluar, seluruh pekerjaan di bawahnya tidak bisa
              diselesaikan — jadi ia mendahului, bukan jadi lencana di pojok. */}
          {summary && !channelsHealthy && (
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

          {/* BARIS 1 — keadaan bisnis dan mesinnya. Dinaikkan ke atas atas permintaan pemilik:
              pertanyaan pertama yang ia bawa ke layar ini adalah "di mana pelanggan menumpuk",
              bukan "siapa yang menunggu" — yang sudah dijawab sidebar Inbox sepanjang hari. */}
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <FunnelPanel
              funnel={operations.data?.funnel ?? []}
              total={operations.data?.conversationTotal ?? 0}
              error={operations.error}
              loading={operations.loading}
              onRetry={operations.reload}
            />
            <VolumePanel
              days={activity.data?.volume ?? []}
              rangeDays={range}
              error={activity.error}
              loading={activity.loading}
              onRetry={activity.reload}
            />
            <BotHealthPanel
              decisions={activity.data?.decisions ?? null}
              rangeDays={range}
              error={activity.error}
              loading={activity.loading}
              onRetry={activity.reload}
            />
          </div>

          {/* BARIS 2 — pekerjaan hari ini. Antrean mendapat dua pertiga lebar karena ia satu-satunya
              panel yang isinya orang, bukan angka. */}
          <div className="grid gap-4 xl:grid-cols-3">
            <WaitingQueuePanel
              className="xl:col-span-2"
              rows={waiting}
              botHeld={botHeld}
              now={now}
              error={inbox.error}
              loading={inbox.loading}
              onRetry={inbox.reload}
            />
            <div className="flex flex-col gap-4">
              <RemindersPanel
                reminders={reminders.data ?? []}
                now={now}
                error={reminders.error}
                loading={reminders.loading}
                onRetry={reminders.reload}
              />
              <OutboundPanel
                outbound={operations.data?.outbound ?? null}
                error={operations.error}
                loading={operations.loading}
                onRetry={operations.reload}
              />
            </div>
          </div>

          {/* BARIS 3 — pekerjaan minggu depan, dan konteks yang tenang. */}
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <KnowledgeGapsPanel
              className="xl:col-span-2"
              gaps={activity.data?.gaps ?? null}
              rangeDays={range}
              error={activity.error}
              loading={activity.loading}
              onRetry={activity.reload}
            />
            <ContextPanel
              summary={summary}
              botHeld={botHeld}
              error={inbox.error}
              loading={inbox.loading}
              onRetry={inbox.reload}
            />
          </div>

          {/* BARIS 4 — dua sumbu klasifikasi giliran bot (`topic`, `job`), yang tanpa panel ini
              hanyalah kolom yang ditulis dan tidak pernah dibaca siapa pun (Ruling R53). */}
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
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
 * Empat baris grid yang sama persis dengan yang akan menggantikannya, sehingga isi yang datang
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
      <div className="grid gap-4 xl:grid-cols-3">
        <SkeletonPanel rows={6} className="xl:col-span-2" />
        <div className="flex flex-col gap-4">
          <SkeletonPanel rows={3} />
          <SkeletonPanel rows={2} />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <SkeletonPanel rows={4} className="xl:col-span-2" />
        <SkeletonPanel rows={3} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
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
