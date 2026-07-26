'use client'
import { useEffect, useState } from 'react'
import { MessageBubble, type MessageView } from './MessageBubble'
import { ComposeBox } from './ComposeBox'
import { Select } from '@/components/ui/select'

type Agent = { id: string; name: string }

export function ThreadView({ conversationId }: { conversationId: string }) {
  const [messages, setMessages] = useState<MessageView[]>([])
  const [botEnabled, setBotEnabled] = useState(false)
  const [assignedAgentId, setAssignedAgentId] = useState<string | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [assignError, setAssignError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/conversations/${conversationId}/messages`)
      .then((r) => r.json())
      .then(setMessages)
  }, [conversationId])

  useEffect(() => {
    fetch(`/api/conversations/${conversationId}`)
      .then((r) => r.json())
      .then((data) => {
        setBotEnabled(data.botEnabled)
        setAssignedAgentId(data.assignedAgentId ?? null)
      })
  }, [conversationId])

  useEffect(() => {
    fetch('/api/accounts')
      .then((r) => r.json())
      .then(setAgents)
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
      }
    }
    return () => es.close()
  }, [conversationId])

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-white px-4 py-2">
        <div className="flex items-center gap-2">
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
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>
      <ComposeBox
        conversationId={conversationId}
        botEnabled={botEnabled}
        onSent={(m) => setMessages((prev) => [...prev, m])}
        onBotToggled={setBotEnabled}
      />
    </div>
  )
}
