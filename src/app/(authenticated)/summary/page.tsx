'use client'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { SummaryQueue } from '@/components/daily-summary/SummaryQueue'
import type { DailySummaryResponse } from '@/app/api/daily-summary/route'
import type { SummaryItemsResponse } from '@/app/api/summary-items/route'
import type { AccountRoleName } from '@/lib/auth/session'
import { hasAdminPowers } from '@/lib/bot-control/permissions'
import { fetchJson } from '@/lib/fetch-json'
import { announceSummaryItemsChanged } from '@/lib/summary-items/events'

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

/**
 * Summary Harian sebagai SATU antrean tindakan. Ringkasan dibuat job tiap 00:00 WIB
 * (POST /api/daily-summary/generate) dan disinkronkan jadi SummaryItem; halaman ini membaca
 * antrean itu (GET /api/summary-items, yang merekonsiliasi dengan pesan & pengingat terbaru)
 * dan status ringkasan terbaru. Membukanya tidak pernah memicu panggilan LLM.
 *
 * Pemilih tanggal, enam tab, dan kartu statistik sengaja dibuang: laporan per hari menjawab
 * "apa yang terjadi kemarin", padahal yang dibutuhkan operator adalah "apa yang masih harus
 * saya kerjakan" -- dan item yang sudah dibalas tidak boleh terus muncul.
 */
export default function DailySummaryPage() {
  const [data, setData] = useState<DailySummaryResponse | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [queue, setQueue] = useState<SummaryItemsResponse | null>(null)
  const [queueError, setQueueError] = useState<string | null>(null)
  const [queueLoading, setQueueLoading] = useState(true)
  const [role, setRole] = useState<Session['role'] | null>(null)
  const [generating, setGenerating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const loadSummary = useCallback(() => {
    // Tanpa `date` = ringkasan terbaru.
    return fetchJson<DailySummaryResponse>('/api/daily-summary')
      .then((response) => {
        setData(response)
        setSummaryError(null)
      })
      .catch((err: unknown) => setSummaryError(err instanceof Error ? err.message : 'Gagal memuat ringkasan'))
  }, [])

  const loadQueue = useCallback(() => {
    return fetchJson<SummaryItemsResponse>('/api/summary-items')
      .then((response) => {
        setQueue(response)
        setQueueError(null)
      })
      .catch((err: unknown) => setQueueError(err instanceof Error ? err.message : 'Gagal memuat antrean'))
      .finally(() => setQueueLoading(false))
  }, [])

  useEffect(() => {
    void loadSummary()
    void loadQueue()
  }, [loadSummary, loadQueue])

  useEffect(() => {
    fetchJson<Session>('/api/session')
      .then((s) => setRole(s.role))
      .catch(() => {})
  }, [])

  const isAdmin = hasAdminPowers(role)
  const summary = data?.summary ?? null
  const payload = summary?.payload ?? null

  async function regenerate() {
    setGenerating(true)
    setNotice(null)
    try {
      await fetchJson<{ date: string; status: string }>('/api/daily-summary/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Tanpa ringkasan sama sekali, job memilih sendiri hari WIB kemarin.
        body: JSON.stringify(summary ? { date: summary.date } : {}),
      })
      setNotice('Ringkasan selesai dibuat ulang.')
      // Buat ulang menyinkronkan item baru; antrean dan lencana menu ikut dimuat ulang.
      await Promise.all([loadSummary(), loadQueue()])
      announceSummaryItemsChanged()
    } catch (err: unknown) {
      setNotice(err instanceof Error ? err.message : 'Gagal membuat ringkasan')
    } finally {
      setGenerating(false)
    }
  }

  const actions = isAdmin ? (
    <Button type="button" variant="outline" disabled={generating} onClick={() => void regenerate()}>
      {generating ? 'Membuat… (bisa beberapa menit)' : summary ? 'Buat ulang' : 'Buat ringkasan kemarin'}
    </Button>
  ) : undefined

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

      {/* Status ringkasan terbaru: dari mana antrean ini terakhir diisi. */}
      <div className="mt-4 space-y-1">
        {summaryError ? (
          <p role="alert" className="text-sm text-danger">
            {summaryError}
          </p>
        ) : data && !summary ? (
          <p className="text-sm text-ink-muted">Belum ada ringkasan. Ringkasan pertama muncul setelah job 00:00 WIB berjalan.</p>
        ) : summary ? (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
              <span>
                Ringkasan terbaru: <span className="font-medium text-ink">{dateLabel(summary.date)}</span>
              </span>
              <span>Status: {STATUS_LABEL[summary.status] ?? summary.status}</span>
              {summary.model && <span>Model: {summary.model}</span>}
              {payload && <span>Dibuat {new Date(payload.generatedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB</span>}
              {payload?.excludedIndonesian && <span>Nomor Indonesia tidak dihitung (sesuai setelan Chatbot)</span>}
            </div>
            {summary.status === 'RUNNING' && (
              <p role="status" className="text-sm text-warning">
                Ringkasan sedang dibuat ulang. Antrean di bawah belum memuat hasilnya.
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
        {queueLoading ? (
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
            {queue && <SummaryQueue open={queue.open} scheduled={queue.scheduled} onChanged={loadQueue} />}
          </div>
        )}
      </div>
    </main>
  )
}
