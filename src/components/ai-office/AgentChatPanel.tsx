'use client'
import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Play, Send, X } from 'lucide-react'
import type { AiAgentKey } from '@/lib/ai-office/activity'
import {
  AGENT_SUGGESTIONS,
  CHAT_MAX_CHARS,
  CHAT_MAX_MESSAGES,
  type AgentActionResponse,
  type AgentChatResponse,
  type AgentProposal,
} from '@/lib/ai-office/chat-types'
import { conversationHref } from '@/components/daily-summary/conversation-href'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { fetchJson } from '@/lib/fetch-json'
import { cn } from '@/lib/utils'

/**
 * Obrolan dengan satu asisten Kantor AI (owner 2026-10-23: "masing-masing agent bisa aku tanyakan dan perintah lewat
 * chat"). Pertanyaan dijawab dari data nyata lewat alat baca di server; perintah yang mengubah sesuatu datang sebagai
 * USULAN dan baru dijalankan saat operator menekan "Jalankan".
 */

export type PanelMessage =
  | { id: number; role: 'user'; content: string }
  | { id: number; role: 'assistant'; content: string; used?: string[]; proposal?: AgentProposal | null; proposalState?: 'open' | 'running' | 'done' | 'failed' }
  | { id: number; role: 'result'; content: string; ok: boolean; conversationId?: string | null }

export type PanelAgent = { key: AiAgentKey; name: string; role: string; shirt: string }

let nextId = 0
const newId = () => ++nextId

