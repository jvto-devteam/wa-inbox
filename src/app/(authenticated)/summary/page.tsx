'use client'
import Link from 'next/link'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { SummaryDayView } from '@/components/daily-summary/SummaryDayView'
import { SummaryQueue } from '@/components/daily-summary/SummaryQueue'
import type { DailySummaryResponse } from '@/app/api/daily-summary/route'
import type { SummaryItemsResponse } from '@/app/api/summary-items/route'
import type { AccountRoleName } from '@/lib/auth/session'
import { hasAdminPowers } from '@/lib/bot-control/permissions'
import { isDateKey } from '@/lib/daily-summary/time'
import { fetchJson } from '@/lib/fetch-json'
import { announceSummaryItemsChanged } from '@/lib/summary-items/events'
import type { BookingQueueItem } from '@/lib/booking-actions/view'

type Session = { role: AccountRoleName }

const STATUS_LABEL: Record<string, string> = {
  DONE: 'Selesai',
  PARTIAL: 'Sebagian',
  RUNNING: 'Sedang dibuat',
  FAILED: 'Gagal',
}

function dateLabel(date: string): string {
  return new Date(`${date}T00:00:00+07:00`).toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function summaryUrl(date: string | null): string {
  // Tanpa `date` = ringkasan terbaru.
  return date ? `/api/daily-summary?date=${encodeURIComponent(date)}` : '/api/daily-summary'
}

/**
 * Summary Harian sebagai antrean tindakan. Ringkasan dibuat job tiap 00:00 WIB
 * (POST /api/daily-summary/generate) dan disinkronkan jadi SummaryItem; tampilan default membaca
 * antrean itu (GET /api/summary-items, yang merekonsiliasi dengan pesan & pengingat terbaru)
 * dan status ringkasan terbaru. Membukanya tidak pernah memicu panggilan LLM.
 *
 * Pemilih tampilan di kepala halaman membuka satu tanggal (`?date=YYYY-MM-DD`, bisa dibagikan):
 * apa yang terjadi hari itu ditambah status tindak lanjut SEKARANG tiap percakapannya, dengan
 * aksi yang sama dengan antrean. Tidak ada tampilan baca-saja: hari lama yang masih menyimpan
 * chat belum dibalas harus bisa langsung ditindaklanjuti dari sana. Enam tab dan kartu statistik
 * lama tetap dibuang -- angka hari itu cukup satu baris teks.
 */
function DailySummaryPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const param = searchParams.get('date')
  const urlDate = param && isDateKey(param) ? param : null

  // null = antrean sekarang; selain itu tanggal yang sedang dilihat.
  const [view, setView] = useState<string | null>(urlDate)
  const [prevUrlDate, setPrevUrlDate] = useState<string | null>(urlDate)
  const [data, setData] = useState<DailySummaryResponse | null>(null)
  const [dates, setDates] = useState<DailySummaryResponse['dates']>([])
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [queue, setQueue] = useState<SummaryItemsResponse | null>(null)
  const [bookingActions, setBookingActions] = useState<BookingQueueItem[]>([])
  const [queueError, setQueueError] = useState<string | null>(null)
  const [queueLoading, setQueueLoading] = useState(true)
  const [role, setRole] = useState<Session['role'] | null>(null)
  const [generating, setGenerating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // URL berubah dari luar (tombol kembali/maju): ikuti. Perubahan dari pemilih sudah lebih dulu
  // mengubah `view`, jadi tidak dihapus dua kali.
  if (urlDate !== prevUrlDate) {
    setPrevUrlDate(urlDate)
    if (urlDate !== view) {
      setView(urlDate)
      setData(null)
    }
  }

  const applySummary = useCallback((response: DailySummaryResponse) => {
    setData(response)
    setDates(response.dates)
    setSummaryError(null)
  }, [])

  const summaryFailed = useCallback((err: unknown) => {
    setSummaryError(err instanceof Error ? err.message : 'Gagal memuat ringkasan')
  }, [])

  const reloadSummary = useCallback(() => {
    return fetchJson<DailySummaryResponse>(summaryUrl(view)).then(applySummary).catch(summaryFailed)
  }, [view, applySummary, summaryFailed])

  const loadQueue = useCallback(() => {
    // Terpisah dan tak pernah menggagalkan antrean: bagian Booking hanya tambahan.
    fetchJson<{ items: BookingQueueItem[] }>('/api/booking-actions?state=OPEN')
      .then((r) => setBookingActions(Array.isArray(r.items) ? r.items : []))
      .catch(() => {})
    return fetchJson<SummaryItemsResponse>('/api/summary-items')
      .then((response) => {
        setQueue(response)
        setQueueError(null)
      })
      .catch((err: unknown) => setQueueError(err instanceof Error ? err.message : 'Gagal memuat antrean'))
      .finally(() => setQueueLoading(false))
  }, [])

  useEffect(() => {
    // `active`: berpindah tampilan sebelum jawaban datang tidak boleh menampilkan tanggal lama.
    let active = true
    fetchJson<DailySummaryResponse>(summaryUrl(view))
      .then((response) => {
        if (active) applySummary(response)
      })
      .catch((err: unknown) => {
        if (active) summaryFailed(err)
      })
    return () => {
      active = false
    }
  }, [view, applySummary, summaryFailed])

  useEffect(() => {
    void loadQueue()
  }, [loadQueue])

  useEffect(() => {
    fetchJson<Session>('/api/session')
      .then((s) => setRole(s.role))
      .catch(() => {})
  }, [])

  const isAdmin = hasAdminPowers(role)
  const summary = data?.summary ?? null
  const payload = summary?.payload ?? null

  function changeView(next: string | null) {
    if (next === view) return
    setView(next)
    setData(null)
    setSummaryError(null)
    setNotice(null)
    router.replace(next ? `/summary?date=${encodeURIComponent(next)}` : '/summary', { scroll: false })
  }

  async function reloadAll() {
    await Promise.all([reloadSummary(), loadQueue()])
  }

  async function regenerate() {
    setGenerating(true)
    setNotice(null)
    // Tampilan tanggal membuat ulang tanggal itu; antrean membuat ulang ringkasan terbaru, atau
    // tanpa ringkasan sama sekali job memilih sendiri hari WIB kemarin.
    const date = view ?? summary?.date ?? null
    try {
      await fetchJson<{ date: string; status: string }>('/api/daily-summary/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(date ? { date } : {}),
      })
      setNotice('Ringkasan selesai dibuat ulang.')
      // Buat ulang menyinkronkan item baru; antrean dan lencana menu ikut dimuat ulang.
      await reloadAll()
      announceSummaryItemsChanged()
    } catch (err: unknown) {
      setNotice(err instanceof Error ? err.message : 'Gagal membuat ringkasan')
    } finally {
      setGenerating(false)
    }
  }

  // Tanggal dari tautan yang dibagikan bisa sudah di luar 31 tanggal terakhir; tetap tampilkan.
  const dateOptions = view && !dates.some((d) => d.date === view) ? [view, ...dates.map((d) => d.date)] : dates.map((d) => d.date)

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Pilih tampilan" value={view ?? ''} onChange={(e) => changeView(e.target.value || null)}>
        <option value="">Antrean sekarang</option>
        {dateOptions.map((date) => (
          <option key={date} value={date}>
            {dateLabel(date)}
          </option>
        ))}
      </Select>
      {isAdmin && (
        <Button type="button" variant="outline" disabled={generating} onClick={() => void regenerate()}>
          {generating ? 'Membuat… (bisa beberapa menit)' : summary || view ? 'Buat ulang' : 'Buat ringkasan kemarin'}
        </Button>
      )}
    </div>
  )

  const openGapTotal = queue?.openGapTotal ?? 0

  return (
    <main className="mx-auto w-full max-w-[1600px] p-6">
      <PageHeader
        title="Summary Harian"
        description="Antrean tindakan dari ringkasan chat harian. Item selesai saat dibalas, dijadwalkan, atau dilepas."
        actions={actions}
      />

      {notice && (
        <p role="status" className="mt-4 text-sm text-ink-muted">
          {notice}
        </p>
      )}

      {/* Status ringkasan: dari mana antrean terakhir diisi, atau baris tanggal yang dipilih. */}
      <div className="mt-4 space-y-1">
        {summaryError ? (
          <p role="alert" className="text-sm text-danger">
            {summaryError}
          </p>
        ) : data && !summary ? (
          <p className="text-sm text-ink-muted">
            {view
              ? 'Belum ada ringkasan untuk tanggal ini.'
              : 'Belum ada ringkasan. Ringkasan pertama muncul setelah job 00:00 WIB berjalan.'}
          </p>
        ) : summary ? (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
              <span>
                {view ? 'Ringkasan' : 'Ringkasan terbaru'}: <span className="font-medium text-ink">{dateLabel(summary.date)}</span>
              </span>
              <span>Status: {STATUS_LABEL[summary.status] ?? summary.status}</span>
              {summary.model && <span>Model: {summary.model}</span>}
              {payload && <span>Dibuat {new Date(payload.generatedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB</span>}
              {payload?.excludedIndonesian && <span>Nomor Indonesia tidak dihitung (sesuai setelan Chatbot)</span>}
            </div>
            {summary.status === 'RUNNING' && (
              <p role="status" className="text-sm text-warning">
                Ringkasan sedang dibuat ulang. {view ? 'Isi' : 'Antrean'} di bawah belum memuat hasilnya.
              </p>
            )}
            {summary.status === 'PARTIAL' && payload && (
              <p role="status" className="text-sm text-warning">
                {payload.counts.reviewFailed} percakapan gagal dicek LLM dan ditandai &quot;Belum dicek LLM&quot;.
              </p>
            )}
            {summary.error && (
              <p role="alert" className="text-sm text-danger">
                {summary.error}
              </p>
            )}
          </>
        ) : null}
      </div>

      {openGapTotal > 0 && (
        <p className="mt-3 text-sm">
          <Link href="/settings/knowledge-gaps" className="focus-ring rounded-sm font-medium text-accent hover:underline">
            {openGapTotal} gap knowledge terbuka →
          </Link>
        </p>
      )}

      <div className="mt-6">
        {view ? (
          !data && !summaryError ? (
            <div aria-busy="true" className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : payload && data ? (
            <SummaryDayView payload={payload} items={data.items} onChanged={reloadAll} />
          ) : null
        ) : queueLoading ? (
          <div aria-busy="true" className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="space-y-3">
            {/* Gagal memuat ulang sesudah aksi tidak menghapus daftar yang sudah tampil. */}
            {queueError && (
              <p role="alert" className="text-sm text-danger">
                {queueError}
              </p>
            )}
            {queue && <SummaryQueue open={queue.open} scheduled={queue.scheduled} bookingActions={bookingActions} onChanged={loadQueue} />}
          </div>
        )}
      </div>
    </main>
  )
}

export default function DailySummaryPage() {
  // useSearchParams() butuh Suspense supaya `next build` tidak gagal (lihat halaman Inbox).
  return (
    <Suspense
      fallback={
        <main aria-busy="true" className="mx-auto w-full max-w-[1600px] p-6">
          <Skeleton className="h-24 w-full" />
        </main>
      }
    >
      <DailySummaryPageContent />
    </Suspense>
  )
}
