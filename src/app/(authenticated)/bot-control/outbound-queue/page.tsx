'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  OutboundQueueTable,
  type OutboundJobRow,
  type JobAction,
} from '@/components/bot-control/OutboundQueueTable'
import { hasAdminPowers } from '@/lib/bot-control/permissions'
import type { AccountRoleName } from '@/lib/auth/session'
import { fetchJson } from '@/lib/fetch-json'

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
const PROVIDERS = ['COEXIST', 'META']
const CHANNELS = ['UNOFFICIAL', 'OFFICIAL']

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
 */
export default function OutboundQueuePage() {
  const [data, setData] = useState<QueueResponse | null>(null)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [provider, setProvider] = useState('')
  const [channel, setChannel] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [stuckOnly, setStuckOnly] = useState(false)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [role, setRole] = useState<Session['role'] | null>(null)

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page) })
    if (status) params.set('status', status)
    if (provider) params.set('provider', provider)
    if (channel) params.set('channel', channel)
    if (dateFrom) params.set('dateFrom', dateFrom)
    // The picker gives a date; the column is a timestamp. Without pushing the upper bound to the
    // end of the day, "sampai 7 Sep" silently excludes everything that happened on 7 Sep.
    if (dateTo) params.set('dateTo', `${dateTo}T23:59:59.999Z`)
    if (stuckOnly) params.set('stuck', 'true')

    return fetchJson<QueueResponse>(`/api/outbound-jobs?${params}`)
      .then((response) => {
        setData(response)
        setError(null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Gagal memuat antrean'))
      .finally(() => setLoading(false))
  }, [page, status, provider, channel, dateFrom, dateTo, stuckOnly])

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
    <main className="mx-auto max-w-7xl space-y-4 p-6">
      <div className="space-y-1">
        <Link href="/bot-control" className="text-sm text-brand hover:underline">
          &larr; Kembali ke Bot Control
        </Link>
        <h1 className="text-xl font-semibold text-navy">Outbound Queue</h1>
        <p className="text-sm text-muted-foreground">
          Setiap pengiriman yang masih harus terjadi, beserta alasan kegagalannya. Sebelumnya satu-satunya jendela ke
          sini adalah badge pengiriman pada satu bubble di satu percakapan.
        </p>
      </div>

      {data && data.pausedProviders.length > 0 && (
        // Shown to everyone who opens the page, not only to whoever pressed the button: a queue
        // that looks stalled for no reason is how an operator starts retrying by hand.
        <Card className="border-amber-300 bg-amber-50 p-3">
          <p className="text-xs text-amber-900">
            Provider dijeda: <strong>{data.pausedProviders.join(', ')}</strong>. Job untuk provider itu tetap di
            antrean dan tidak dikirim sampai dilanjutkan — tidak ada yang gagal karenanya.
          </p>
        </Card>
      )}

      {data && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {['QUEUED', 'SENDING', 'RETRYING', 'SENT', 'FAILED', 'CANCELLED'].map((key) => (
            <Card key={key} className="p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{key}</p>
              <p className="text-lg font-semibold text-navy tabular-nums">{data.summary[key] ?? 0}</p>
            </Card>
          ))}
        </div>
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
        <Select
          value={provider}
          onChange={(e) => applyFilter(() => setProvider(e.target.value))}
          className="w-auto"
          aria-label="Filter provider"
        >
          <option value="">Semua provider</option>
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <Select
          value={channel}
          onChange={(e) => applyFilter(() => setChannel(e.target.value))}
          className="w-auto"
          aria-label="Filter channel"
        >
          <option value="">Semua channel</option>
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => applyFilter(() => setDateFrom(e.target.value))}
          aria-label="Dari tanggal"
          className="w-40"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => applyFilter(() => setDateTo(e.target.value))}
          aria-label="Sampai tanggal"
          className="w-40"
        />
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={stuckOnly}
            onChange={(e) => applyFilter(() => setStuckOnly(e.target.checked))}
            aria-label="Hanya job menggantung"
          />
          Hanya yang menggantung
        </label>
      </div>

      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2">
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

      {loading && <p className="text-sm text-muted-foreground">Memuat...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {notice && <p className="text-sm text-emerald-700">{notice}</p>}

      {!loading && !error && data && (
        <Card className="p-0">
          <OutboundQueueTable
            jobs={data.items}
            canRetry={role !== null}
            canCancel={isAdmin}
            busyId={busyId}
            onAction={handleJobAction}
          />
        </Card>
      )}

      {!loading && !error && (data?.total ?? 0) > 50 && (
        <div className="flex items-center gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Sebelumnya
          </Button>
          <span className="text-muted-foreground">
            Halaman {page} dari {lastPage} &middot; {data?.total} job
          </span>
          <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
            Berikutnya
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        <Badge variant="muted">Catatan</Badge> Membatalkan job menandai bubble-nya gagal — dari sisi customer memang
        tidak ada yang sampai.
      </p>
    </main>
  )
}
