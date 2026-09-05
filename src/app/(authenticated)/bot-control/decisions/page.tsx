'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DecisionTracePanel, STATUS_VARIANT, type DecisionRunDetail } from '@/components/bot-control/DecisionTracePanel'
import { fetchJson } from '@/lib/fetch-json'

type DecisionRow = {
  id: string
  conversationId: string
  contactName: string | null
  contactPhone: string | null
  mode: string
  status: string
  inboundPreview: string
  latencyMs: number | null
  knowledgeRefsCount: number
  hasVerification: boolean
  error: string | null
  startedAt: string
}

type Paged<T> = { items: T[]; page: number; limit: number; total: number }

// SIMULATED is included so Test Lab runs are filterable -- and, more importantly, so an
// operator can filter them OUT when auditing real customer traffic.
const STATUSES = ['REPLIED', 'CLARIFIED', 'HANDOFF', 'SKIPPED', 'FAILED', 'SIMULATED']
const MODES = ['faq', 'booking_context', 'clarify', 'handoff']

export default function DecisionLogsPage() {
  const [rows, setRows] = useState<DecisionRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [mode, setMode] = useState('')
  const [conversationId, setConversationId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selected, setSelected] = useState<DecisionRunDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ page: String(page) })
    if (status) params.set('status', status)
    if (mode) params.set('mode', mode)
    if (conversationId.trim()) params.set('conversationId', conversationId.trim())
    if (dateFrom) params.set('dateFrom', dateFrom)
    // The picker gives a date; the column is a timestamp. Without pushing the upper bound to
    // the end of the day, "sampai 5 Sep" silently excludes everything that happened on 5 Sep.
    if (dateTo) params.set('dateTo', `${dateTo}T23:59:59.999Z`)

    fetchJson<Paged<DecisionRow>>(`/api/bot-control/decisions?${params}`)
      .then((data) => {
        if (cancelled) return
        setRows(data.items)
        setTotal(data.total)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Gagal memuat log keputusan')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [page, status, mode, conversationId, dateFrom, dateTo])

  // Deep link from the inbox trace popover: /bot-control/decisions?run=<id> opens that run's
  // detail straight away. Read off window.location rather than useSearchParams() so the page
  // needs no Suspense boundary — the param is only ever consumed once, on mount.
  useEffect(() => {
    const runId = new URLSearchParams(window.location.search).get('run')
    // Mount-only: a later filter change must not re-open a detail the user has closed.
    if (runId) openDetail(runId)
  }, [])

  function openDetail(id: string) {
    setDetailLoading(true)
    setDetailError(null)
    setSelected(null)
    fetchJson<DecisionRunDetail>(`/api/bot-control/decisions/${id}`)
      .then(setSelected)
      .catch((err: unknown) => setDetailError(err instanceof Error ? err.message : 'Gagal memuat detail'))
      .finally(() => setDetailLoading(false))
  }

  // Every filter change returns to page 1: staying on page 4 of a narrower result set shows an
  // empty table and reads as "no matches" when there genuinely are some.
  function applyFilter(apply: () => void) {
    apply()
    setPage(1)
    setLoading(true)
  }

  const lastPage = Math.max(1, Math.ceil(total / 50))

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-6">
      <div className="space-y-1">
        <Link href="/bot-control" className="text-sm text-brand hover:underline">
          &larr; Kembali ke Bot Control
        </Link>
        <h1 className="text-xl font-semibold text-navy">Decision Logs</h1>
        <p className="text-sm text-muted-foreground">
          Setiap putaran keputusan bot, termasuk yang tidak menghasilkan pesan sama sekali — agent mengambil alih di
          tengah jalan, atau orchestrator gagal.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onChange={(e) => applyFilter(() => setStatus(e.target.value))} className="w-auto" aria-label="Filter status">
          <option value="">Semua status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select value={mode} onChange={(e) => applyFilter(() => setMode(e.target.value))} className="w-auto" aria-label="Filter mode">
          <option value="">Semua mode</option>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
        <Input
          value={conversationId}
          onChange={(e) => applyFilter(() => setConversationId(e.target.value))}
          placeholder="ID percakapan"
          aria-label="Filter percakapan"
          className="w-52"
        />
        <Input type="date" value={dateFrom} onChange={(e) => applyFilter(() => setDateFrom(e.target.value))} aria-label="Dari tanggal" className="w-40" />
        <Input type="date" value={dateTo} onChange={(e) => applyFilter(() => setDateTo(e.target.value))} aria-label="Sampai tanggal" className="w-40" />
      </div>

      {loading && <p className="text-sm text-muted-foreground">Memuat...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && !error && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <Card className="p-0">
            {rows.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">Belum ada keputusan bot yang cocok dengan filter.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Waktu</TableHead>
                    <TableHead>Kontak</TableHead>
                    <TableHead>Pesan masuk</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Latensi</TableHead>
                    <TableHead className="text-right">Knowledge</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(row.startedAt).toLocaleString('id-ID')}
                      </TableCell>
                      <TableCell className="text-xs">
                        {/* A deleted conversation leaves the audit row alive but nameless. Saying
                            so beats an empty cell that looks like a rendering bug. */}
                        {row.contactName ?? row.contactPhone ?? <span className="text-muted-foreground">(kontak terhapus)</span>}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-xs">{row.inboundPreview}</TableCell>
                      <TableCell className="font-mono text-xs uppercase text-brand">{row.mode}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[row.status] ?? 'default'}>{row.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {row.latencyMs != null ? `${row.latencyMs} ms` : '—'}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{row.knowledgeRefsCount}</TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" onClick={() => openDetail(row.id)}>
                          Detail
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>

          <Card className="h-fit space-y-2 p-4">
            <p className="text-sm font-semibold text-navy">Detail keputusan</p>
            {detailLoading && <p className="text-sm text-muted-foreground">Memuat detail...</p>}
            {detailError && <p className="text-sm text-destructive">{detailError}</p>}
            {!detailLoading && !detailError && !selected && (
              <p className="text-sm text-muted-foreground">Pilih satu baris untuk melihat alasan lengkapnya.</p>
            )}
            {!detailLoading && !detailError && selected && <DecisionTracePanel run={selected} />}
          </Card>
        </div>
      )}

      {!loading && !error && total > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Sebelumnya
          </Button>
          <span>
            Halaman {page} dari {lastPage} · {total} keputusan
          </span>
          <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
            Berikutnya
          </Button>
        </div>
      )}
    </main>
  )
}
