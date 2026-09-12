'use client'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Textarea } from '@/components/ui/textarea'
import { KnowledgeEditor, type KnowledgeDraft } from '@/components/bot-control/KnowledgeEditor'
import { fetchJson } from '@/lib/fetch-json'
import type { BotDecision } from '@/lib/bot/types'
import type { KnowledgeItem } from '@/lib/bot-control/knowledge-body'

type RunView = { id: string; conversationId: string; inboundText: string; replyText: string | null }
type LoadState =
  | { status: 'loading' }
  | { status: 'no-run' }
  | { status: 'error'; message: string }
  | { status: 'ready'; run: RunView }
type Editing =
  | { kind: 'edit'; sourceId: string; title: string; initial: KnowledgeDraft; reason?: string }
  | { kind: 'new'; title: string; initial: KnowledgeDraft; reason?: string }
type FixResult = { sourceId: string; title: string; version: number; flagged: boolean }
/**
 * Uji ulang sesudah revisi aktif. `sourcedByNewEntry` sengaja dibedakan dari `sourcedAtAll`:
 * jawaban yang terdengar benar tetapi bersandar pada entri LAIN berarti entri yang baru
 * disimpan tidak terpakai -- biasanya karena gerbang topik menolaknya -- dan operator harus
 * tahu itu alih-alih menutup gap dengan tenang.
 */
type Retest =
  | { status: 'running' }
  | { status: 'error'; message: string }
  | { status: 'done'; reply: string | null; sourcedByNewEntry: boolean; sourcedAtAll: boolean }

