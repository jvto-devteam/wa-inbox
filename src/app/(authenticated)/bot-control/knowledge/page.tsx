'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { KnowledgeSourceTable, type KnowledgeSourceRow } from '@/components/bot-control/KnowledgeSourceTable'
import { KnowledgeChunkPanel, type KnowledgeChunkRow } from '@/components/bot-control/KnowledgeChunkPanel'
import { fetchJson } from '@/lib/fetch-json'

type Paged<T> = { items: T[]; page: number; limit: number; total: number }
type SyncResult = { sourcesIndexed: number; chunksIndexed: number; errors: Array<{ sourcePath: string; message: string }> }

type Session = { role: 'ADMIN' | 'AGENT' }

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

  async function runSync() {
    if (syncing) return
    setSyncing(true)
    setSyncMessage(null)
    setSyncError(null)
    try {
      const result = await fetchJson<SyncResult>('/api/bot-control/knowledge/sync', { method: 'POST' })
      setSyncMessage(`${result.sourcesIndexed} sumber, ${result.chunksIndexed} chunk ter-index.`)
      // Files that failed to parse are surfaced by name. A count alone would leave an operator
      // unable to act on it.
      if (result.errors.length > 0) {
        setSyncError(`${result.errors.length} file bermasalah: ${result.errors.map((e) => e.sourcePath).join(', ')}`)
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

        {role === 'ADMIN' && (
          <Button onClick={runSync} disabled={syncing} className="ml-auto">
            {syncing ? 'Meng-index...' : 'Index ulang katalog'}
          </Button>
        )}
      </div>

      {syncMessage && <p className="text-sm text-emerald-700">{syncMessage}</p>}
      {syncError && <p className="text-sm text-destructive">{syncError}</p>}

      <Card className="p-0">
        {sourcesLoading && <p className="p-3 text-sm text-muted-foreground">Memuat sumber...</p>}
        {sourcesError && <p className="p-3 text-sm text-destructive">{sourcesError}</p>}
        {!sourcesLoading && !sourcesError && (
          <KnowledgeSourceTable
            sources={sources}
            selectedId={selectedSourceId}
            onSelect={(id) => changeSelectedSource(id === selectedSourceId ? null : id)}
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
    </main>
  )
}
