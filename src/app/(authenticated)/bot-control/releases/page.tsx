'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { roleNameCan } from '@/lib/bot-control/permissions'
import type { AccountRoleName } from '@/lib/auth/session'
import { fetchJson } from '@/lib/fetch-json'

type ReleaseRow = {
  id: string
  version: number
  title: string
  description: string | null
  status: string
  publishedById: string | null
  publishedByName: string | null
  publishedAt: string
  rollbackOfId: string | null
  testRunId: string | null
  notes: string | null
  changes: { rules: number; knowledge: number; flows: number; channelPolicy: number } | null
  testSummary: { testRunId: string | null; status: string; total: number; passed: number; failed: number } | null
}

/** A run the operator may attach to a publish. Only PASSED runs are ever fetched. */
type TestRunRow = {
  id: string
  name: string | null
  scope: string
  status: string
  total: number
  passed: number
  failed: number
  finishedAt: string | null
}

type Paged<T> = { items: T[]; page: number; limit: number; total: number }
type Preview = {
  changes: { rules: number; knowledge: number; flows: number; channelPolicy: number }
  requiresTestRun: boolean
  blockingIssues: string[]
  /** Exactly what publishing would ship — what a pre-release run must be tested against. */
  candidate: { ruleDraftKeys: string[]; knowledgeRevisionIds: string[]; flowVersionIds: string[] }
}
/** An entity the rollback withdrew because it postdates the release being restored. */
type ArchivedEntity = { entityType: 'KNOWLEDGE' | 'FLOW'; key: string; version: number }

type Session = { role: AccountRoleName }

const STATUS_VARIANT: Record<string, 'success' | 'muted' | 'warning'> = {
  PUBLISHED: 'success',
  SUPERSEDED: 'muted',
  ROLLED_BACK: 'warning',
}

const STATUSES = ['PUBLISHED', 'SUPERSEDED', 'ROLLED_BACK']

/** SDD Manage Second §12: the reason is what makes a rollback readable months later. */
const MIN_REASON_LENGTH = 10

