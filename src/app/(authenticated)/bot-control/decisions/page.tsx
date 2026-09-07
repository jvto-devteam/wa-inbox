'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/modal'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DecisionTracePanel, STATUS_VARIANT, type DecisionRunDetail } from '@/components/bot-control/DecisionTracePanel'
import { TriagePanel, TriageBadge, TRIAGE_ISSUE_LABEL, type TriageRow, type TriageDraft } from '@/components/bot-control/TriagePanel'
import { TRIAGE_ISSUE_TYPES, TRIAGE_STATUSES } from '@/lib/bot-control/triage-types'
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
type Session = { accountId?: string; role: 'ADMIN' | 'AGENT' }
type TriageListRow = TriageRow & { decisionRunId: string }

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

  // Triage state. Kept on this page rather than a separate one: the decision and the decision
  // ABOUT it are read together, and splitting them would mean copying a run id between tabs.
  const [role, setRole] = useState<Session['role'] | null>(null)
  const [currentUserId, setCurrentUserId] = useState('')
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([])
  const [triageByRun, setTriageByRun] = useState<Record<string, TriageRow>>({})
  const [triageStatus, setTriageStatus] = useState('')
  const [triageIssue, setTriageIssue] = useState('')
  const [editingTriage, setEditingTriage] = useState<{ runId: string; existing: TriageRow | null } | null>(null)
  const [triageSaving, setTriageSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const [testCaseFor, setTestCaseFor] = useState<DecisionRunDetail | null>(null)

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

  // The whole triage queue for the visible rows, in one request rather than one per row.
  useEffect(() => {
    fetchJson<Paged<TriageListRow>>('/api/bot-control/decisions/triage?limit=200')
      .then((data) => {
        const map: Record<string, TriageRow> = {}
        for (const row of data.items) map[row.decisionRunId] = row
        setTriageByRun(map)
      })
      .catch(() => {})
  }, [page, status, mode, conversationId, dateFrom, dateTo, triageStatus, triageIssue])

  useEffect(() => {
    fetchJson<Session>('/api/session')
      .then((s) => {
        setRole(s.role)
        setCurrentUserId(s.accountId ?? '')
      })
      .catch(() => {})
  }, [])

  // Only an admin can assign to somebody else, so only an admin needs the roster.
  useEffect(() => {
    if (role !== 'ADMIN') return
    fetchJson<{ id: string; name: string }[]>('/api/accounts')
      .then(setAccounts)
      .catch(() => {})
  }, [role])

  async function saveTriage(draft: TriageDraft) {
    if (!editingTriage || triageSaving) return
    setTriageSaving(true)
    setActionError(null)
    try {
      const saved = await fetchJson<TriageRow>(`/api/bot-control/decisions/${editingTriage.runId}/triage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: draft.status,
          // Empty select values are sent as null, not omitted: omitting means "leave as is",
          // and an operator clearing a field means to clear it.
          issueType: draft.issueType || null,
          severity: draft.severity,
          assignedTo: draft.assignedTo || null,
          note: draft.note.trim() || null,
          linkedEntityType: draft.linkedEntityType || null,
          linkedEntityId: draft.linkedEntityId.trim() || null,
        }),
      })
      setTriageByRun((prev) => ({ ...prev, [editingTriage.runId]: saved }))
      setEditingTriage(null)
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Gagal menyimpan tindak lanjut')
    } finally {
      setTriageSaving(false)
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

  // Triage filtering happens on the CLIENT because triage lives in its own table with no
  // foreign key to the decision (both are audit records that outlive what they describe), so
  // the decisions query cannot join on it. The page is capped at 50 rows, so this filters a
  // list that is already in memory rather than hiding matches beyond the page — the failure
  // mode that a server-side `.filter()` after `take` would produce.
  const visibleRows = rows.filter((row) => {
    const triage = triageByRun[row.id]
    if (triageStatus === 'NONE' && triage) return false
    if (triageStatus && triageStatus !== 'NONE' && triage?.status !== triageStatus) return false
    if (triageIssue && triage?.issueType !== triageIssue) return false
    return true
  })

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

        <Select
          value={triageStatus}
          onChange={(e) => applyFilter(() => setTriageStatus(e.target.value))}
          className="w-auto"
          aria-label="Filter tindak lanjut"
        >
          <option value="">Semua tindak lanjut</option>
          <option value="NONE">Belum ditindaklanjuti</option>
          {TRIAGE_STATUSES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
        <Select
          value={triageIssue}
          onChange={(e) => applyFilter(() => setTriageIssue(e.target.value))}
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
      </div>

      {actionError && <p className="text-sm text-destructive">{actionError}</p>}
      {actionNotice && <p className="text-sm text-emerald-700">{actionNotice}</p>}

      {loading && <p className="text-sm text-muted-foreground">Memuat...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && !error && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <Card className="p-0">
            {visibleRows.length === 0 ? (
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
                    <TableHead>Tindak lanjut</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row) => (
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
                        <TriageBadge triage={triageByRun[row.id] ?? null} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <Button variant="outline" size="sm" onClick={() => openDetail(row.id)}>
                            Detail
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingTriage({ runId: row.id, existing: triageByRun[row.id] ?? null })}
                          >
                            {triageByRun[row.id] ? 'Ubah tindak lanjut' : 'Tindak lanjuti'}
                          </Button>
                        </div>
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
            {!detailLoading && !detailError && selected && (
              <>
                <DecisionTracePanel run={selected} />

                {/* Turning a bad turn into a fix is the point of reading this page at all, so
                    both routes out of it sit on the decision itself rather than somewhere the
                    operator has to navigate to and retype the question from memory. */}
                <div className="flex flex-col gap-2 border-t pt-3">
                  <Button variant="outline" size="sm" onClick={() => createKnowledgeDraft(selected)}>
                    Buat knowledge draft dari keputusan ini
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setTestCaseFor(selected)}>
                    Simpan sebagai test case
                  </Button>
                </div>
              </>
            )}
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
      {editingTriage && (
        <TriagePanel
          existing={editingTriage.existing}
          currentUserId={currentUserId}
          accounts={accounts}
          canAssignOthers={role === 'ADMIN'}
          canClose={role === 'ADMIN'}
          saving={triageSaving}
          error={actionError}
          onCancel={() => setEditingTriage(null)}
          onSave={saveTriage}
        />
      )}

      {testCaseFor && (
        <DecisionTestCaseDialog
          run={testCaseFor}
          onClose={() => setTestCaseFor(null)}
          onSaved={() => {
            setTestCaseFor(null)
            setActionNotice('Kasus uji dibuat. Buka Test Lab untuk menjalankannya.')
          }}
          onError={setActionError}
        />
      )}
    </main>
  )
}

/**
 * Turns a decision into a test case.
 *
 * `expectedStatus` is seeded from what the bot ACTUALLY did and then handed to the operator to
 * change, because the decisions worth saving as tests are mostly the ones that went wrong —
 * saving the wrong outcome as the expectation would freeze the defect into the suite, where it
 * would pass forever while the bot stayed broken.
 */
function DecisionTestCaseDialog({
  run,
  onClose,
  onSaved,
  onError,
}: {
  run: DecisionRunDetail
  onClose: () => void
  onSaved: () => void
  onError: (message: string) => void
}) {
  const [name, setName] = useState(run.inboundText.slice(0, 120))
  const [category, setCategory] = useState('')
  const [expectedStatus, setExpectedStatus] = useState(statusToSimulation(run.status))
  const [expectedContains, setExpectedContains] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (saving || name.trim().length === 0) return
    setSaving(true)
    try {
      await fetchJson(`/api/bot-control/decisions/${run.id}/create-test-case`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          category: category.trim() || undefined,
          expectedStatus,
          expectedContains: expectedContains.trim() || undefined,
        }),
      })
      onSaved()
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Gagal membuat kasus uji')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} className="w-full max-w-lg space-y-3 p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-navy">Simpan sebagai test case</h2>
        <p className="text-xs text-muted-foreground">
          Ekspektasi diisi dari apa yang bot lakukan. Kalau justru itu yang salah, ubah dulu sebelum disimpan.
        </p>
      </div>

      <p className="rounded bg-muted/40 p-2 text-xs text-navy">{run.inboundText}</p>

      <label className="block space-y-1 text-sm">
        <span className="text-xs text-muted-foreground">Nama</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nama kasus uji" />
      </label>

      <label className="block space-y-1 text-sm">
        <span className="text-xs text-muted-foreground">Kategori (opsional)</span>
        <Input value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Kategori kasus uji" />
      </label>

      <label className="block space-y-1 text-sm">
        <span className="text-xs text-muted-foreground">Status yang diharapkan</span>
        <Select
          value={expectedStatus}
          onChange={(e) => setExpectedStatus(e.target.value)}
          aria-label="Status yang diharapkan"
        >
          {['WOULD_REPLY', 'WOULD_CLARIFY', 'WOULD_HANDOFF', 'FAILED'].map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
      </label>

      <label className="block space-y-1 text-sm">
        <span className="text-xs text-muted-foreground">Balasan harus memuat (opsional)</span>
        <Input
          value={expectedContains}
          onChange={(e) => setExpectedContains(e.target.value)}
          placeholder="Rp"
          aria-label="Balasan harus memuat"
        />
      </label>

      <div className="flex items-center gap-2">
        <Button type="button" onClick={save} disabled={saving || name.trim().length === 0}>
          {saving ? 'Menyimpan...' : 'Simpan kasus uji'}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          Batal
        </Button>
      </div>
    </Modal>
  )
}

/**
 * Maps a recorded decision status onto the simulator's vocabulary.
 *
 * They are different enums on purpose: `BotDecisionRun.status` describes what the bot DID
 * (including SKIPPED turns that never reached a decision), while `SimulationStatus` describes
 * what a dry run WOULD do. Anything without a counterpart seeds as WOULD_REPLY, which is the
 * expectation an operator is most likely to want and can change in the form.
 */
function statusToSimulation(status: string): string {
  switch (status) {
    case 'CLARIFIED':
      return 'WOULD_CLARIFY'
    case 'HANDOFF':
      return 'WOULD_HANDOFF'
    case 'FAILED':
      return 'FAILED'
    default:
      return 'WOULD_REPLY'
  }
}
