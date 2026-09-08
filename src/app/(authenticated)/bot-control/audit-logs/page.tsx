'use client'
import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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
const ACTION_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'destructive' | 'muted'> = {
  PUBLISH: 'default',
  ENABLE: 'success',
  DISABLE: 'warning',
}

/**
 * Satu baris per perubahan, dalam satu tabel — bukan tumpukan kartu, dan bukan tabel dengan
 * panel detail yang harus dibuka satu per satu.
 *
 * Pertanyaan yang dijawab halaman ini adalah "apa yang terjadi, berurutan". Menyusun ulang
 * urutan dari baris-baris yang harus diklik terbuka satu demi satu adalah persis hal yang
 * membuat sebuah audit log tidak pernah dibaca; begitu juga kartu, yang memakan empat kali
 * tinggi baris untuk lima potong teks pendek. Kelima potong itu adalah lima kolom.
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

      {error && <p className="text-base text-danger">{error}</p>}

      {loading && (
        <div className="space-y-px" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex h-9 items-center gap-3 border-b border-line">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-2/5" />
            </div>
          ))}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <EmptyState
          icon={<History strokeWidth={1.75} />}
          title="Belum ada perubahan yang tercatat."
          description="Log ini hanya terisi ketika seseorang mengubah apa yang bot lakukan. Kosong berarti belum ada yang diubah dalam rentang ini — bukan berarti pencatatannya mati."
          className="border-t border-line"
        />
      )}

      {!loading && !error && rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">Waktu</TableHead>
              <TableHead className="w-24">Aksi</TableHead>
              <TableHead>Entitas</TableHead>
              <TableHead className="w-40">Oleh</TableHead>
              <TableHead>Alasan</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className="h-auto align-top">
                <TableCell className="py-2.5 text-sm whitespace-nowrap text-ink-muted">
                  <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString('id-ID')}</time>
                </TableCell>
                <TableCell className="py-2.5">
                  <Badge variant={ACTION_VARIANT[row.action] ?? 'muted'}>{row.action}</Badge>
                </TableCell>
                <TableCell className="py-2.5">
                  <span className="font-mono text-xs text-ink-muted">{row.entityType}</span>
                  {row.entityKey && (
                    <span className="block font-mono text-xs break-all text-ink">{row.entityKey}</span>
                  )}
                </TableCell>
                <TableCell className="py-2.5 text-sm text-ink">
                  {/* Denormalised at write time, so it survives the account being deleted. */}
                  {row.actorName ?? <span className="text-ink-subtle italic">(akun terhapus)</span>}
                </TableCell>
                <TableCell className="py-2.5 text-sm text-ink-muted">
                  {row.reason ?? <span className="text-ink-subtle">—</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {!loading && !error && total > 50 && (
        <div className="flex items-center gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Sebelumnya
          </Button>
          <span className="text-ink-muted tabular-nums">
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
