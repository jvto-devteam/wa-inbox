'use client'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { TableContainer } from '@/components/ui/table'
import {
  OutboundQueueTable,
  type OutboundJobRow,
  type JobAction,
} from '@/components/bot-control/OutboundQueueTable'
import { hasAdminPowers } from '@/lib/bot-control/permissions'
import type { AccountRoleName } from '@/lib/auth/session'
import { fetchJson } from '@/lib/fetch-json'
import { PageHeader } from '@/components/ui/page-header'

type Session = { role: AccountRoleName }

type QueueResponse = {
  items: OutboundJobRow[]
  summary: Record<string, number>
  pausedProviders: string[]
  page: number
  limit: number
  total: number
}

const STATUSES = ['QUEUED', 'SENDING', 'RETRYING', 'SENT', 'FAILED', 'CANCELLED']

/** Not a filter — the providers that can be paused, one button each. Mirrors PAUSABLE_PROVIDERS. */
const PROVIDERS = ['COEXIST', 'META']

/** Cancel and pause both take something away, so both ask why. */
const MIN_REASON_LENGTH = 10

/**
 * The outbound queue page.
 *
 * Until now the queue was write-only from a human's point of view: the only window onto it was
 * the delivery badge on one bubble in one conversation, so a provider outage that failed forty
 * messages across thirty conversations was invisible unless somebody opened all thirty. The API
 * has existed since Phase A; this is the page it was built for.
 *
 * The summary cards count the WHOLE queue, never the filtered page — an operator who has filtered
 * to FAILED still needs to see how many are queued behind it.
 *
 * TWO filters, not six. This page gets opened in a panic — a provider is misbehaving and somebody
 * wants to see what is held up and press retry — and that state asks only two questions: what
 * status is it in, and what stopped moving. Provider and channel each had exactly two values and
 * are already printed on every row; a created-at range answers a reporting question nobody has
 * about a queue that drains itself. Both remaining filters are applied by the API inside its
 * `where`, so the count, the rows and the paging all agree.
 */
