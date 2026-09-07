'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { TRIAGE_STATUS_VARIANT, TRIAGE_ISSUE_LABEL } from '@/components/bot-control/TriagePanel'
import { TRIAGE_ISSUE_TYPES, TRIAGE_SEVERITIES, TRIAGE_STATUSES } from '@/lib/bot-control/triage-types'
import { roleNameCan } from '@/lib/bot-control/permissions'
import type { AccountRoleName } from '@/lib/auth/session'
import { fetchJson } from '@/lib/fetch-json'

type Session = { accountId?: string; role: AccountRoleName }

type TriageQueueRow = {
  id: string
  decisionRunId: string
  status: string
  issueType: string | null
  severity: string
  assignedTo: string | null
  assignedToName: string | null
  note: string | null
  resolvedByName: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
  decision: {
    conversationId: string
    inboundPreview: string
    status: string
    mode: string
    startedAt: string
  } | null
}

type Paged<T> = { items: T[]; page: number; limit: number; total: number }

const SEVERITY_VARIANT: Record<string, 'muted' | 'default' | 'warning' | 'destructive'> = {
  LOW: 'muted',
  NORMAL: 'default',
  HIGH: 'warning',
  CRITICAL: 'destructive',
}

/** Resolving and ignoring both close a case, so both ask why. */
const MIN_REASON_LENGTH = 10

/**
 * The follow-up queue.
 *
 * The same rows are reachable from Decision Logs, but only for the page an operator happens to be
 * looking at — triage lives in its own table with no foreign key to the decision (both are audit
 * records that outlive what they describe), so the decisions query cannot join on it and its
 * filter can only narrow rows already on screen. This page asks the triage table directly, which
 * is the only way to answer "what is still open across everything".
 *
 * Open work sorts above finished work, from the API. A queue whose top row is already done is a
 * queue people stop opening.
 */
