'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import {
  KnowledgeSourceTable,
  type KnowledgeSourceRow,
  type KnowledgeAction,
} from '@/components/bot-control/KnowledgeSourceTable'
import { KnowledgeChunkPanel, type KnowledgeChunkRow } from '@/components/bot-control/KnowledgeChunkPanel'
import { KnowledgeEditor, type KnowledgeDraft } from '@/components/bot-control/KnowledgeEditor'
import { KnowledgeRevisionPanel, type RevisionRow } from '@/components/bot-control/KnowledgeRevisionPanel'
import type { KnowledgeItem } from '@/lib/bot-control/knowledge-body'
import { hasAdminPowers, roleNameCan } from '@/lib/bot-control/permissions'
import type { AccountRoleName } from '@/lib/auth/session'
import { fetchJson } from '@/lib/fetch-json'

type Paged<T> = { items: T[]; page: number; limit: number; total: number }
type SyncResult = { sourcesIndexed: number; chunksIndexed: number; errors: Array<{ sourcePath: string; message: string }> }
type SourceDetail = {
  id: string
  title: string
  summary: string | null
  managed: boolean
  latestRevision: {
    id: string
    version: number
    status: string
    title: string
    summary: string | null
    body: { items: KnowledgeItem[] } | null
    bodyUnreadable: boolean
  } | null
}

/** SDD Manage Second §8.2: a change with no stated reason answers nothing later. */
const MIN_REASON_LENGTH = 10

type Session = { role: AccountRoleName }

