'use client'
import { useEffect, useState } from 'react'
import { MessageBubble, type MessageView } from './MessageBubble'
import { ComposeBox } from './ComposeBox'

export function ThreadView({ conversationId }: { conversationId: string }) {
  const [messages, setMessages] = useState<MessageView[]>([])

  useEffect(() => {
    fetch(`/api/conversations/${conversationId}/messages`)
      .then((r) => r.json())
      .then(setMessages)
  }, [conversationId])

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>
      <ComposeBox conversationId={conversationId} onSent={(m) => setMessages((prev) => [...prev, m])} />
    </div>
  )
}
