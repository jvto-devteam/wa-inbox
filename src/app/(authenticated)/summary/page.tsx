'use client'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ConversationSummariesSection,
  DormantSection,
  GapSection,
  HandoffSection,
  NewLeadsSection,
  UnrepliedSection,
} from '@/components/daily-summary/SummarySections'
import type { DailySummaryResponse } from '@/app/api/daily-summary/route'
import type { AccountRoleName } from '@/lib/auth/session'
import { hasAdminPowers } from '@/lib/bot-control/permissions'
import { fetchJson } from '@/lib/fetch-json'

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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="text-xl font-semibold text-ink tabular-nums">{value}</p>
    </div>
  )
}

/**
 * Ringkasan chat harian. Dibuat job tiap 00:00 WIB (POST /api/daily-summary/generate) untuk hari
 * yang baru selesai; halaman ini hanya membaca hasil yang tersimpan, jadi membukanya tidak
 * pernah memicu panggilan LLM.
 */
export default function DailySummaryPage() {
  const [data, setData] = useState<DailySummaryResponse | null>(null)
  // null = tanggal terbaru yang tersedia.
  const [date, setDate] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [role, setRole] = useState<Session['role'] | null>(null)
  const [generating, setGenerating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(() => {
    return fetchJson<DailySummaryResponse>(`/api/daily-summary${date ? `?date=${encodeURIComponent(date)}` : ''}`)
      .then((response) => {
        setData(response)
        setError(null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Gagal memuat ringkasan'))
      .finally(() => setLoading(false))
  }, [date])

  useEffect(() => {
    void load()
  }, [load])

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
      await load()
    } catch (err: unknown) {
      setNotice(err instanceof Error ? err.message : 'Gagal membuat ringkasan')
    } finally {
      setGenerating(false)
    }
  }

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {data && data.dates.length > 0 && (
        <Select
          aria-label="Pilih tanggal"
          value={summary?.date ?? ''}
          onChange={(e) => {
            setLoading(true)
            setDate(e.target.value)
          }}
        >
          {data.dates.map((d) => (
            <option key={d.date} value={d.date}>
              {dateLabel(d.date)}
            </option>
          ))}
        </Select>
      )}
      {isAdmin && (
        <Button type="button" variant="outline" disabled={generating} onClick={() => void regenerate()}>
          {generating ? 'Membuat… (bisa beberapa menit)' : summary ? 'Buat ulang' : 'Buat ringkasan kemarin'}
        </Button>
      )}
    </div>
  )

  return (
    <main className="mx-auto w-full max-w-[1100px] p-6">
      <PageHeader
        title="Summary Harian"
        description="Rekap chat per hari WIB, dibuat otomatis tiap 00:00. Disimpan 30 hari."
        actions={actions}
      />

      {notice && (
        <p role="status" className="mt-4 text-sm text-ink-muted">
          {notice}
        </p>
      )}

      {loading ? (
        <div aria-busy="true" className="mt-6 space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : error ? (
        <p role="alert" className="mt-6 text-sm text-danger">
          {error}
        </p>
      ) : !summary ? (
        <EmptyState
          className="mt-6"
          title="Belum ada ringkasan."
          description="Ringkasan pertama muncul setelah job 00:00 WIB berjalan."
        />
      ) : (
        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
            <span className="font-medium text-ink">{dateLabel(summary.date)}</span>
            <span>Status: {STATUS_LABEL[summary.status] ?? summary.status}</span>
            {summary.model && <span>Model: {summary.model}</span>}
            {payload && <span>Dibuat {new Date(payload.generatedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB</span>}
          </div>

          {summary.status === 'RUNNING' && (
            <p role="status" className="text-sm text-warning">
              Ringkasan sedang dibuat ulang. Yang tampil di bawah adalah versi sebelumnya, kalau ada.
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

          {payload && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Percakapan aktif" value={payload.counts.activeConversations} />
                <Stat label="Pesan masuk" value={payload.counts.inbound} />
                <Stat label="Pesan keluar" value={payload.counts.outbound} />
                <Stat label="Kontak baru" value={payload.counts.newConversations} />
              </div>
              <UnrepliedSection items={payload.unreplied} filteredOut={payload.filteredOut.unreplied} windowEnd={payload.windowEnd} />
              <DormantSection items={payload.dormant} filteredOut={payload.filteredOut.dormant} windowEnd={payload.windowEnd} />
              <NewLeadsSection items={payload.newLeads} />
              <HandoffSection items={payload.handoffs} />
              <GapSection gaps={payload.gaps} />
              <ConversationSummariesSection items={payload.conversations} />
            </>
          )}
        </div>
      )}
    </main>
  )
}