export default function KnowledgeExplorerPage() {
  const [sources, setSources] = useState<KnowledgeSourceRow[]>([])
  const [sourceQuery, setSourceQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [sourcesError, setSourcesError] = useState<string | null>(null)

  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [chunks, setChunks] = useState<KnowledgeChunkRow[]>([])
  const [chunkTotal, setChunkTotal] = useState(0)
  const [chunkQuery, setChunkQuery] = useState('')
  const [chunksLoading, setChunksLoading] = useState(false)
  const [chunksError, setChunksError] = useState<string | null>(null)

  const [role, setRole] = useState<Session['role'] | null>(null)
  const [syncing, setSyncing] = useState(false)

  // Managed-knowledge editing state. Kept beside the existing explorer state rather than in a
  // separate page: an operator finding a gap in the catalog is one click from writing the
  // answer, which is the whole reason this feature exists.
  const [editing, setEditing] = useState<{ sourceId: string | null; title: string; draft: KnowledgeDraft } | null>(null)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [historyFor, setHistoryFor] = useState<{ title: string; revisions: RevisionRow[] } | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)

  // Role decides whether the sync button renders at all. The API enforces it too — this only
  // avoids showing an AGENT a button whose every press would 403.
  useEffect(() => {
    fetchJson<Session>('/api/session').then((s) => setRole(s.role)).catch(() => {})
  }, [])

  const loadSources = useCallback(() => {
    const params = new URLSearchParams()
    if (sourceQuery.trim()) params.set('q', sourceQuery.trim())
    if (typeFilter) params.set('type', typeFilter)
    if (statusFilter) params.set('status', statusFilter)

    return fetchJson<Paged<KnowledgeSourceRow>>(`/api/bot-control/knowledge/sources?${params}`)
      .then((data) => {
        setSources(data.items)
        setSourcesError(null)
      })
      .catch((err: unknown) => setSourcesError(err instanceof Error ? err.message : 'Gagal memuat sumber knowledge'))
      .finally(() => setSourcesLoading(false))
  }, [sourceQuery, typeFilter, statusFilter])

  useEffect(() => {
    void loadSources()
  }, [loadSources])

  // Chunk state is reset and marked loading HERE, in the handlers, not inside the effect.
  // Calling setState synchronously in an effect body triggers cascading renders and is
  // rejected by react-hooks/set-state-in-effect; driving it from the interaction that
  // actually changed the filter is the idiomatic form and shows "Memuat..." at the same
  // moment either way.
  function resetChunks() {
    setChunks([])
    setChunkTotal(0)
    setChunksError(null)
    setChunksLoading(false)
  }

  function changeSelectedSource(id: string | null) {
    setSelectedSourceId(id)
    if (!id && !chunkQuery.trim()) resetChunks()
    else setChunksLoading(true)
  }

  function changeChunkQuery(next: string) {
    setChunkQuery(next)
    if (!selectedSourceId && !next.trim()) resetChunks()
    else setChunksLoading(true)
  }

  useEffect(() => {
    // No source picked and no search term means there is nothing specific to show yet; asking
    // the server for every chunk in the catalog to fill a panel nobody is reading is waste.
    if (!selectedSourceId && !chunkQuery.trim()) return

    let cancelled = false

    const params = new URLSearchParams()
    if (selectedSourceId) params.set('sourceId', selectedSourceId)
    if (chunkQuery.trim()) params.set('q', chunkQuery.trim())

    fetchJson<Paged<KnowledgeChunkRow>>(`/api/bot-control/knowledge/chunks?${params}`)
      .then((data) => {
        if (cancelled) return
        setChunks(data.items)
        setChunkTotal(data.total)
        setChunksError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setChunksError(err instanceof Error ? err.message : 'Gagal memuat isi knowledge')
      })
      .finally(() => {
        if (!cancelled) setChunksLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [selectedSourceId, chunkQuery])

  function openCreate() {
    setActionError(null)
    setEditing({ sourceId: null, title: 'Knowledge baru', draft: { title: '', summary: '', items: [] } })
  }

  async function openEditor(source: KnowledgeSourceRow) {
    setActionError(null)
    try {
      const detail = await fetchJson<SourceDetail>(`/api/bot-control/knowledge/sources/${source.id}`)
      if (detail.latestRevision?.bodyUnreadable) {
        // Opening the form on a body the server could not parse would silently drop whatever it
        // did not understand on the next save.
        setActionError('Isi revisi ini tidak bisa dibaca oleh versi aplikasi saat ini, jadi tidak bisa diedit di sini.')
        return
      }
      setEditing({
        sourceId: detail.id,
        title: detail.title,
        draft: {
          title: detail.latestRevision?.title ?? detail.title,
          summary: detail.latestRevision?.summary ?? detail.summary ?? '',
          items: detail.latestRevision?.body?.items ?? [],
        },
      })
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Gagal memuat isi knowledge')
    }
  }

  async function openHistory(source: KnowledgeSourceRow) {
    setHistoryFor({ title: source.title, revisions: [] })
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const data = await fetchJson<{ revisions: RevisionRow[] }>(
        `/api/bot-control/knowledge/sources/${source.id}/revisions`
      )
      setHistoryFor({ title: source.title, revisions: data.revisions })
    } catch (err: unknown) {
      setHistoryError(err instanceof Error ? err.message : 'Gagal memuat riwayat revisi')
    } finally {
      setHistoryLoading(false)
    }
  }

  async function saveDraft(draft: KnowledgeDraft, reason: string) {
    if (!editing || saving) return
    setSaving(true)
    setActionError(null)
    try {
      const payload = {
        title: draft.title.trim(),
        summary: draft.summary.trim() || undefined,
        body: { items: draft.items },
        reason,
      }
      if (editing.sourceId) {
        await fetchJson(`/api/bot-control/knowledge/sources/${editing.sourceId}/draft`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        await fetchJson('/api/bot-control/knowledge/sources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }
      setEditing(null)
      await loadSources()
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Gagal menyimpan draft knowledge')
    } finally {
      setSaving(false)
    }
  }

  async function runAction(source: KnowledgeSourceRow, action: Exclude<KnowledgeAction, 'edit' | 'history'>) {
    // Reject and archive both take something away, so both ask why before doing it.
    const body: { reason?: string } = {}
    if (action === 'reject' || action === 'archive') {
      const prompt = action === 'reject' ? 'Alasan menolak revisi ini?' : 'Alasan mengarsipkan knowledge ini?'
      const typed = window.prompt(`${prompt} (minimal ${MIN_REASON_LENGTH} karakter)`)?.trim()
      if (!typed || typed.length < MIN_REASON_LENGTH) return
      body.reason = typed
    }

    setActionError(null)
    try {
      await fetchJson(`/api/bot-control/knowledge/sources/${source.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      await loadSources()
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Gagal memproses permintaan')
    }
  }

  function handleAction(source: KnowledgeSourceRow, action: KnowledgeAction) {
    if (action === 'edit') return void openEditor(source)
    if (action === 'history') return void openHistory(source)
    void runAction(source, action)
  }

  async function runSync() {
    if (syncing) return
    setSyncing(true)
    setSyncMessage(null)
    setSyncError(null)
    try {
      const result = await fetchJson<SyncResult>('/api/bot-control/knowledge/sync', { method: 'POST' })
      setSyncMessage(`${result.sourcesIndexed} sumber, ${result.chunksIndexed} chunk ter-index.`)
      // Path AND reason, not a count and not a path alone. The two things that land here are a
      // file that would not parse and a whole run that refused to touch anything (a missing
      // catalog/ directory, see knowledge-indexer.ts) — and "1 file bermasalah: catalog" would
      // describe the second one as though one JSON file were broken.
      if (result.errors.length > 0) {
        setSyncError(result.errors.map((e) => `${e.sourcePath}: ${e.message}`).join(' • '))
      }
      await loadSources()
    } catch (err: unknown) {
      setSyncError(err instanceof Error ? err.message : 'Index knowledge gagal')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="space-y-1">
        <Link href="/bot-control" className="text-sm text-brand hover:underline">
          &larr; Kembali ke Bot Control
        </Link>
        <h1 className="text-xl font-semibold text-navy">Knowledge Explorer</h1>
        <p className="text-sm text-muted-foreground">
          Isi <span className="font-mono">catalog/</span> yang dipakai bot, dibuka supaya bisa dibaca dan dicari tanpa
          membuka JSON.
        </p>
        {/* Stated plainly, because guidebook §24 (Risiko 2) makes this the page's main hazard:
            an operator must not read the explorer as the bot's live memory. */}
        <p className="text-xs text-muted-foreground">
          Ini cerminan dari file di disk, bukan sumber jawaban bot. Bot tetap membaca file aslinya secara langsung.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={sourceQuery}
          onChange={(e) => setSourceQuery(e.target.value)}
          placeholder="Cari sumber..."
          aria-label="Cari sumber"
          className="w-56"
        />
        <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-auto" aria-label="Filter tipe">
          <option value="">Semua tipe</option>
          <option value="CATALOG_JSON">CATALOG_JSON</option>
          <option value="FAQ">FAQ</option>
          <option value="MANUAL">MANUAL</option>
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-auto" aria-label="Filter status">
          <option value="">Semua status</option>
          <option value="PUBLISHED">PUBLISHED</option>
          <option value="DRAFT">DRAFT</option>
          <option value="REVIEW">REVIEW</option>
          <option value="ARCHIVED">ARCHIVED</option>
        </Select>

        <div className="ml-auto flex gap-2">
          {roleNameCan(role, 'EDIT_KNOWLEDGE_DRAFT') && <Button onClick={openCreate}>Buat knowledge baru</Button>}
          {/* Re-indexing walks the filesystem and rewrites the catalog mirror; it is an admin
              operation on the deployment, not a Bot Control edit, so it keeps the admin gate. */}
          {hasAdminPowers(role) && (
            <Button variant="outline" onClick={runSync} disabled={syncing}>
              {syncing ? 'Meng-index...' : 'Index ulang katalog'}
            </Button>
          )}
        </div>
      </div>

      {syncMessage && <p className="text-sm text-emerald-700">{syncMessage}</p>}
      {syncError && <p className="text-sm text-destructive">{syncError}</p>}
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      <Card className="p-0">
        {sourcesLoading && <p className="p-3 text-sm text-muted-foreground">Memuat sumber...</p>}
        {sourcesError && <p className="p-3 text-sm text-destructive">{sourcesError}</p>}
        {!sourcesLoading && !sourcesError && (
          <KnowledgeSourceTable
            sources={sources}
            selectedId={selectedSourceId}
            onSelect={(id) => changeSelectedSource(id === selectedSourceId ? null : id)}
            canEdit={roleNameCan(role, 'EDIT_KNOWLEDGE_DRAFT')}
            canApprove={roleNameCan(role, 'APPROVE')}
            onAction={handleAction}
          />
        )}
      </Card>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-navy">Isi knowledge</h2>
          <Input
            value={chunkQuery}
            onChange={(e) => changeChunkQuery(e.target.value)}
            placeholder="Cari isi knowledge (mis. masker, ijen, harga)..."
            aria-label="Cari isi knowledge"
            className="w-80"
          />
          {selectedSourceId && (
            <Button variant="outline" size="sm" onClick={() => changeSelectedSource(null)}>
              Hapus filter sumber
            </Button>
          )}
        </div>

        {!selectedSourceId && !chunkQuery.trim() ? (
          <p className="text-sm text-muted-foreground">
            Pilih satu sumber di atas, atau ketik kata kunci, untuk melihat isinya.
          </p>
        ) : (
          <KnowledgeChunkPanel chunks={chunks} total={chunkTotal} loading={chunksLoading} error={chunksError} />
        )}
      </div>

      {editing && (
        <KnowledgeEditor
          initial={editing.draft}
          title={editing.title}
          saving={saving}
          error={actionError}
          onCancel={() => setEditing(null)}
          onSave={saveDraft}
        />
      )}

      {historyFor && (
        <KnowledgeRevisionPanel
          sourceTitle={historyFor.title}
          revisions={historyFor.revisions}
          loading={historyLoading}
          error={historyError}
          onClose={() => setHistoryFor(null)}
        />
      )}
    </main>
  )
}
