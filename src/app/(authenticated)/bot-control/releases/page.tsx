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

type Paged<T> = { items: T[]; page: number; limit: number; total: number }
type Preview = {
  changes: { rules: number; knowledge: number; flows: number; channelPolicy: number }
  requiresTestRun: boolean
  blockingIssues: string[]
}
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

  const [rollbackTarget, setRollbackTarget] = useState<ReleaseRow | null>(null)
  const [reason, setReason] = useState('')
  const [rollingBack, setRollingBack] = useState(false)

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

  async function publish() {
    if (publishing || title.trim().length === 0) return
    setPublishing(true)
    setActionError(null)
    try {
      await fetchJson('/api/bot-control/releases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description: description.trim() || undefined }),
      })
      setTitle('')
      setDescription('')
      setPreview(null)
      setPage(1)
      await load()
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
      await fetchJson(`/api/bot-control/releases/${rollbackTarget.id}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      setRollbackTarget(null)
      setReason('')
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
        {/* Said plainly, because a page that looks like a control panel but controls nothing yet
            is worse than one that admits it. */}
        <p className="text-xs text-muted-foreground">
          Fase ini baru fondasinya: snapshot masih kosong karena rule, knowledge, flow, dan channel policy yang bisa
          dipublish baru dibuat di fase berikutnya.
        </p>
      </div>

      {roleNameCan(role, 'PUBLISH') && (
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
                {preview.requiresTestRun ? 'Butuh test run sebelum publish.' : 'Belum ada gate test run di fase ini.'}
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
          {actionError && <p className="text-xs text-destructive">{actionError}</p>}
          <Button type="button" onClick={publish} disabled={publishing || title.trim().length === 0}>
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
