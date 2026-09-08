'use client'
import { useEffect, useState } from 'react'
import { ScrollText } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton, SkeletonText } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DecisionTracePanel, STATUS_VARIANT, type DecisionRunDetail } from '@/components/bot-control/DecisionTracePanel'
import { fetchJson } from '@/lib/fetch-json'
import { PageHeader } from '@/components/ui/page-header'

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
  /** Null when nobody has marked this decision as needing a fix. */
  flaggedAt: string | null
  flagNote: string | null
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

  // "Perlu diperbaiki" is two columns on the decision itself, so it travels with the row and
  // needs no second list. The filter is a query param, not a client-side `.filter()`.
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [flagSaving, setFlagSaving] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<string | null>(null)

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
    // Server-side, because a page holds 50 rows: filtering in the browser would hide every
    // flagged decision sitting on another page and report "none" with a straight face.
    if (flaggedOnly) params.set('flagged', 'true')

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
  }, [page, status, mode, conversationId, dateFrom, dateTo, flaggedOnly])

  /**
   * Marks a decision as needing a fix, or clears the mark.
   *
   * The row is patched in place rather than refetching the page: a refetch under an active
   * "hanya yang ditandai" filter would make the row the operator just unflagged vanish mid-click,
   * which reads as a lost click rather than as the filter doing its job.
   */
  async function toggleFlag(row: DecisionRow) {
    if (flagSaving) return
    const flagged = row.flaggedAt == null

    let note: string | null = null
    if (flagged) {
      const answer = window.prompt('Apa yang salah dengan keputusan ini? (boleh dikosongkan)', row.flagNote ?? '')
      // `null` means the operator pressed Cancel — that is "never mind", not "flag it blank".
      if (answer === null) return
      note = answer.trim() || null
    }

    setFlagSaving(row.id)
    setActionError(null)
    try {
      const saved = await fetchJson<{ flaggedAt: string | null; flagNote: string | null }>(
        `/api/bot-control/decisions/${row.id}/flag`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flagged, note }),
        }
      )
      setRows((prev) =>
        prev.map((item) =>
          item.id === row.id ? { ...item, flaggedAt: saved.flaggedAt, flagNote: saved.flagNote } : item
        )
      )
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Gagal menyimpan tanda')
    } finally {
      setFlagSaving('')
    }
  }

  async function createKnowledgeDraft(run: DecisionRunDetail) {
    const answer = window.prompt(
      `Jawaban yang seharusnya diberikan bot untuk:\n\n"${run.inboundText}"\n\n(Kosongkan untuk membatalkan.)`
    )?.trim()
    if (!answer) return

    const reason = window.prompt('Alasan membuat knowledge ini? (minimal 10 karakter)')?.trim()
    if (!reason || reason.length < 10) return

    setActionError(null)
    try {
      await fetchJson(`/api/bot-control/decisions/${run.id}/create-knowledge-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer, reason }),
      })
      setActionNotice('Draft knowledge dibuat. Buka halaman Knowledge untuk mengirimnya ke review.')
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Gagal membuat draft knowledge')
    }
  }

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
      <PageHeader
        title="Decision Logs"
        description="Setiap putaran keputusan bot, termasuk yang tidak menghasilkan pesan sama sekali — agent mengambil alih di tengah jalan, atau orchestrator gagal."
      />

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

        <Select
          value={flaggedOnly ? 'true' : ''}
          onChange={(e) => applyFilter(() => setFlaggedOnly(e.target.value === 'true'))}
          className="w-auto"
          aria-label="Filter tanda"
        >
          <option value="">Semua keputusan</option>
          <option value="true">Hanya yang ditandai</option>
        </Select>
      </div>

      {actionError && <p className="text-base text-danger">{actionError}</p>}
      {actionNotice && <p className="text-base text-success">{actionNotice}</p>}
      {error && <p className="text-base text-danger">{error}</p>}

      {loading && (
        <div aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="flex h-9 items-center gap-3 border-b border-line">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-2/5" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-14" />
            </div>
          ))}
        </div>
      )}

      {!loading && !error && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <div className="min-w-0">
            {rows.length === 0 ? (
              <EmptyState
                icon={<ScrollText strokeWidth={1.75} />}
                title="Belum ada keputusan bot yang cocok dengan filter."
                description="Setiap pesan masuk yang diproses bot menuliskan satu baris di sini. Kosong berarti belum ada yang cocok dengan filter di atas, bukan bahwa bot berhenti mencatat."
                className="border-t border-line"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-40">Waktu</TableHead>
                    <TableHead className="w-36">Kontak</TableHead>
                    <TableHead>Pesan masuk</TableHead>
                    <TableHead className="w-28">Mode</TableHead>
                    <TableHead className="w-24">Status</TableHead>
                    <TableHead className="w-20 text-right">Latensi</TableHead>
                    <TableHead className="w-20 text-right">Knowledge</TableHead>
                    <TableHead className="w-36">Tanda</TableHead>
                    <TableHead className="w-28">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id} className="h-auto align-top">
                      <TableCell className="py-2.5 text-sm whitespace-nowrap text-ink-muted">
                        <time dateTime={row.startedAt}>{new Date(row.startedAt).toLocaleString('id-ID')}</time>
                      </TableCell>
                      <TableCell className="py-2.5 text-sm text-ink">
                        {/* A deleted conversation leaves the audit row alive but nameless. Saying
                            so beats an empty cell that looks like a rendering bug. */}
                        {row.contactName ?? row.contactPhone ?? <span className="text-ink-subtle">(kontak terhapus)</span>}
                      </TableCell>
                      <TableCell className="max-w-xs truncate py-2.5 text-sm text-ink">{row.inboundPreview}</TableCell>
                      <TableCell className="py-2.5 font-mono text-xs text-ink-muted uppercase">{row.mode}</TableCell>
                      <TableCell className="py-2.5">
                        <Badge variant={STATUS_VARIANT[row.status] ?? 'default'}>{row.status}</Badge>
                      </TableCell>
                      <TableCell className="py-2.5 text-right font-mono text-xs text-ink-muted">
                        {row.latencyMs != null ? `${row.latencyMs} ms` : '—'}
                      </TableCell>
                      <TableCell className="py-2.5 text-right font-mono text-xs text-ink-muted">
                        {row.knowledgeRefsCount}
                      </TableCell>
                      <TableCell className="py-2.5">
                        {row.flaggedAt ? (
                          <span className="flex flex-col items-start gap-0.5">
                            <Badge variant="warning">Perlu diperbaiki</Badge>
                            {row.flagNote && <span className="text-xs text-ink-muted">{row.flagNote}</span>}
                          </span>
                        ) : (
                          <span className="text-sm text-ink-subtle">—</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="flex flex-col items-start gap-0.5">
                          <Button variant="ghost" size="sm" onClick={() => openDetail(row.id)}>
                            Detail
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={flagSaving === row.id}
                            onClick={() => toggleFlag(row)}
                          >
                            {row.flaggedAt ? 'Batalkan tanda' : 'Tandai perlu diperbaiki'}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-sm">Detail keputusan</CardTitle>
            </CardHeader>
            <div className="space-y-3 p-4">
              {detailLoading && <SkeletonText lines={5} />}
              {detailError && <p className="text-base text-danger">{detailError}</p>}
              {!detailLoading && !detailError && !selected && (
                <p className="text-base text-ink-muted">Pilih satu baris untuk melihat alasan lengkapnya.</p>
              )}
              {!detailLoading && !detailError && selected && (
                <>
                  <DecisionTracePanel run={selected} />

                  {/* Turning a bad turn into a fix is the point of reading this page at all, so
                      the route out of it sits on the decision itself rather than somewhere the
                      operator has to navigate to and retype the question from memory. */}
                  <div className="border-t border-line pt-3">
                    <Button variant="outline" size="sm" onClick={() => createKnowledgeDraft(selected)}>
                      Buat knowledge draft dari keputusan ini
                    </Button>
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>
      )}

      {!loading && !error && total > 0 && (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Sebelumnya
          </Button>
          <span className="tabular-nums">
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
