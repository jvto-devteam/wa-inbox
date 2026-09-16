'use client'
import { useState } from 'react'
import { Bot, Brain, ChevronDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { fetchJson } from '@/lib/fetch-json'
import { formatWhatsAppText } from '@/lib/whatsapp-format'
import { knowledgeGapLabel } from '@/lib/inbox/gap-labels'
import { BotTracePopover } from './BotTracePopover'
import type { MessageView } from './MessageBubble'
import type { BotDecision } from '@/lib/bot/types'
import type { MessageDraftView } from '@/lib/inbox/message-draft-view'

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
}

/**
 * Kartu draft jawaban bot (Task 5), dirender langsung di bawah gelembung pesan sumbernya di
 * MessageBubble. Satu draft per pesan masuk (lihat message-draft.ts): agen bisa membuat ulang,
 * mengedit, dan mengirimnya sebagai balasan yang mengutip pesan sumber -- tidak pernah otomatis.
 *
 * Sekali terkirim (`draft.sentAt` terisi) kartu ini terkunci: tanpa tombol aksi apa pun, sama
 * seperti sendDraft di server yang menolak permintaan lain atas draft yang sudah terkirim (409).
 */
export function MessageDraftCard({
  draft,
  conversationId,
  messageId,
  onDraftChange,
  onDraftSent,
}: {
  draft: MessageDraftView
  conversationId: string
  messageId: string
  onDraftChange?: (messageId: string, draft: MessageDraftView) => void
  onDraftSent?: (messageId: string, draft: MessageDraftView, sent: MessageView) => void
}) {
  const [showTrace, setShowTrace] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editMenuOpen, setEditMenuOpen] = useState(false)
  const [promptEditing, setPromptEditing] = useState(false)
  const [editText, setEditText] = useState(draft.text ?? '')
  const [revisionPrompt, setRevisionPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isSent = Boolean(draft.sentAt)
  const hasGaps = draft.knowledgeGaps.length > 0
  const draftUrl = `/api/conversations/${conversationId}/messages/${messageId}/draft`

  async function regenerate() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const updated = await fetchJson<MessageDraftView>(draftUrl, { method: 'POST' })
      onDraftChange?.(messageId, updated)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal membuat ulang draft')
    } finally {
      setBusy(false)
    }
  }

  function startEdit() {
    setEditText(draft.text ?? '')
    setError(null)
    setEditMenuOpen(false)
    setPromptEditing(false)
    setEditing(true)
  }

  function startPromptEdit() {
    setRevisionPrompt('')
    setError(null)
    setEditMenuOpen(false)
    setEditing(false)
    setPromptEditing(true)
  }

  async function saveEdit() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const updated = await fetchJson<MessageDraftView>(draftUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: editText }),
      })
      onDraftChange?.(messageId, updated)
      setEditing(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan draft')
    } finally {
      setBusy(false)
    }
  }

  async function savePromptEdit() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const updated = await fetchJson<MessageDraftView>(`${draftUrl}/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: revisionPrompt }),
      })
      onDraftChange?.(messageId, updated)
      setPromptEditing(false)
      setRevisionPrompt('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal merevisi draft')
    } finally {
      setBusy(false)
    }
  }

  async function send() {
    if (busy || editing || promptEditing || !draft.text?.trim()) return
    setBusy(true)
    setError(null)
    try {
      const result = await fetchJson<{ draft: MessageDraftView; message: MessageView }>(`${draftUrl}/send`, {
        method: 'POST',
      })
      onDraftSent?.(messageId, result.draft, result.message)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mengirim draft')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={cn(
        'w-full max-w-md space-y-2 rounded-lg border bg-surface px-3.5 py-2.5 text-sm text-ink',
        hasGaps && 'border-warning ring-1 ring-warning/30'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 font-medium text-ink">
          <Bot aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
          Draft jawaban bot
        </div>
        <IconButton
          size="sm"
          label={showTrace ? 'Sembunyikan alasan bot' : 'Lihat alasan bot'}
          icon={<Brain strokeWidth={1.75} />}
          aria-pressed={showTrace}
          onClick={() => setShowTrace((prev) => !prev)}
          className="-my-1 -mr-1"
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-muted">
        {isSent ? (
          <>
            <Badge variant="success">Terkirim ke pelanggan</Badge>
            {draft.sentAt && <span>{`oleh ${draft.sentByName ?? 'Agen'} · ${formatTime(draft.sentAt)}`}</span>}
          </>
        ) : draft.editedAt ? (
          <>
            <Badge variant="muted">Sudah diedit</Badge>
            {draft.editedByName && <span>{`oleh ${draft.editedByName}`}</span>}
          </>
        ) : (
          <Badge variant="muted">Belum terkirim</Badge>
        )}
      </div>

      {hasGaps && (
        <ul className="space-y-1 text-xs text-warning">
          {draft.knowledgeGaps.map((gap, i) => (
            <li key={i}>
              {knowledgeGapLabel(gap.reason)}
              {gap.missingQuestion && ` "${gap.missingQuestion}"`}
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <Textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          rows={3}
          aria-label="Edit draft"
          disabled={busy}
        />
      ) : promptEditing ? (
        <div className="space-y-2">
          {draft.text && <p className="whitespace-pre-wrap rounded-md bg-surface-sunken px-2.5 py-2">{formatWhatsAppText(draft.text)}</p>}
          <Textarea
            value={revisionPrompt}
            onChange={(e) => setRevisionPrompt(e.target.value)}
            rows={3}
            aria-label="Prompt revisi draft"
            placeholder="Contoh: buat lebih singkat, tambahkan bahwa pickup dari Surabaya tersedia, jangan sebut EUR."
            disabled={busy}
          />
        </div>
      ) : draft.text ? (
        <p className="whitespace-pre-wrap">{formatWhatsAppText(draft.text)}</p>
      ) : draft.mode === 'handoff' ? (
        <p className="text-ink-muted">
          {`Bot memilih menyerahkan ke agen: ${draft.handoffReason ?? ''}. Tulis jawabannya lewat Edit draft.`}
        </p>
      ) : null}

      {!isSent && (
        <div className="flex flex-wrap items-center gap-1.5">
          {editing ? (
            <>
              <Button type="button" size="sm" disabled={busy} onClick={() => void saveEdit()}>
                Simpan
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setEditing(false)}>
                Batal
              </Button>
            </>
          ) : promptEditing ? (
            <>
              <Button type="button" size="sm" disabled={busy || !revisionPrompt.trim()} onClick={() => void savePromptEdit()}>
                Revisi draft
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setPromptEditing(false)}>
                Batal
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void regenerate()}>
                Generate ulang
              </Button>
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  aria-haspopup="menu"
                  aria-expanded={editMenuOpen}
                  onClick={() => setEditMenuOpen((prev) => !prev)}
                >
                  Edit draft
                  <ChevronDown aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
                </Button>
                {editMenuOpen && (
                  <div
                    role="menu"
                    className="absolute left-0 top-full z-20 mt-1 min-w-40 rounded-md border border-line-strong bg-surface p-1 shadow-lg"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-surface-sunken"
                      onClick={startEdit}
                    >
                      Edit manual
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-surface-sunken"
                      onClick={startPromptEdit}
                    >
                      Edit dengan prompt
                    </button>
                  </div>
                )}
              </div>
              <Button
                type="button"
                size="sm"
                disabled={busy || !draft.text?.trim()}
                onClick={() => void send()}
              >
                Kirim pesan
              </Button>
            </>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}

      {showTrace && <BotTracePopover trace={draft.decision as BotDecision | null} onClose={() => setShowTrace(false)} />}
    </div>
  )
}
