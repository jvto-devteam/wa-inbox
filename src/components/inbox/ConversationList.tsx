'use client'
import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { ConversationListItem, type ConversationSummary } from './ConversationListItem'

const SEARCH_DEBOUNCE_MS = 300

function fetchConversations(query: string, setConversations: (c: ConversationSummary[]) => void) {
  const url = query.trim() ? `/api/conversations?q=${encodeURIComponent(query.trim())}` : '/api/conversations'
  fetch(url).then((r) => r.json()).then(setConversations)
}

export function ConversationList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [query, setQuery] = useState('')
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      fetchConversations(query, setConversations)
      return
    }

    const timer = setTimeout(() => fetchConversations(query, setConversations), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  return (
    <div className="flex h-full flex-col overflow-y-auto border-r">
      <div className="border-b p-2">
        <Input
          type="text"
          placeholder="Cari nama, nomor, atau isi pesan..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {conversations.map((c) => (
        <ConversationListItem key={c.id} conversation={c} active={c.id === selectedId} onClick={() => onSelect(c.id)} />
      ))}
    </div>
  )
}