export default function OutboundQueuePage() {
  const [data, setData] = useState<QueueResponse | null>(null)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [stuckOnly, setStuckOnly] = useState(false)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [role, setRole] = useState<Session['role'] | null>(null)

  const load = useCallback(() => {
    // Both filters go to the server as query params and land in the API's `where`. Fetching a
    // page of rows and hiding some of them here would break the count and the paging with it.
    const params = new URLSearchParams({ page: String(page) })
    if (status) params.set('status', status)
    if (stuckOnly) params.set('stuck', 'true')

    return fetchJson<QueueResponse>(`/api/outbound-jobs?${params}`)
      .then((response) => {
        setData(response)
        setError(null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Gagal memuat antrean'))
      .finally(() => setLoading(false))
  }, [page, status, stuckOnly])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    fetchJson<Session>('/api/session')
      .then((s) => setRole(s.role))
      .catch(() => {})
  }, [])

  const isAdmin = hasAdminPowers(role)

  function applyFilter(apply: () => void) {
    apply()
    setPage(1)
    setLoading(true)
  }

  async function handleJobAction(job: OutboundJobRow, action: JobAction) {
    setError(null)
    setNotice(null)

    const body: Record<string, unknown> = {}
    let url = ''
    if (action === 'retry') {
      url = '/api/outbound-jobs/retry'
      body.messageId = job.messageId
    } else {
      const reason = window
        .prompt(`Alasan membatalkan pengiriman ini? (minimal ${MIN_REASON_LENGTH} karakter)`)
        ?.trim()
      if (!reason || reason.length < MIN_REASON_LENGTH) return
      url = `/api/outbound-jobs/${job.id}/cancel`
      body.reason = reason
    }

    setBusyId(job.id)
    try {
      await fetchJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memproses job')
    } finally {
      setBusyId(null)
    }
  }

  async function recoverStuck() {
    setError(null)
    setNotice(null)
    try {
      const result = await fetchJson<{ requeued: number; failed: number }>('/api/outbound-jobs/recover-stuck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      // "0 dipulihkan" is a real answer — the queue is healthy — and different information from
      // a failure, so it is reported rather than swallowed.
      setNotice(`${result.requeued} job dikembalikan ke antrean, ${result.failed} ditandai gagal.`)
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memulihkan job yang menggantung')
    }
  }

  async function toggleProvider(target: string, paused: boolean) {
    const verb = paused ? 'melanjutkan' : 'menjeda'
    const reason = window.prompt(`Alasan ${verb} provider ${target}? (minimal ${MIN_REASON_LENGTH} karakter)`)?.trim()
    if (!reason || reason.length < MIN_REASON_LENGTH) return

    setError(null)
    setNotice(null)
    try {
      await fetchJson(`/api/outbound-jobs/${paused ? 'resume' : 'pause'}-provider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: target, reason }),
      })
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mengubah status provider')
    }
  }

  const lastPage = Math.max(1, Math.ceil((data?.total ?? 0) / 50))

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-4 p-6">
      <PageHeader
        title="Outbound Queue"
        description="Setiap pengiriman yang masih harus terjadi, beserta alasan kegagalannya. Sebelumnya satu-satunya jendela ke sini adalah badge pengiriman pada satu bubble di satu percakapan."
      />

      {data && data.pausedProviders.length > 0 && (
        // Shown to everyone who opens the page, not only to whoever pressed the button: a queue
        // that looks stalled for no reason is how an operator starts retrying by hand.
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-subtle px-3 py-2">
          <AlertTriangle aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-warning" />
          <p className="text-sm text-warning">
            Provider dijeda: <strong className="font-semibold">{data.pausedProviders.join(', ')}</strong>. Job untuk
            provider itu tetap di antrean dan tidak dikirim sampai dilanjutkan — tidak ada yang gagal karenanya.
          </p>
        </div>
      )}

      {/* Angka di sini menghitung SELURUH antrean, bukan halaman yang tampil: operator yang sudah
          menyaring ke FAILED tetap perlu tahu berapa yang mengantre di belakangnya. Sengaja satu
          baris berpembatas garis rambut, bukan enam kartu — enam kotak untuk enam angka adalah
          lima kotak lebih banyak daripada yang dibutuhkan. */}
      {data && (
        <dl className="flex flex-wrap items-stretch divide-x divide-line rounded-md border border-line bg-surface">
          {STATUSES.map((key) => (
            <div key={key} className="min-w-24 flex-1 px-3 py-2">
              <dt className="text-xs text-ink-muted">{key}</dt>
              <dd className="text-lg leading-tight font-semibold text-ink tabular-nums">{data.summary[key] ?? 0}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={status}
          onChange={(e) => applyFilter(() => setStatus(e.target.value))}
          className="w-auto"
          aria-label="Filter status"
        >
          <option value="">Semua status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={stuckOnly}
            onChange={(e) => applyFilter(() => setStuckOnly(e.target.checked))}
            aria-label="Hanya job menggantung"
            className="size-3.5"
          />
          Hanya yang menggantung
        </label>

        {isAdmin && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={recoverStuck}>
              Pulihkan job menggantung
            </Button>
            {PROVIDERS.map((target) => {
              const paused = data?.pausedProviders.includes(target) ?? false
              return (
                <Button key={target} variant="outline" size="sm" onClick={() => toggleProvider(target, paused)}>
                  {paused ? `Lanjutkan ${target}` : `Jeda ${target}`}
                </Button>
              )
            })}
          </div>
        )}
      </div>

      {error && <p className="text-base text-danger">{error}</p>}
      {notice && <p className="text-base text-success">{notice}</p>}

      {/* Wadah yang sama dengan tabelnya: halaman ini dibuka saat panik, dan kotak yang
          melompat masuk-keluar antara memuat dan terisi membuat antrean terlihat berubah
          padahal yang berubah hanya keadaan pemuatannya. */}
      {loading && (
        <TableContainer>
          <div aria-hidden="true" className="divide-y divide-line">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex h-9 items-center gap-3 px-3">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-10" />
                <Skeleton className="h-3 w-2/5" />
              </div>
            ))}
          </div>
        </TableContainer>
      )}

      {!loading && !error && data && (
        <OutboundQueueTable
          jobs={data.items}
          canRetry={role !== null}
          canCancel={isAdmin}
          busyId={busyId}
          onAction={handleJobAction}
        />
      )}

      {!loading && !error && (data?.total ?? 0) > 50 && (
        <div className="flex items-center gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Sebelumnya
          </Button>
          <span className="text-ink-muted tabular-nums">
            Halaman {page} dari {lastPage} &middot; {data?.total} job
          </span>
          <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
            Berikutnya
          </Button>
        </div>
      )}

      <p className="border-t border-line pt-3 text-sm text-ink-muted">
        Membatalkan job menandai bubble-nya gagal — dari sisi customer memang tidak ada yang sampai.
      </p>
    </main>
  )
}