export function AgentChatPanel({
  agent,
  messages,
  setMessages,
  onClose,
}: {
  agent: PanelAgent
  messages: PanelMessage[]
  setMessages: (update: (prev: PanelMessage[]) => PanelMessage[]) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [agent.key])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy])

  async function send(text: string) {
    const content = text.trim().slice(0, CHAT_MAX_CHARS)
    if (!content || busy) return
    const userMsg: PanelMessage = { id: newId(), role: 'user', content }
    const history = [...messages, userMsg]
      .filter((m): m is Extract<PanelMessage, { role: 'user' | 'assistant' }> => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }))
      .slice(-CHAT_MAX_MESSAGES)
    setMessages((prev) => [...prev, userMsg])
    setDraft('')
    setBusy(true)
    try {
      const res = await fetchJson<AgentChatResponse>('/api/ai-office/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agent.key, messages: history }),
      })
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: 'assistant', content: res.reply, used: res.used, proposal: res.proposal, proposalState: res.proposal ? 'open' : undefined },
      ])
    } catch (e) {
      setMessages((prev) => [...prev, { id: newId(), role: 'result', ok: false, content: e instanceof Error ? e.message : 'Gagal menghubungi asisten' }])
    } finally {
      setBusy(false)
    }
  }

  async function run(msgId: number, proposal: AgentProposal) {
    setMessages((prev) => prev.map((m) => (m.id === msgId && m.role === 'assistant' ? { ...m, proposalState: 'running' } : m)))
    try {
      const res = await fetchJson<AgentActionResponse>('/api/ai-office/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agent.key, action: proposal.action, args: proposal.args }),
      })
      setMessages((prev) => [
        ...prev.map((m) => (m.id === msgId && m.role === 'assistant' ? { ...m, proposalState: 'done' as const } : m)),
        { id: newId(), role: 'result', ok: true, content: res.result, conversationId: res.conversationId ?? null },
      ])
    } catch (e) {
      setMessages((prev) => [
        ...prev.map((m) => (m.id === msgId && m.role === 'assistant' ? { ...m, proposalState: 'failed' as const } : m)),
        { id: newId(), role: 'result', ok: false, content: e instanceof Error ? e.message : 'Tindakan gagal' },
      ])
    }
  }

  function cancel(msgId: number) {
    setMessages((prev) => prev.map((m) => (m.id === msgId && m.role === 'assistant' ? { ...m, proposalState: 'failed' as const, proposal: m.proposal } : m)))
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void send(draft)
  }

  return (
    <section aria-label={`Obrolan dengan ${agent.name}`} className="flex h-full min-h-0 flex-col rounded-xl border border-line bg-surface">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="grid size-8 place-items-center rounded-full text-xs font-semibold text-white" style={{ background: agent.shirt }} aria-hidden>
          {agent.name.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{agent.name}</p>
          <p className="truncate text-xs text-ink-muted">{agent.role}</p>
        </div>
        <IconButton label="Tutup obrolan" icon={<X className="size-4" />} onClick={onClose} />
      </header>

      <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3" aria-live="polite">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-ink-muted">Tanya atau beri perintah ke {agent.name}. Perintah yang mengubah data selalu minta konfirmasi dulu.</p>
            <div className="flex flex-wrap gap-1.5">
              {AGENT_SUGGESTIONS[agent.key].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="focus-ring rounded-full border border-line px-2.5 py-1 text-left text-xs text-ink hover:bg-surface-sunken"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => {
          if (m.role === 'user') {
            return (
              <p key={m.id} className="ml-8 rounded-lg bg-accent px-3 py-2 text-sm whitespace-pre-wrap text-white">
                {m.content}
              </p>
            )
          }
          if (m.role === 'result') {
            return (
              <div key={m.id} className={cn('rounded-lg border px-3 py-2 text-sm', m.ok ? 'border-success/40 bg-success-subtle text-ink' : 'border-danger/40 bg-danger-subtle text-danger')}>
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.conversationId && (
                  <Link href={conversationHref(m.conversationId, null)} className="focus-ring mt-1 inline-block rounded-sm text-xs text-accent underline-offset-2 hover:underline">
                    Lihat chat
                  </Link>
                )}
              </div>
            )
          }
          return (
            <div key={m.id} className="mr-6 space-y-1.5">
              <p className="rounded-lg bg-surface-sunken px-3 py-2 text-sm whitespace-pre-wrap text-ink">{m.content}</p>
              {m.used && m.used.length > 0 && <p className="text-[11px] text-ink-subtle">Data: {m.used.join(' · ')}</p>}
              {m.proposal && (
                <div className="rounded-lg border border-warning/50 bg-warning-subtle px-3 py-2 text-sm">
                  <p className="font-medium text-ink">Usulan: {m.proposal.summary}</p>
                  {m.proposalState === 'open' && (
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" onClick={() => void run(m.id, m.proposal as AgentProposal)}>
                        <Play className="size-3.5" aria-hidden /> Jalankan
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => cancel(m.id)}>
                        Batal
                      </Button>
                    </div>
                  )}
                  {m.proposalState === 'running' && <p className="mt-1 text-xs text-ink-muted">Menjalankan…</p>}
                  {m.proposalState === 'done' && <p className="mt-1 text-xs text-success">Sudah dijalankan</p>}
                  {m.proposalState === 'failed' && <p className="mt-1 text-xs text-ink-muted">Tidak dijalankan</p>}
                </div>
              )}
            </div>
          )
        })}
        {busy && <p className="text-xs text-ink-muted">{agent.name} sedang memeriksa…</p>}
      </div>

      <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-line p-2">
        <label htmlFor={`agent-chat-${agent.key}`} className="sr-only">
          Pesan untuk {agent.name}
        </label>
        <textarea
          id={`agent-chat-${agent.key}`}
          ref={inputRef}
          value={draft}
          maxLength={CHAT_MAX_CHARS}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send(draft)
            }
          }}
          placeholder={`Tanya atau perintah ${agent.name}…`}
          className="focus-ring min-h-9 flex-1 resize-none rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-subtle"
        />
        <IconButton type="submit" variant="default" label="Kirim" icon={<Send className="size-4" />} disabled={busy || !draft.trim()} />
      </form>
    </section>
  )
}
