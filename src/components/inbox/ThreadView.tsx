'use client'
import { useEffect, useState } from 'react'
import { MessageBubble, type MessageView } from './MessageBubble'
import { ComposeBox } from './ComposeBox'
import { Select } from '@/components/ui/select'
import { ContactAvatar } from '@/components/ContactAvatar'
import { fetchJson } from '@/lib/fetch-json'

type Agent = { id: string; name: string }
type ConversationDetail = {
  botEnabled: boolean
  assignedAgentId?: string | null
  lastReadAt?: string | null
  contactName?: string | null
  avatarUrl?: string | null
}

/** Fire-and-forget: a failed mark-as-read is a cosmetic sidebar-badge staleness, never worth surfacing. */
function markAsRead(conversationId: string) {
  fetch(`/api/conversations/${conversationId}/read`, { method: 'PATCH' }).catch(() => {})
}

export function ThreadView({ conversationId }: { conversationId: string }) {
  const [messages, setMessages] = useState<MessageView[]>([])
  const [botEnabled, setBotEnabled] = useState(false)
  const [contactName, setContactName] = useState<string | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  // Global kill switch overrides this conversation's own botEnabled -- without it, "Ambil
  // Alih dari Bot" kept showing (and offering to take over from a bot that can't reply
  // anyway) while the switch was on. Same override ConversationListItem applies to its badge.
  const [killSwitchOn, setKillSwitchOn] = useState(false)
  const [assignedAgentId, setAssignedAgentId] = useState<string | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [assignError, setAssignError] = useState<string | null>(null)
  // Captured once, from the conversation's lastReadAt as of the moment the thread was opened --
  // this draws the "Pesan belum dibaca" divider. It must not track later markAsRead() calls
  // (which move the read boundary forward as the agent keeps watching) or the divider would
  // vanish out from under them mid-read.
  const [unreadCutoff, setUnreadCutoff] = useState<string | null>(null)
  const [replyingTo, setReplyingTo] = useState<MessageView | null>(null)

  // Each of these swallows its rejection: fetchJson has already redirected on a 401, and on
  // any other failure the thread must keep its empty/default state rather than take an error
  // object into `messages` (which `messages.map` would then throw on).
  useEffect(() => {
    fetchJson<MessageView[]>(`/api/conversations/${conversationId}/messages`)
      .then(setMessages)
      .catch(() => {})
  }, [conversationId])

  useEffect(() => {
    fetchJson<ConversationDetail>(`/api/conversations/${conversationId}`)
      .then((data) => {
        setBotEnabled(data.botEnabled)
        setAssignedAgentId(data.assignedAgentId ?? null)
        setUnreadCutoff(data.lastReadAt ?? null)
        setContactName(data.contactName ?? null)
        setAvatarUrl(data.avatarUrl ?? null)
        // Only after lastReadAt is captured above -- otherwise a mark-as-read that lands
        // before this GET resolves would erase the very boundary the divider needs.
        markAsRead(conversationId)
      })
      .catch(() => {})
  }, [conversationId])

  useEffect(() => {
    fetchJson<Agent[]>('/api/accounts')
      .then(setAgents)
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchJson<{ botKillSwitch: boolean }>('/api/settings')
      .then((settings) => setKillSwitchOn(settings.botKillSwitch))
      .catch(() => {})
  }, [])

  // Mirrors ContactPanel's pipeline-stage dropdown: assignment drives who is
  // responsible for the conversation, so the dropdown must only ever reflect
  // what the server confirmed — no optimistic update. Await the response and
  // only update displayed state on success.
  async function changeAssignedAgent(agentId: string | null) {
    setAssignError(null)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ agentId }),
      })
      if (!res.ok) {
        setAssignError('Gagal mengubah penugasan agen')
        return
      }
      const updated = await res.json()
      setAssignedAgentId(updated.assignedAgentId ?? null)
    } catch {
      setAssignError('Gagal mengubah penugasan agen')
    }
  }

  useEffect(() => {
    const es = new EventSource('/api/sse')
    es.onmessage = (e) => {
      const event = JSON.parse(e.data)
      if (event.type === 'message.created' && event.conversationId === conversationId) {
        setMessages((prev) => (prev.some((m) => m.id === event.message.id) ? prev : [...prev, event.message]))
        // The agent is looking at this thread right now, so whatever just arrived counts as
        // seen -- without this, a message that arrived while the thread was open would still
        // read as unread in the sidebar the moment the agent navigated away from it.
        markAsRead(conversationId)
      }
      // Delivery receipts (Meta's sent/delivered/read/failed callbacks) arrive minutes
      // after the message itself, so the bubble must be replaced in place -- appending
      // would duplicate it. Ignored if the message isn't loaded in this thread.
      if (event.type === 'message.updated' && event.conversationId === conversationId) {
        setMessages((prev) => prev.map((m) => (m.id === event.message.id ? event.message : m)))
      }
    }
    return () => es.close()
  }, [conversationId])

  // -1 (never renders) when the conversation has never been read before -- everything being
  // "unread" on a first-ever open isn't a useful signal, only a boundary that moved is.
  const firstUnreadIndex = unreadCutoff
    ? messages.findIndex((m) => m.direction === 'INBOUND' && new Date(m.createdAt) > new Date(unreadCutoff))
    : -1

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-white px-4 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <ContactAvatar name={contactName} avatarUrl={avatarUrl} size="size-8" />
          <span className="truncate font-medium text-navy">{contactName ?? 'Tanpa nama'}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label htmlFor="assign-agent" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Ditugaskan ke
          </label>
          <Select
            id="assign-agent"
            aria-label="Ditugaskan ke"
            value={assignedAgentId ?? ''}
            onChange={(e) => changeAssignedAgent(e.target.value === '' ? null : e.target.value)}
            className="w-auto"
          >
            <option value="">Belum ditugaskan</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </Select>
        </div>
        {assignError && <p className="text-xs text-destructive">{assignError}</p>}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m, i) => (
          <div key={m.id}>
            {i === firstUnreadIndex && (
              <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                <span>Pesan belum dibaca</span>
                <div className="h-px flex-1 bg-border" />
              </div>
            )}
            <MessageBubble message={m} onReply={setReplyingTo} />
          </div>
        ))}
      </div>
      <ComposeBox
        conversationId={conversationId}
        botEnabled={botEnabled && !killSwitchOn}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        onSent={(m) => {
          setMessages((prev) => [...prev, m])
          setReplyingTo(null)
        }}
        onBotToggled={setBotEnabled}
      />
    </div>
  )
}