export default function ReleasesPage() {
  const [rows, setRows] = useState<ReleaseRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [role, setRole] = useState<Session['role'] | null>(null)

  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  // The test gate is server-side and refuses a publish that names no run (see assertTestGate).
  // The picker exists so the operator can satisfy it; without one the Publish button was a
  // button that could only ever return 409.
  const [testRuns, setTestRuns] = useState<TestRunRow[]>([])
  const [testRunId, setTestRunId] = useState('')
  const [testRunsError, setTestRunsError] = useState<string | null>(null)
  const [loadingTestRuns, setLoadingTestRuns] = useState(true)
  const [override, setOverride] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [runningTests, setRunningTests] = useState(false)

  const [rollbackTarget, setRollbackTarget] = useState<ReleaseRow | null>(null)
  const [reason, setReason] = useState('')
  const [rollingBack, setRollingBack] = useState(false)
  const [archived, setArchived] = useState<ArchivedEntity[] | null>(null)

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page) })
    if (status) params.set('status', status)

    return fetchJson<Paged<ReleaseRow>>(`/api/bot-control/releases?${params}`)
      .then((data) => {
        setRows(data.items)
        setTotal(data.total)
        setError(null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Gagal memuat daftar release'))
      .finally(() => setLoading(false))
  }, [page, status])

  useEffect(() => {
    void load()
  }, [load])

  // Role decides whether the publish and rollback controls render at all. The API enforces it
  // too; this only avoids showing an AGENT buttons whose every press would 403.
  useEffect(() => {
    fetchJson<Session>('/api/session')
      .then((s) => setRole(s.role))
      .catch(() => {})
  }, [])

  // Only PASSED runs are offered. A RUNNING or FAILED run would be refused by the gate anyway,
  // and listing it invites the operator to pick the one thing that cannot work.
  const loadTestRuns = useCallback(() => {
    return fetchJson<Paged<TestRunRow>>('/api/bot-control/test-runs?status=PASSED&limit=20')
      .then((data) => {
        setTestRuns(data.items)
        setTestRunsError(null)
      })
      .catch((err: unknown) =>
        setTestRunsError(err instanceof Error ? err.message : 'Gagal memuat daftar test run')
      )
      .finally(() => setLoadingTestRuns(false))
  }, [])

  const canPublish = roleNameCan(role, 'PUBLISH')
  const canOverride = roleNameCan(role, 'OVERRIDE_FAILED_TEST')

  useEffect(() => {
    if (canPublish) void loadTestRuns()
  }, [canPublish, loadTestRuns])

  // An override only counts when the role is allowed one AND a reason long enough to be useful
  // is present -- the same two conditions the server re-checks, so the button does not promise
  // something the API will refuse.
  const usingOverride = canOverride && override && overrideReason.trim().length >= MIN_REASON_LENGTH
  const publishReady = title.trim().length > 0 && (testRunId !== '' || usingOverride)

  function runPreview() {
    setPreviewError(null)
    setActionError(null)
    fetchJson<Preview>('/api/bot-control/releases/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then(setPreview)
      .catch((err: unknown) => setPreviewError(err instanceof Error ? err.message : 'Gagal membuat preview'))
  }

  /**
   * Runs the suite against the DRAFTS this publish would ship, then attaches the result.
   *
   * Without the candidate, the run exercises configuration that is already live and the gate in
   * front of publish proves nothing about what is being published — which was the finding.
   */
  async function runPreReleaseTests() {
    if (runningTests || !preview) return
    setRunningTests(true)
    setActionError(null)
    try {
      const suite = await fetchJson<{ items: Array<{ id: string }> }>(
        '/api/bot-control/test-cases?enabled=true&limit=50'
      )
      if (suite.items.length === 0) {
        setActionError('Belum ada kasus uji aktif — test run tidak akan memeriksa apa pun.')
        return
      }
      const run = await fetchJson<{ testRunId: string; status: string; failed: number; total: number }>(
        '/api/bot-control/test-runs',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scope: 'PRE_RELEASE',
            name: `Pra-release ${new Date().toLocaleString('id-ID')}`,
            testCaseIds: suite.items.map((item) => item.id),
            candidate: preview.candidate,
          }),
        }
      )
      await loadTestRuns()
      // Only a passing run is attached. A failed one is reported instead of silently selected,
      // because the gate would refuse it and the operator needs to know why.
      if (run.status === 'PASSED') setTestRunId(run.testRunId)
      else setActionError(`Test run gagal: ${run.failed} dari ${run.total} kasus. Perbaiki dulu sebelum publish.`)
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Gagal menjalankan test pra-release')
    } finally {
      setRunningTests(false)
    }
  }

  async function publish() {
    if (publishing || !publishReady) return
    setPublishing(true)
    setActionError(null)
    try {
      // testRunId is what the server's gate actually looks for. Sending the override instead is
      // the OWNER-only escape hatch, and it carries its reason so the audit row can be read
      // months later by someone asking why a release shipped on a red suite.
      await fetchJson('/api/bot-control/releases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          testRunId: testRunId || undefined,
          overrideFailedTest: usingOverride ? true : undefined,
          reason: usingOverride ? overrideReason.trim() : undefined,
        }),
      })
      setTitle('')
      setDescription('')
      setTestRunId('')
      setOverride(false)
      setOverrideReason('')
      setPreview(null)
      setPage(1)
      await Promise.all([load(), loadTestRuns()])
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Gagal mempublish release')
    } finally {
      setPublishing(false)
    }
  }

  async function confirmRollback() {
    if (!rollbackTarget || rollingBack || reason.trim().length < MIN_REASON_LENGTH) return
    setRollingBack(true)
    setActionError(null)
    try {
      const result = await fetchJson<{ archived: ArchivedEntity[] }>(
        `/api/bot-control/releases/${rollbackTarget.id}/rollback`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim() }),
        }
      )
      setRollbackTarget(null)
      setReason('')
      // Shown after the modal closes rather than inside it: this is the answer to "what did
      // that just take with it", and it must survive the dialog it came from.
      setArchived(result.archived ?? [])
      setPage(1)
      await load()
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Gagal melakukan rollback')
    } finally {
      setRollingBack(false)
    }
  }

  const lastPage = Math.max(1, Math.ceil(total / 50))

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="space-y-1">
        <Link href="/bot-control" className="text-sm text-brand hover:underline">
          &larr; Kembali ke Bot Control
        </Link>
        <h1 className="text-xl font-semibold text-navy">Releases</h1>
        <p className="text-sm text-muted-foreground">
          Setiap publish tersimpan sebagai snapshot lengkap, jadi &quot;kembalikan ke keadaan tanggal sekian&quot;
          bisa dijalankan, bukan cuma diharapkan.
        </p>
        <p className="text-xs text-muted-foreground">
          Publish membutuhkan test run yang lulus. Jalankan suite di{' '}
          <Link href="/bot-control/test-lab" className="text-brand hover:underline">
            Test Lab
          </Link>{' '}
          lebih dulu, lalu lampirkan hasilnya di bawah.
        </p>
      </div>

      {canPublish && (
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-navy">Publish release baru</h2>
            <Button type="button" variant="outline" size="sm" onClick={runPreview}>
              Preview perubahan
            </Button>
          </div>

          {previewError && <p className="text-xs text-destructive">{previewError}</p>}
          {preview && (
            <div className="space-y-1 rounded border bg-muted/30 p-2 text-xs">
              <p className="text-muted-foreground">
                Rules {preview.changes.rules} &middot; Knowledge {preview.changes.knowledge} &middot; Flows{' '}
                {preview.changes.flows} &middot; Channel policy {preview.changes.channelPolicy}
              </p>
              <p className="text-muted-foreground">
                {preview.requiresTestRun ? 'Butuh test run yang lulus sebelum publish.' : 'Tidak ada gate test run.'}
              </p>
              {preview.blockingIssues.length > 0 && (
                <ul className="list-inside list-disc text-destructive">
                  {preview.blockingIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Judul release, misal: Release Bot Control 2026-09-07"
            aria-label="Judul release"
          />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Deskripsi singkat (opsional)"
            aria-label="Deskripsi release"
            rows={2}
          />
          <div className="space-y-2 rounded border border-dashed p-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="test-run" className="text-xs font-semibold text-navy">
                Test run yang dilampirkan
              </label>
              <div className="flex items-center gap-2">
                {/* Offered only after a preview, because the candidate ids come from it. */}
                {preview && (
                  <Button type="button" size="sm" onClick={runPreReleaseTests} disabled={runningTests}>
                    {runningTests ? 'Menjalankan...' : 'Jalankan test pra-release'}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setLoadingTestRuns(true)
                    void loadTestRuns()
                  }}
                >
                  {loadingTestRuns ? 'Memuat...' : 'Muat ulang'}
                </Button>
              </div>
            </div>

            {testRunsError && <p className="text-xs text-destructive">{testRunsError}</p>}

            {loadingTestRuns ? (
              <p className="text-xs text-muted-foreground">Memuat daftar test run...</p>
            ) : testRuns.length === 0 && !testRunsError ? (
              <p className="text-xs text-muted-foreground">
                Belum ada test run yang lulus. Tekan &quot;Preview perubahan&quot; lalu &quot;Jalankan test
                pra-release&quot; untuk menguji justru yang akan diterbitkan, atau{' '}
                <Link href="/bot-control/test-lab" className="text-brand hover:underline">
                  jalankan suite di Test Lab
                </Link>{' '}
                lalu tekan Muat ulang.
              </p>
            ) : (
              <Select
                id="test-run"
                value={testRunId}
                onChange={(e) => setTestRunId(e.target.value)}
                aria-label="Test run yang dilampirkan"
              >
                <option value="">Pilih test run yang lulus...</option>
                {testRuns.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.name ?? run.id} &middot; {run.passed}/{run.total} lulus &middot;{' '}
                    {run.finishedAt ? new Date(run.finishedAt).toLocaleString('id-ID') : 'belum selesai'}
                  </option>
                ))}
              </Select>
            )}

            {/* OWNER-only, per the permission matrix. Rendering it for an ADMIN would offer an
                escape hatch the API refuses, which reads as a bug rather than as a policy. */}
            {canOverride && (
              <div className="space-y-2 border-t pt-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                  Publish tanpa test run yang lulus (khusus OWNER)
                </label>
                {override && (
                  <Textarea
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder={`Alasan override, minimal ${MIN_REASON_LENGTH} karakter`}
                    aria-label="Alasan override test"
                    rows={2}
                  />
                )}
              </div>
            )}
          </div>

          {actionError && <p className="text-xs text-destructive">{actionError}</p>}
          {/* Spelled out rather than left to a greyed-out button, so the operator knows WHICH of
              the two conditions is missing. */}
          {!publishReady && (
            <p className="text-xs text-muted-foreground">
              {title.trim().length === 0
                ? 'Isi judul release untuk melanjutkan.'
                : override
                  ? `Alasan override minimal ${MIN_REASON_LENGTH} karakter.`
                  : 'Pilih test run yang lulus untuk melanjutkan.'}
            </p>
          )}
          <Button type="button" onClick={publish} disabled={publishing || !publishReady}>
            {publishing ? 'Mempublish...' : 'Publish'}
          </Button>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(1)
            setLoading(true)
          }}
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
      </div>

      {archived !== null && (
        <Card className="space-y-1 border-amber-300 p-3">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-sm font-semibold text-navy">Rollback selesai</h2>
            <Button type="button" variant="outline" size="sm" onClick={() => setArchived(null)}>
              Tutup
            </Button>
          </div>
          {archived.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Tidak ada entity yang lebih baru, jadi tidak ada yang perlu diarsipkan.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {archived.length} entity diarsipkan karena dibuat setelah release yang dipulihkan:
              </p>
              <ul className="list-inside list-disc text-xs text-muted-foreground">
                {archived.map((entity) => (
                  <li key={`${entity.entityType}:${entity.key}:${entity.version}`}>
                    <span className="font-mono">{entity.key}</span> v{entity.version} ({entity.entityType})
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      {loading && <p className="text-sm text-muted-foreground">Memuat...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && !error && (
        <Card className="p-0">
          {rows.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Belum ada release.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">Versi</TableHead>
                  <TableHead>Judul</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Perubahan</TableHead>
                  <TableHead>Test</TableHead>
                  <TableHead>Dipublish oleh</TableHead>
                  <TableHead>Waktu</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-right font-mono text-xs tabular-nums">v{row.version}</TableCell>
                    <TableCell className="text-xs">
                      <span className="text-navy">{row.title}</span>
                      {row.rollbackOfId && (
                        <Badge variant="warning" className="ml-2">
                          rollback
                        </Badge>
                      )}
                      {row.description && <p className="text-muted-foreground">{row.description}</p>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[row.status] ?? 'default'}>{row.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {/* Null means this build cannot read the stored snapshot -- which is exactly
                          the release rollback would refuse, so it is worth saying out loud. */}
                      {row.changes
                        ? `R${row.changes.rules} K${row.changes.knowledge} F${row.changes.flows} C${row.changes.channelPolicy}`
                        : 'snapshot tidak terbaca'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.testSummary ? `${row.testSummary.passed}/${row.testSummary.total}` : '—'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.publishedByName ?? <span className="text-muted-foreground">(akun terhapus)</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(row.publishedAt).toLocaleString('id-ID')}
                    </TableCell>
                    <TableCell>
                      {/* Rolling back to what is already live changes nothing, so the button is
                          not offered for it -- the API refuses it too. */}
                      {roleNameCan(role, 'ROLLBACK') && row.status !== 'PUBLISHED' && (
                        <Button variant="outline" size="sm" onClick={() => setRollbackTarget(row)}>
                          Rollback
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
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

      {rollbackTarget && (
        <Modal
          onClose={() => {
            setRollbackTarget(null)
            setReason('')
          }}
          className="w-full max-w-lg space-y-3 p-4"
        >
          <h2 className="text-sm font-semibold text-navy">Rollback ke v{rollbackTarget.version}</h2>
          <p className="text-xs text-muted-foreground">
            Tidak ada data yang dihapus. Sistem membuat release baru berisi snapshot v{rollbackTarget.version}, dan
            release yang sekarang aktif ditandai <span className="font-mono">ROLLED_BACK</span>.
          </p>
          {/* Said before the button, not after: withdrawing entities the operator did not name
              is the surprising half of a rollback, and finding out afterwards is finding out
              from a customer. */}
          <p className="text-xs text-amber-900">
            Knowledge dan flow yang dipublish SETELAH v{rollbackTarget.version} akan ikut diarsipkan, supaya bot
            benar-benar kembali ke keadaan itu. Semuanya tercatat di audit log dan bisa diterbitkan lagi lewat
            publish biasa.
          </p>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Alasan rollback, minimal 10 karakter"
            aria-label="Alasan rollback"
            rows={3}
          />
          {actionError && <p className="text-xs text-destructive">{actionError}</p>}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={confirmRollback}
              disabled={rollingBack || reason.trim().length < MIN_REASON_LENGTH}
            >
              {rollingBack ? 'Memproses...' : 'Konfirmasi rollback'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setRollbackTarget(null)
                setReason('')
              }}
            >
              Batal
            </Button>
          </div>
        </Modal>
      )}
    </main>
  )
}