export default function TriageQueuePage() {
  const [rows, setRows] = useState<TriageQueueRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [issueType, setIssueType] = useState('')
  const [severity, setSeverity] = useState('')
  const [mine, setMine] = useState(false)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [session, setSession] = useState<Session | null>(null)

  // Read out before the callback rather than reached through `session?.accountId` inside it: an
  // optional chain in a dependency array defeats the React Compiler's memoization analysis, and
  // the rule that catches it is an error in this project, not a warning.
  const accountId = session?.accountId ?? ''

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page) })
    if (status) params.set('status', status)
    if (issueType) params.set('issueType', issueType)
    if (severity) params.set('severity', severity)
    if (mine && accountId) params.set('assignedTo', accountId)

    return fetchJson<Paged<TriageQueueRow>>(`/api/bot-control/decisions/triage?${params}`)
      .then((data) => {
        setRows(data.items)
        setTotal(data.total)
        setError(null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Gagal memuat antrean tindak lanjut'))
      .finally(() => setLoading(false))
  }, [page, status, issueType, severity, mine, accountId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    fetchJson<Session>('/api/session')
      .then(setSession)
      .catch(() => {})
  }, [])

  const canClose = roleNameCan(session?.role, 'APPROVE')

  function applyFilter(apply: () => void) {
    apply()
    setPage(1)
    setLoading(true)
  }

  async function update(row: TriageQueueRow, patch: Record<string, unknown>, needsReason = false) {
    const body = { ...patch }
    if (needsReason) {
      const reason = window.prompt(`Catatan penyelesaian? (minimal ${MIN_REASON_LENGTH} karakter)`)?.trim()
      if (!reason || reason.length < MIN_REASON_LENGTH) return
      body.note = reason
    }

    setError(null)
    setBusyId(row.id)
    try {
      await fetchJson(`/api/bot-control/decisions/${row.decisionRunId}/triage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memperbarui tindak lanjut')
    } finally {
      setBusyId(null)
    }
  }

  const lastPage = Math.max(1, Math.ceil(total / 50))

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="space-y-1">
        <Link href="/bot-control" className="text-sm text-brand hover:underline">
          &larr; Kembali ke Bot Control
        </Link>
        <h1 className="text-xl font-semibold text-navy">Triage Queue</h1>
        <p className="text-sm text-muted-foreground">
          Keputusan bot yang sudah ditandai perlu ditindaklanjuti, dari seluruh riwayat — bukan hanya halaman yang
          sedang terbuka di Decision Logs.
        </p>
        <p className="text-xs text-muted-foreground">
          Menandai di sini tidak mengubah bot. Perbaikannya dibuat lewat Knowledge, Rules, atau Flows.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={status}
          onChange={(e) => applyFilter(() => setStatus(e.target.value))}
          className="w-auto"
          aria-label="Filter status"
        >
          <option value="">Semua status</option>
          {TRIAGE_STATUSES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
        <Select
          value={issueType}
          onChange={(e) => applyFilter(() => setIssueType(e.target.value))}
          className="w-auto"
          aria-label="Filter jenis masalah"
        >
          <option value="">Semua jenis masalah</option>
          {TRIAGE_ISSUE_TYPES.map((item) => (
            <option key={item} value={item}>
              {TRIAGE_ISSUE_LABEL[item] ?? item}
            </option>
          ))}
        </Select>
        <Select
          value={severity}
          onChange={(e) => applyFilter(() => setSeverity(e.target.value))}
          className="w-auto"
          aria-label="Filter tingkat"
        >
          <option value="">Semua tingkat</option>
          {TRIAGE_SEVERITIES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={mine}
            onChange={(e) => applyFilter(() => setMine(e.target.checked))}
            aria-label="Hanya tugas saya"
          />
          Hanya tugas saya
        </label>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Memuat...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && !error && rows.length === 0 && (
        <Card className="p-3">
          <p className="text-sm text-muted-foreground">Tidak ada tindak lanjut yang cocok dengan filter.</p>
        </Card>
      )}

      {!loading && !error && rows.length > 0 && (
        <ol className="space-y-3">
          {rows.map((row) => (
            <li key={row.id}>
              <Card className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={TRIAGE_STATUS_VARIANT[row.status] ?? 'muted'}>{row.status}</Badge>
                  <Badge variant={SEVERITY_VARIANT[row.severity] ?? 'default'}>{row.severity}</Badge>
                  {row.issueType && (
                    <span className="text-xs text-muted-foreground">
                      {TRIAGE_ISSUE_LABEL[row.issueType] ?? row.issueType}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(row.updatedAt).toLocaleString('id-ID')}
                  </span>
                </div>

                {/* Null once the decision has been cleared. The triage survives it by design, and
                    saying so beats an empty block that reads as a rendering bug. */}
                {row.decision ? (
                  <p className="text-sm text-navy">{row.decision.inboundPreview}</p>
                ) : (
                  <p className="text-sm italic text-muted-foreground">(keputusan sudah dihapus)</p>
                )}

                <p className="text-xs text-muted-foreground">
                  {row.assignedToName ? `Ditugaskan ke ${row.assignedToName}` : 'Belum ditugaskan'}
                  {row.resolvedByName && ` · diselesaikan ${row.resolvedByName}`}
                </p>
                {row.note && <p className="text-xs text-navy">Catatan: {row.note}</p>}

                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/bot-control/decisions?run=${encodeURIComponent(row.decisionRunId)}`}
                    className="text-xs text-brand hover:underline"
                  >
                    Buka di Decision Logs
                  </Link>

                  {/* Taking work is the one assignment an agent may make, so it is its own button
                      rather than a roster they have no permission to use. */}
                  {accountId && row.assignedTo !== accountId && row.status !== 'RESOLVED' && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === row.id}
                      onClick={() => update(row, { assignedTo: accountId })}
                    >
                      Ambil sendiri
                    </Button>
                  )}

                  {canClose && row.status !== 'RESOLVED' && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === row.id}
                      onClick={() => update(row, { status: 'RESOLVED' }, true)}
                    >
                      Tandai selesai
                    </Button>
                  )}
                  {canClose && row.status !== 'IGNORED' && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === row.id}
                      onClick={() => update(row, { status: 'IGNORED' }, true)}
                    >
                      Abaikan
                    </Button>
                  )}
                  {/* Nothing is deleted: a closed triage can be reopened, and "pernah diputuskan
                      tidak perlu diapa-apakan" stays readable. */}
                  {canClose && (row.status === 'RESOLVED' || row.status === 'IGNORED') && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === row.id}
                      onClick={() => update(row, { status: 'OPEN' })}
                    >
                      Buka lagi
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ol>
      )}

      {!loading && !error && total > 50 && (
        <div className="flex items-center gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Sebelumnya
          </Button>
          <span className="text-muted-foreground">
            Halaman {page} dari {lastPage} &middot; {total} tindak lanjut
          </span>
          <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
            Berikutnya
          </Button>
        </div>
      )}
    </main>
  )
}
