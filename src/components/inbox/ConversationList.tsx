'use client'
import { useEffect, useState } from 'react'
import { ConversationListItem, type ConversationSummary } from './ConversationListItem'

export function ConversationList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])

  useEffect(() => {
    fetch('/api/conversations').then((r) => r.json()).then(setConversations)
  }, [])

  return (
    <div className="flex h-full flex-col overflow-y-auto border-r">
      {conversations.map((c) => (
        <ConversationListItem key={c.id} conversation={c} active={c.id === selectedId} onClick={() => onSelect(c.id)} />
      ))}
    </div>
  )
}