const MIN_NOTE_LENGTH = 10
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
  const [gapId, setGapId] = useState<string | null>(null)
  const [retest, setRetest] = useState<Retest | null>(null)
  const [notSuitable, setNotSuitable] = useState(false)
  const [note, setNote] = useState('')
  const [resolved, setResolved] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchJson<{ items: Array<{ id: string }> }>(`/api/bot-control/decisions?messageId=${encodeURIComponent(messageId)}&limit=1`)
      .then((list) => {
        const runId = list.items[0]?.id
        return runId ? fetchJson<RunView>(`/api/bot-control/decisions/${runId}`) : null
      })
      .then((run) => {
        if (cancelled) return
        setLoad(
          run
            ? {
                status: 'ready',
                run: { id: run.id, conversationId: run.conversationId, inboundText: run.inboundText, replyText: run.replyText },
              }
            : { status: 'no-run' }
        )
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoad({ status: 'error', message: error instanceof Error ? error.message : 'Gagal memuat keputusan bot' })
      })
    return () => {
      cancelled = true
    }
  }, [messageId])

  // Gap milik jawaban INI, supaya "sudah sesuai" bisa menutupnya. Tidak ada gap (panel dibuka
  // dari ikon di gelembung, bukan dari notifikasi) bukan kesalahan: perbaikannya tetap jalan,
  // hanya tidak ada yang perlu ditutup.
  useEffect(() => {
    let cancelled = false
    fetchJson<{ items: Array<{ id: string }> }>(`/api/inbox/gaps?messageId=${encodeURIComponent(messageId)}&limit=1`)
      .then((feed) => {
        if (!cancelled) setGapId(feed.items[0]?.id ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [messageId])

  async function runRetest(sourceId: string, run: RunView) {
    setRetest({ status: 'running' })
    try {
      const simulated = await fetchJson<{
        reply: string | null
        knowledge: { attributions?: Array<{ lines: Array<{ sourceId?: string }> }> } | null
      }>('/api/inbox/retest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: run.inboundText, conversationId: run.conversationId }),
      })
      const attributions = simulated.knowledge?.attributions ?? []
      setRetest({
        status: 'done',
        reply: simulated.reply,
        sourcedByNewEntry: attributions.some((attribution) => attribution.lines.some((line) => line.sourceId === sourceId)),
        sourcedAtAll: attributions.length > 0,
      })
    } catch (error: unknown) {
      setRetest({ status: 'error', message: error instanceof Error ? error.message : 'Gagal menjalankan uji ulang' })
    }
  }

  async function confirmSuitable() {
    if (gapId) {
      try {
        await fetchJson(`/api/inbox/gaps/${encodeURIComponent(gapId)}/resolve`, { method: 'POST' })
      } catch {
        // Ditelan: revisinya sudah aktif, dan gagal menandai gap hanya berarti ia masih muncul
        // di lonceng -- bukan alasan menampilkan kegagalan atas pekerjaan yang berhasil.
      }
    }
    setResolved(true)
    setNotSuitable(false)
  }

  async function openEdit(sourceId: string, initialReason?: string) {
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
        reason: initialReason,
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
      const saved = await fetchJson<{ sourceId: string; title: string; version: number; flagged: boolean }>(
        `/api/inbox/decisions/${load.run.id}/fix`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      )
      setResult({ sourceId: saved.sourceId, title: saved.title, version: saved.version, flagged: saved.flagged })
      setEditing(null)
      setNotSuitable(false)
      setNote('')
      // Uji ulang berjalan sendiri: menyimpan revisi bukan bukti jawabannya jadi benar, dan
      // satu klik lagi di sini hanya menunda pemeriksaan yang memang harus terjadi.
      void runRetest(saved.sourceId, load.run)
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
        initialReason={editing.reason}
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
        <div className="space-y-2 border-t border-line pt-2">
          <div role="status" className="space-y-0.5">
            <p className="font-medium text-ink">{`Aktif: ${result.title} v${result.version}`}</p>
            <p className="text-ink-muted">
              {result.flagged ? 'Jawaban bot ini ditandai perlu diperbaiki.' : 'Revisi sudah aktif, tetapi jawaban ini gagal ditandai.'}
            </p>
          </div>

          {retest?.status === 'running' && <p className="text-ink-muted">Menguji ulang jawaban bot...</p>}

          {retest?.status === 'error' && (
            <>
              <p role="alert" className="text-danger">
                {retest.message}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (load.status === 'ready') void runRetest(result.sourceId, load.run)
                }}
              >
                Coba uji ulang lagi
              </Button>
            </>
          )}

          {retest?.status === 'done' && (
            <>
              <div className="space-y-1">
                <p className="font-medium text-ink">Jawaban baru</p>
                <p className="whitespace-pre-wrap text-ink-muted">{retest.reply ?? '—'}</p>
                <p className="text-ink-muted">
                  {retest.sourcedByNewEntry
                    ? 'Bersumber dari entri yang baru disimpan.'
                    : retest.sourcedAtAll
                      ? 'Bersumber, tetapi dari entri lain — bukan yang baru disimpan.'
                      : 'Belum bersumber: tidak ada paragraf yang cocok dengan fakta mana pun.'}
                </p>
                {/* Dua batas yang harus diketahui sebelum hasilnya dipercaya. */}
                <p className="text-xs text-ink-subtle">
                  Uji ulang berjalan di percakapan sandbox tanpa data booking, dan meninggalkan satu baris keputusan
                  berstatus SIMULATED.
                </p>
              </div>

              {resolved ? (
                <p role="status" className="font-medium text-ink">
                  Gap ditandai selesai.
                </p>
              ) : notSuitable ? (
                <div className="space-y-1.5">
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    aria-label="Apa yang masih belum benar?"
                    placeholder="Apa yang masih belum benar? Kalimat ini menjadi alasan revisi berikutnya."
                    rows={2}
                  />
                  <Button
                    type="button"
                    disabled={note.trim().length < MIN_NOTE_LENGTH}
                    onClick={() => {
                      void openEdit(result.sourceId, note.trim())
                    }}
                  >
                    Perbaiki lagi
                  </Button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="font-medium text-ink">Jawaban ini sudah sesuai?</p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      onClick={() => {
                        void confirmSuitable()
                      }}
                    >
                      Sudah sesuai
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setNotSuitable(true)}>
                      Belum sesuai
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
