'use client'
import { useCallback, useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import {
  KnowledgeSourceTable,
  type KnowledgeSourceRow,
  type KnowledgeAction,
} from '@/components/bot-control/KnowledgeSourceTable'
import { CatalogEntryPanel, type CatalogEntryRow } from '@/components/bot-control/CatalogEntryPanel'
import { KnowledgeEditor, type KnowledgeDraft } from '@/components/bot-control/KnowledgeEditor'
import { KnowledgeRevisionPanel, type RevisionRow } from '@/components/bot-control/KnowledgeRevisionPanel'
import type { KnowledgeItem } from '@/lib/bot-control/knowledge-body'
import { hasAdminPowers } from '@/lib/bot-control/permissions'
import type { AccountRoleName } from '@/lib/auth/session'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchJson } from '@/lib/fetch-json'
import { PageHeader } from '@/components/ui/page-header'

type Paged<T> = { items: T[]; page: number; limit: number; total: number }
type CatalogPage = Paged<CatalogEntryRow> & { syncedAt: string | null; topics: string[] }
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

/**
 * Two piles of knowledge, shown side by side and never merged.
 *
 * The catalog half is read straight from `catalog/*.json` on every request (see
 * src/lib/bot-control/catalog-explorer.ts). It used to be a database mirror kept in step by an
 * "Index ulang katalog" button; the bot never read that mirror, so the button existed only to
 * stop this page lying about files it was already free to open. It is gone, and with it the
 * possibility of the page and the bot disagreeing.
 *
 * The managed half is operator-written knowledge (`KnowledgeSource` rows of `type='MANUAL'`
 * with their revisions), which the bot DOES read from the database. Those are editable here;
 * the catalog is not — the way to change the catalog is to edit the file and deploy.
 */
