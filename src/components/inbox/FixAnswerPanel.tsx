'use client'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Textarea } from '@/components/ui/textarea'
import { KnowledgeEditor, type KnowledgeDraft } from '@/components/bot-control/KnowledgeEditor'
import { fetchJson } from '@/lib/fetch-json'
import { cn } from '@/lib/utils'
import type { BotDecision } from '@/lib/bot/types'
import type { KnowledgeItem } from '@/lib/bot-control/knowledge-body'
import { RESOLVER_TOPICS, type ResolverTopic } from '@/lib/bot/module-resolver'
import { MATCHER_STOPWORDS } from '@/lib/bot/matcher-stopwords'

type RunView = { id: string; conversationId: string; inboundText: string; replyText: string | null }
type GapView = {
  id: string
  reason: string
  topic: string
  messageText: string
  missingQuestion?: string | null
  answerSnippet?: string | null
  answerParagraph?: number | null
  createdAt: string
}
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
const KNOWLEDGE_GAP_LABEL: Record<string, string> = {
  no_facts_resolved: 'Tidak ada fakta knowledge untuk pertanyaan ini',
  verification_failed: 'Jawaban gagal diverifikasi terhadap knowledge',
  reply_unsourced: 'Ada jawaban yang tidak punya knowledge',
  reply_deferred_knowledge: 'Ada bagian jawaban yang belum punya knowledge',
}

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

function knowledgeGapLabel(reason: string): string {
  return KNOWLEDGE_GAP_LABEL[reason] ?? 'Ada gap knowledge pada jawaban ini'
}

function defaultTopicsFor(gap: GapView | null): ResolverTopic[] | undefined {
  if (!gap || !RESOLVER_TOPICS.includes(gap.topic as ResolverTopic)) return undefined
  return [gap.topic as ResolverTopic]
}

/**
 * Kata yang lolos filter pencocok tapi tidak menerangkan apa pun. Sengaja pendek dan konkret:
 * semuanya kata pembuka/pengisi yang muncul di pertanyaan pelanggan sungguhan, bukan daftar
 * stopword umum kedua (itu sudah ada di MATCHER_STOPWORDS).
 */
const FILLER_WORDS = new Set([
  'also', 'noticed', 'wondering', 'currently', 'actually', 'maybe', 'perhaps', 'around',
  'starts', 'start', 'tell', 'know', 'like', 'want', 'going', 'planning', 'standard',
])

function keywordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 4 && !MATCHER_STOPWORDS.has(word) && !FILLER_WORDS.has(word))
}

/**
 * Tag untuk entri baru.
 *
 * Tag BUKAN dekorasi: runtime-integration.ts mencocokkannya ke pesan PELANGGAN untuk memutuskan
 * entri mana yang boleh menjawab, jadi tag yang tidak pernah ditulis pelanggan adalah bahan
 * salah-cocok, bukan sekadar berisik. Dua aturan, keduanya lahir dari laporan 2026-09-14:
 *
 *   - `answerSnippet` tidak lagi menjadi sumber kata. Untuk gap `reply_deferred_knowledge`
 *     isinya SELALU kalimat stok bot ("let me check with our team ... get back to you shortly"),
 *     sehingga setiap entri baru selalu menerima tag `check`, `team`, `shortly`, `regarding`.
 *   - Kata yang muncul di pertanyaan pelanggan DAN di kalimat penundaan didahulukan. Kalimat
 *     penundaan menyebut ulang hal yang tidak bisa dijawab ("regarding the flexibility of the
 *     pickup time"), jadi irisan keduanya adalah pokok pertanyaannya -- bukan kalimat pembuka
 *     yang kebetulan berdiri paling depan.
 *
 * Topik TIDAK ikut jadi tag: ia sudah punya fieldnya sendiri (`topics`).
 */
function defaultTagsFor(gap: GapView | null, question: string): string[] | undefined {
  const asked = keywordsOf(gap?.missingQuestion?.trim() || question)
  if (asked.length === 0) return undefined
  const deferred = new Set(keywordsOf(gap?.answerSnippet ?? ''))
  const shared = asked.filter((word) => deferred.has(word))
  const tags = [...new Set([...shared, ...asked])].slice(0, 6)
  return tags.length > 0 ? tags : undefined
}

/**
 * Judul dipotong di batas kata. Sebelumnya `slice(0, 80)` memotong di tengah kata, dan judul itu
 * ikut tersimpan apa adanya kalau operator tidak mengubahnya.
 */
function titleFrom(question: string): string {
  const clean = question.replace(/\s+/g, ' ').trim()
  if (clean.length <= TITLE_MAX) return clean
  const cut = clean.slice(0, TITLE_MAX - 1)
  const lastSpace = cut.lastIndexOf(' ')
  const trimmed = (lastSpace > TITLE_MAX / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, '')
  return `${trimmed}…`
}

/**
 * Ringkasan memuat pertanyaan pelanggan UTUH -- justru karena judulnya dipotong. Sebelumnya ia
 * mengulang label internal gap ("Menjawab gap ada bagian jawaban yang belum punya knowledge:"),
 * kalimat yang tidak memberi tahu pembaca knowledge apa pun yang tidak sudah ada di judul.
 */
function defaultSummaryFor(gap: GapView | null, question: string): string {
  if (!gap) return ''
  const target = (gap.missingQuestion?.trim() || question).replace(/\s+/g, ' ').trim()
  return `Pertanyaan pelanggan: "${target}"`
}

