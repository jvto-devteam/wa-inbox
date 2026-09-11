'use client'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { KnowledgeEditor, type KnowledgeDraft } from '@/components/bot-control/KnowledgeEditor'
import { fetchJson } from '@/lib/fetch-json'
import type { BotDecision } from '@/lib/bot/types'
import type { KnowledgeItem } from '@/lib/bot-control/knowledge-body'

type RunView = { id: string; inboundText: string; replyText: string | null }
type LoadState =
  | { status: 'loading' }
  | { status: 'no-run' }
  | { status: 'error'; message: string }
  | { status: 'ready'; run: RunView }
type Editing =
  | { kind: 'edit'; sourceId: string; title: string; initial: KnowledgeDraft }
  | { kind: 'new'; title: string; initial: KnowledgeDraft }
type FixResult = { title: string; version: number; flagged: boolean }
type UsedSource = { key: string; label: string; sourceId?: string }

/** Batas knowledgeItemSchema (question) dan judul yang wajar untuk entri baru. */
const QUESTION_MAX = 1000
const TITLE_MAX = 80

/** Satu entri per sumber; baris lama tanpa sourceId tetap tampil, tanpa tombol Edit. */
function usedSources(trace: BotDecision | null): UsedSource[] {
  const seen = new Map<string, UsedSource>()
  for (const line of trace?.knowledge?.managedLines ?? []) {
    const key = line.sourceId ?? line.source
    if (!seen.has(key)) seen.set(key, { key, label: line.source, ...(line.sourceId ? { sourceId: line.sourceId } : {}) })
  }
  return [...seen.values()]
}

/**
 * Perbaiki jawaban bot dari bubble-nya: edit entri knowledge yang dipakai, atau tambah jawaban
 * yang benar. Menyimpan = langsung aktif (POST /api/inbox/decisions/[id]/fix), tanpa AI.
 */
export function FixAnswerPanel({
  messageId,
  trace,
  replyText,
  onClose,
}: {
  messageId: string
  trace: BotDecision | null
  replyText: string | null
  onClose: () => void
}) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [editing, setEditing] = useState<Editing | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [result, setResult] = useState<FixResult | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchJson<{ items: Array<{ id: string }> }>(`/api/bot-control/decisions?messageId=${encodeURIComponent(messageId)}&limit=1`)
      .then((list) => {
        const runId = list.items[0]?.id
        return runId ? fetchJson<RunView>(`/api/bot-control/decisions/${runId}`) : null
      })
      .then((run) => {
        if (cancelled) return
        setLoad(run ? { status: 'ready', run: { id: run.id, inboundText: run.inboundText, replyText: run.replyText } } : { status: 'no-run' })
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoad({ status: 'error', message: error instanceof Error ? error.message : 'Gagal memuat keputusan bot' })
      })
    return () => {
      cancelled = true
    }
  }, [messageId])

  async function openEdit(sourceId: string) {
    setOpening(sourceId)
    setOpenError(null)
    try {
      const data = await fetchJson<{ title: string; summary: string | null; items: KnowledgeItem[]; version: number }>(
        `/api/inbox/knowledge/${encodeURIComponent(sourceId)}`
      )
      setSaveError(null)
      setEditing({
        kind: 'edit',
        sourceId,
        title: `Perbaiki: ${data.title} (v${data.version} aktif)`,
        initial: { title: data.title, summary: data.summary ?? '', items: data.items },
      })
    } catch (error: unknown) {
      setOpenError(error instanceof Error ? error.message : 'Gagal membuka entri knowledge')
    } finally {
      setOpening(null)
    }
  }

  function openNew(inboundText: string) {
    setSaveError(null)
    setEditing({
      kind: 'new',
      title: 'Tambah jawaban yang benar',
      initial: { title: inboundText.slice(0, TITLE_MAX), summary: '', items: [{ question: inboundText.slice(0, QUESTION_MAX), answer: '' }] },
    })
  }

  async function save(draft: KnowledgeDraft, reason: string) {
    if (!editing || load.status !== 'ready') return
    setSaving(true)
    setSaveError(null)
    const content = { title: draft.title.trim(), summary: draft.summary.trim() || undefined, items: draft.items, reason }
    const body = editing.kind === 'edit' ? { kind: 'edit', sourceId: editing.sourceId, ...content } : { kind: 'new', ...content }
    try {
      const saved = await fetchJson<{ title: string; version: number; flagged: boolean }>(`/api/inbox/decisions/${load.run.id}/fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setResult({ title: saved.title, version: saved.version, flagged: saved.flagged })
      setEditing(null)
    } catch (error: unknown) {
      setSaveError(error instanceof Error ? error.message : 'Gagal menyimpan perbaikan')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <KnowledgeEditor
        initial={editing.initial}
        title={editing.title}
        saving={saving}
        error={saveError}
        activateOnly
        onCancel={() => {
          setEditing(null)
          setSaveError(null)
        }}
        onSave={(draft, reason) => {
          void save(draft, reason)
        }}
      />
    )
  }

  const sources = usedSources(trace)

  return (
    <Modal onClose={onClose} className="max-w-md space-y-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">Perbaiki jawaban bot</h2>
        <IconButton size="sm" label="Tutup" icon={<X strokeWidth={2} />} onClick={onClose} className="-mt-1 -mr-1" />
      </div>

      {load.status === 'loading' && <p className="text-ink-muted">Memuat keputusan bot...</p>}
      {load.status === 'no-run' && (
        <p className="text-ink-muted">Keputusan bot untuk pesan ini tidak tercatat, jadi tidak bisa diperbaiki dari sini.</p>
      )}
      {load.status === 'error' && (
        <p role="alert" className="text-danger">
          {load.message}
        </p>
      )}

      {load.status === 'ready' && (
        <>
          <div className="space-y-1">
            <p className="font-medium text-ink">Pertanyaan pelanggan</p>
            <p className="whitespace-pre-wrap text-ink-muted">{load.run.inboundText}</p>
          </div>
          <div className="space-y-1">
            <p className="font-medium text-ink">Jawaban bot</p>
            <p className="whitespace-pre-wrap text-ink-muted">{load.run.replyText ?? replyText ?? '—'}</p>
          </div>
          <div className="space-y-1.5 border-t border-line pt-2">
            <p className="font-medium text-ink">Knowledge yang dipakai</p>
            {sources.length === 0 ? (
              <p className="text-ink-muted">Jawaban ini tidak memakai knowledge terkelola.</p>
            ) : (
              <ul className="space-y-1">
                {sources.map(({ key, label, sourceId }) => (
                  <li key={key} className="flex items-center justify-between gap-2">
                    <span className="text-ink-muted">{label}</span>
                    {sourceId && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={opening !== null}
                        onClick={() => {
                          void openEdit(sourceId)
                        }}
                      >
                        {opening === sourceId ? 'Membuka...' : 'Edit'}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {openError && (
              <p role="alert" className="text-danger">
                {openError}
              </p>
            )}
          </div>
          <Button type="button" onClick={() => openNew(load.run.inboundText)}>
            Tambah jawaban yang benar
          </Button>
        </>
      )}

      {result && (
        <div role="status" className="space-y-0.5 border-t border-line pt-2">
          <p className="font-medium text-ink">{`Aktif: ${result.title} v${result.version}`}</p>
          <p className="text-ink-muted">
            {result.flagged ? 'Jawaban bot ini ditandai perlu diperbaiki.' : 'Revisi sudah aktif, tetapi jawaban ini gagal ditandai.'}
          </p>
        </div>
      )}
    </Modal>
  )
}