export default function KnowledgeExplorerPage() {
  const [sources, setSources] = useState<KnowledgeSourceRow[]>([])
  const [sourceQuery, setSourceQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [sourcesError, setSourcesError] = useState<string | null>(null)

  const [entries, setEntries] = useState<CatalogEntryRow[]>([])
  const [entryTotal, setEntryTotal] = useState(0)
  const [topics, setTopics] = useState<string[]>([])
  const [syncedAt, setSyncedAt] = useState<string | null>(null)
  const [catalogQuery, setCatalogQuery] = useState('')
  const [topicFilter, setTopicFilter] = useState('')
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)

  const [role, setRole] = useState<Session['role'] | null>(null)

  // Managed-knowledge editing state. Kept beside the catalog view rather than on a separate
  // page: an operator finding a gap in the catalog is one click from writing the answer, which
  // is the whole reason this feature exists.
  const [editing, setEditing] = useState<{ sourceId: string | null; title: string; draft: KnowledgeDraft } | null>(null)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [historyFor, setHistoryFor] = useState<{ title: string; revisions: RevisionRow[] } | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

  // Role decides whether the write controls render at all. The API enforces it too — this only
  // avoids showing an AGENT a button whose every press would 403.
  useEffect(() => {
    fetchJson<Session>('/api/session').then((s) => setRole(s.role)).catch(() => {})
  }, [])

  const loadSources = useCallback(() => {
    const params = new URLSearchParams()
    if (sourceQuery.trim()) params.set('q', sourceQuery.trim())
    if (statusFilter) params.set('status', statusFilter)

    return fetchJson<Paged<KnowledgeSourceRow>>(`/api/bot-control/knowledge/sources?${params}`)
      .then((data) => {
        setSources(data.items)
        setSourcesError(null)
      })
      .catch((err: unknown) => setSourcesError(err instanceof Error ? err.message : 'Gagal memuat sumber knowledge'))
      .finally(() => setSourcesLoading(false))
  }, [sourceQuery, statusFilter])

  useEffect(() => {
    void loadSources()
  }, [loadSources])

  // "Memuat..." is flipped on HERE, in the handler that changed the filter, not inside the
  // effect below: calling setState synchronously in an effect body triggers cascading renders
  // and is rejected by react-hooks/set-state-in-effect. The user sees the same thing either way.
  function changeCatalogQuery(next: string) {
    setCatalogQuery(next)
    setCatalogLoading(true)
  }

  function changeTopicFilter(next: string) {
    setTopicFilter(next)
    setCatalogLoading(true)
  }

  // The catalog is loaded unconditionally, unlike the mirror it replaced: reading 22 JSON
  // files off a cached fingerprint costs nothing, and an explorer that shows an empty panel
  // until you type is an explorer nobody explores with.
  useEffect(() => {
    let cancelled = false

    const params = new URLSearchParams()
    if (catalogQuery.trim()) params.set('q', catalogQuery.trim())
    if (topicFilter) params.set('topic', topicFilter)

    fetchJson<CatalogPage>(`/api/bot-control/knowledge/catalog?${params}`)
      .then((data) => {
        if (cancelled) return
        setEntries(data.items)
        setEntryTotal(data.total)
        setTopics(data.topics)
        setSyncedAt(data.syncedAt)
        setCatalogError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setCatalogError(err instanceof Error ? err.message : 'Gagal memuat isi katalog')
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [catalogQuery, topicFilter])

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

  async function saveDraft(draft: KnowledgeDraft, reason: string, activate: boolean) {
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
      let sourceId = editing.sourceId
      if (sourceId) {
        await fetchJson(`/api/bot-control/knowledge/sources/${sourceId}/draft`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        // A brand-new source has no id until the server gives it one, and activating needs it.
        const created = await fetchJson<{ sourceId: string }>('/api/bot-control/knowledge/sources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        sourceId = created.sourceId
      }
      // Two calls rather than one endpoint that does both: the draft is saved either way, so a
      // failure to activate leaves the operator's text on disk instead of losing it.
      if (activate) {
        await fetchJson(`/api/bot-control/knowledge/sources/${sourceId}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
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
    // Archiving takes knowledge away from the bot, so it asks why before doing it.
    const body: { reason?: string } = {}
    if (action === 'archive') {
      const typed = window
        .prompt(`Alasan mengarsipkan knowledge ini? (minimal ${MIN_REASON_LENGTH} karakter)`)
        ?.trim()
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

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-6">
      <PageHeader
        title="Knowledge Explorer"
        description={
          <>
            Isi <span className="font-mono">catalog/</span> yang dipakai bot, dibuka supaya bisa dibaca dan dicari
            tanpa membuka JSON — plus knowledge yang ditulis operator sendiri.
          </>
        }
      />

      <section className="space-y-3 border-t border-line pt-5">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold text-ink">Isi katalog</h2>
          <p className="max-w-3xl text-sm text-ink-muted">
            Dibaca langsung dari file di <span className="font-mono">catalog/</span> setiap kali halaman ini dibuka —
            persis file yang dibaca bot. Tidak ada langkah sinkronisasi: mengubah filenya langsung terlihat di sini.
            {syncedAt && ` File terakhir disinkronkan dari agent-runtime: ${new Date(syncedAt).toLocaleString('id-ID')}.`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={catalogQuery}
            onChange={(e) => changeCatalogQuery(e.target.value)}
            placeholder="Cari isi katalog (mis. masker, ijen, harga)..."
            aria-label="Cari isi katalog"
            className="w-80"
          />
          <Select
            value={topicFilter}
            onChange={(e) => changeTopicFilter(e.target.value)}
            className="w-auto"
            aria-label="Filter topik katalog"
          >
            <option value="">Semua topik</option>
            {topics.map((topic) => (
              <option key={topic} value={topic}>
                {topic}
              </option>
            ))}
          </Select>
        </div>

        <CatalogEntryPanel entries={entries} total={entryTotal} loading={catalogLoading} error={catalogError} />
      </section>

      <section className="space-y-3 border-t border-line pt-5">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold text-ink">Knowledge terkelola</h2>
          <p className="max-w-3xl text-sm text-ink-muted">
            Jawaban yang ditulis operator dan dibaca bot berdampingan dengan katalog. Disimpan sebagai draft dulu; bot
            baru memakainya setelah diaktifkan.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={sourceQuery}
            onChange={(e) => setSourceQuery(e.target.value)}
            placeholder="Cari knowledge terkelola..."
            aria-label="Cari knowledge terkelola"
            className="w-56"
          />
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-auto"
            aria-label="Filter status"
          >
            <option value="">Semua status</option>
            <option value="PUBLISHED">PUBLISHED</option>
            <option value="DRAFT">DRAFT</option>
            <option value="ARCHIVED">ARCHIVED</option>
          </Select>

          <div className="ml-auto flex gap-2">
            {hasAdminPowers(role) && <Button onClick={openCreate}>Buat knowledge baru</Button>}
          </div>
        </div>

        {actionError && <p className="text-base text-danger">{actionError}</p>}
        {sourcesError && <p className="text-base text-danger">{sourcesError}</p>}

        {sourcesLoading && (
          <div aria-hidden="true">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex h-9 items-center gap-3 border-b border-line">
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-24" />
              </div>
            ))}
          </div>
        )}
        {!sourcesLoading && !sourcesError && (
          <KnowledgeSourceTable sources={sources} canEdit={hasAdminPowers(role)} onAction={handleAction} />
        )}
      </section>

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