function defaultReasonFor(gap: GapView | null): string | undefined {
  if (!gap) return undefined
  const paragraph = gap.answerParagraph !== null && gap.answerParagraph !== undefined
    ? ` paragraf ${gap.answerParagraph + 1}`
    : ''
  return `Menutup gap knowledge dari rekomendasi chatbot pada jawaban${paragraph}.`
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
  // Satu balasan bisa punya LEBIH DARI SATU gap -- satu per pertanyaan pelanggan yang ditunda
  // (lihat gap-signal.ts). Panel ini dulu memuat satu saja, jadi gap kedua tidak pernah bisa
  // dibuka maupun ditandai selesai meski barisnya ada di database.
  const [gaps, setGaps] = useState<GapView[]>([])
  // Berapa gap pada jawaban ini yang sudah ditutup dalam sesi panel ini -- tanpa angka ini,
  // menutup gap pertama dari dua terlihat seperti tidak terjadi apa-apa: kotaknya cuma berganti
  // isi, dan operator tidak punya tanda bahwa pekerjaannya maju.
  const [closedCount, setClosedCount] = useState(0)
  const [selectedGapId, setSelectedGapId] = useState<string | null>(null)
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
    fetchJson<{ items: GapView[] }>(`/api/inbox/gaps?messageId=${encodeURIComponent(messageId)}&limit=5`)
      .then((feed) => {
        if (cancelled) return
        // `?? []` bukan basa-basi: badan respons yang tidak berbentuk feed (mis. galat yang
        // terlanjur ber-status 200) dulu membuat `gaps` menjadi undefined, dan panel yang sudah
        // menampilkan perbaikan ikut jatuh saat merender -- kegagalan memuat lonceng tidak boleh
        // merusak halaman yang sedang dipakai operator.
        setGaps(feed.items ?? [])
        setSelectedGapId(feed.items?.[0]?.id ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [messageId])

  const gap = gaps.find((candidate) => candidate.id === selectedGapId) ?? gaps[0] ?? null

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
    if (gap) {
      try {
        await fetchJson(`/api/inbox/gaps/${encodeURIComponent(gap.id)}/resolve`, { method: 'POST' })
      } catch {
        // Ditelan: revisinya sudah aktif, dan gagal menandai gap hanya berarti ia masih muncul
        // di lonceng -- bukan alasan menampilkan kegagalan atas pekerjaan yang berhasil.
      }
    }
    setNotSuitable(false)

    // Gap yang baru ditutup dikeluarkan dari daftar. Selama masih ada sisanya, putaran ini
    // BELUM selesai: operator baru menjawab satu dari beberapa pertanyaan yang ditunda, dan
    // menutup panel di sini akan meninggalkan sisanya tanpa penanda apa pun bahwa ia ada.
    const remaining = gaps.filter((candidate) => candidate.id !== gap?.id)
    setGaps(remaining)
    if (gap) setClosedCount((count) => count + 1)
    if (remaining.length > 0) {
      setSelectedGapId(remaining[0].id)
      setResult(null)
      setRetest(null)
      setEditing(null)
      setNote('')
      return
    }
    setResolved(true)
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
    const question = gap?.missingQuestion?.trim() || inboundText
    const topics = defaultTopicsFor(gap)
    const tags = defaultTagsFor(gap, question)
    setSaveError(null)
    setEditing({
      kind: 'new',
      title: 'Tambah jawaban yang benar',
      initial: {
        title: titleFrom(question),
        summary: defaultSummaryFor(gap, question),
        items: [{ question: question.slice(0, QUESTION_MAX), answer: '', ...(tags ? { tags } : {}), ...(topics ? { topics } : {}) }],
      },
      reason: defaultReasonFor(gap),
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
          {gap && (
            <div className="space-y-1 rounded-md border border-warning/30 bg-warning-subtle px-3 py-2 text-warning">
              <p className="font-medium">Gap knowledge pada jawaban ini</p>
              {closedCount > 0 && (
                <p className="text-ink-muted">{`${closedCount} gap ditandai selesai, tersisa ${gaps.length}.`}</p>
              )}
              {gaps.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5 pb-1">
                  <span className="text-ink-muted">{`Gap ${gaps.indexOf(gap) + 1} dari ${gaps.length}`}</span>
                  {gaps.map((candidate, index) => (
                    <button
                      key={candidate.id}
                      type="button"
                      aria-pressed={candidate.id === gap.id}
                      onClick={() => setSelectedGapId(candidate.id)}
                      className={cn(
                        'focus-ring rounded-sm border px-1.5 py-0.5 text-xs font-medium',
                        candidate.id === gap.id
                          ? 'border-warning/40 bg-warning/15 text-warning'
                          : 'border-line bg-surface text-ink-muted hover:bg-surface-sunken'
                      )}
                    >
                      {`Gap ${index + 1}`}
                    </button>
                  ))}
                </div>
              )}
              <p>{knowledgeGapLabel(gap.reason)}</p>
              <p>{`Topik: ${gap.topic}`}</p>
              <div className="space-y-0.5 text-ink">
                <p className="font-medium">Pertanyaan yang perlu knowledge</p>
                <p className="whitespace-pre-wrap text-ink-muted">{gap.missingQuestion ?? gap.messageText}</p>
              </div>
              {gap.answerSnippet && (
                <div className="space-y-0.5 text-ink">
                  <p className="font-medium">Bagian jawaban yang belum bersumber</p>
                  <p className="whitespace-pre-wrap text-ink-muted">{gap.answerSnippet}</p>
                </div>
              )}
            </div>
          )}
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
