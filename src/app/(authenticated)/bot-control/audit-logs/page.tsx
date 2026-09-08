'use client'
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { fetchJson } from '@/lib/fetch-json'
import { PageHeader } from '@/components/ui/page-header'

type AuditRow = {
  id: string
  actorId: string | null
  actorName: string | null
  action: string
  entityType: string
  entityId: string | null
  entityKey: string | null
  reason: string | null
  createdAt: string
}

type Paged<T> = { items: T[]; page: number; limit: number; total: number }

// Mirrors AUDIT_ACTIONS in src/lib/bot-control/audit.ts. An option nobody ever writes is a
// filter that always returns nothing, so the two lists move together.
const ACTIONS = ['UPDATE', 'PUBLISH', 'ENABLE', 'DISABLE']

// Every entityType `writeBotAuditLog` is actually called with. BOT_SETTING covers the global
// switches on /chatbot and the outbound safety thresholds.
const ENTITY_TYPES = ['KNOWLEDGE', 'BOT_SETTING', 'OUTBOUND_PROVIDER', 'OUTBOUND_JOB']

// Turning something OFF gets visual weight: it is the row somebody is looking for when the bot
// stopped answering. A log where every row shouts is one where that row does not stand out.
const ACTION_VARIANT: Record<string, 'brand' | 'success' | 'warning' | 'destructive' | 'muted'> = {
  PUBLISH: 'brand',
  ENABLE: 'success',
  DISABLE: 'warning',
}

/**
 * A timeline, not a table with an expandable detail pane.
 *
 * The question this page answers is "what happened, in order" — reconstructing a sequence from
 * rows an operator has to click open one at a time is the thing that makes an audit log go
 * unread.
 *
 * There is no before/after diff, deliberately. Proving which of two people changed a value is a
 * question wa-inbox does not have (one team, and every entity already shows the value in force);
 * what an operator comes here for is when a switch was last flipped, by whom, and why.
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
      <PageHeader
        title="Audit Logs"
        description={
          <>
            <p>
              Riwayat perubahan perilaku bot: kapan, siapa, apa, dan alasannya. Nilai yang berlaku sekarang selalu
              terlihat di halaman entitasnya sendiri — di sini yang dicatat adalah kapan ia terakhir diubah.
            </p>
            <p className="mt-1 text-xs">
              Catatan di sini tidak bisa diubah atau dihapus dari UI, dan dipangkas otomatis setelah satu tahun.
            </p>
          </>
        }
      />

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
                </p>

                {row.reason && <p className="text-xs text-navy">Alasan: {row.reason}</p>}
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
