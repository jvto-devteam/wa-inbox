'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AuditDiff, type AuditDiffSide } from '@/components/bot-control/AuditDiff'
import { fetchJson } from '@/lib/fetch-json'

type AuditRow = {
  id: string
  actorId: string | null
  actorName: string | null
  action: string
  entityType: string
  entityId: string | null
  entityKey: string | null
  before: AuditDiffSide
  after: AuditDiffSide
  reason: string | null
  releaseId: string | null
  createdAt: string
}

type Paged<T> = { items: T[]; page: number; limit: number; total: number }

const ACTIONS = [
  'CREATE_DRAFT',
  'UPDATE_DRAFT',
  'REQUEST_REVIEW',
  'APPROVE',
  'REJECT',
  'PUBLISH',
  'ROLLBACK',
  'ENABLE',
  'DISABLE',
  'RUN_TEST',
  'OVERRIDE_TEST_FAILURE',
]

// Every entityType `writeBotAuditLog` is actually called with. DECISION_TRIAGE was missing
// until the Phase A-H review: triage changes were audited but unfilterable, which makes the
// rows effectively invisible on a busy log.
const ENTITY_TYPES = ['RELEASE', 'RULE', 'KNOWLEDGE', 'FLOW', 'CHANNEL_POLICY', 'DECISION_TRIAGE']

// Actions that change what the bot does get visual weight; the rest stay quiet. An audit log
// where every row shouts is one where the ROLLBACK at 03:00 does not stand out.
const ACTION_VARIANT: Record<string, 'brand' | 'success' | 'warning' | 'destructive' | 'muted'> = {
  PUBLISH: 'brand',
  ROLLBACK: 'warning',
  APPROVE: 'success',
  REJECT: 'destructive',
  OVERRIDE_TEST_FAILURE: 'destructive',
}

/**
 * A timeline, not a table with an expandable detail pane.
 *
 * The question this page answers is "what happened, in order" — reconstructing a sequence from
 * rows an operator has to click open one at a time is the thing that makes an audit log go
 * unread. The diff is inline for the same reason.
 *
 * There is deliberately no edit or delete control anywhere on this page, and no API behind one
 * (SDD Manage Second §9.9). An audit log an operator can edit is not an audit log.
 */
export default function AuditLogsPage() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const [entityType, setEntityType] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ page: String(page) })
    if (action) params.set('action', action)
    if (entityType) params.set('entityType', entityType)
    if (dateFrom) params.set('dateFrom', dateFrom)
    // The picker gives a date; the column is a timestamp. Without pushing the upper bound to
    // the end of the day, "sampai 7 Sep" silently excludes everything that happened on 7 Sep.
    if (dateTo) params.set('dateTo', `${dateTo}T23:59:59.999Z`)

    fetchJson<Paged<AuditRow>>(`/api/bot-control/audit-logs?${params}`)
      .then((data) => {
        if (cancelled) return
        setRows(data.items)
        setTotal(data.total)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Gagal memuat audit log')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [page, action, entityType, dateFrom, dateTo])

  // Every filter change returns to page 1: staying on page 4 of a narrower result set shows an
  // empty list and reads as "no matches" when there genuinely are some.
  function applyFilter(apply: () => void) {
    apply()
    setPage(1)
    setLoading(true)
  }

  const lastPage = Math.max(1, Math.ceil(total / 50))

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="space-y-1">
        <Link href="/bot-control" className="text-sm text-brand hover:underline">
          &larr; Kembali ke Bot Control
        </Link>
        <h1 className="text-xl font-semibold text-navy">Audit Logs</h1>
        <p className="text-sm text-muted-foreground">
          Siapa mengubah apa, kapan, dan mengapa. Kolom <span className="font-mono">updatedBy</span> di tiap entitas
          hanya menyimpan penulis terakhir — dan justru perubahan sebelumnya yang dicari saat bot mulai menjawab
          salah.
        </p>
        <p className="text-xs text-muted-foreground">Catatan di sini tidak bisa diubah atau dihapus dari UI.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={action}
          onChange={(e) => applyFilter(() => setAction(e.target.value))}
          className="w-auto"
          aria-label="Filter aksi"
        >
          <option value="">Semua aksi</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
        <Select
          value={entityType}
          onChange={(e) => applyFilter(() => setEntityType(e.target.value))}
          className="w-auto"
          aria-label="Filter jenis entitas"
        >
          <option value="">Semua entitas</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
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
      </div>

      {loading && <p className="text-sm text-muted-foreground">Memuat...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && !error && rows.length === 0 && (
        <Card className="p-3">
          <p className="text-sm text-muted-foreground">Belum ada perubahan yang tercatat.</p>
        </Card>
      )}

      {!loading && !error && rows.length > 0 && (
        <ol className="space-y-3">
          {rows.map((row) => (
            <li key={row.id}>
              <Card className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={ACTION_VARIANT[row.action] ?? 'muted'}>{row.action}</Badge>
                  <span className="font-mono text-xs text-muted-foreground">{row.entityType}</span>
                  {row.entityKey && <span className="font-mono text-xs text-navy">{row.entityKey}</span>}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(row.createdAt).toLocaleString('id-ID')}
                  </span>
                </div>

                <p className="text-xs text-muted-foreground">
                  {/* Denormalised at write time, so it survives the account being deleted. */}
                  oleh {row.actorName ?? <span className="italic">(akun terhapus)</span>}
                  {row.releaseId && (
                    <>
                      {' · '}
                      <Link href="/bot-control/releases" className="text-brand hover:underline">
                        release terkait
                      </Link>
                    </>
                  )}
                </p>

                {row.reason && <p className="text-xs text-navy">Alasan: {row.reason}</p>}

                <AuditDiff before={row.before} after={row.after} />
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
            Halaman {page} dari {lastPage}
          </span>
          <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
            Berikutnya
          </Button>
        </div>
      )}
    </main>
  )
}
