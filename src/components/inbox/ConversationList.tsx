'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { ConversationListItem, type ConversationSummary } from './ConversationListItem'
import { fetchJson } from '@/lib/fetch-json'

const SEARCH_DEBOUNCE_MS = 300

function conversationsUrl(query: string) {
  const trimmed = query.trim()
  return trimmed ? `/api/conversations?q=${encodeURIComponent(trimmed)}` : '/api/conversations'
}

// Newest conversation first — the same ordering the API applies
// (`orderBy: { lastMessageAt: 'desc' }`), re-applied client-side after a live patch.
function byLastMessageAtDesc(a: ConversationSummary, b: ConversationSummary) {
  return b.lastMessageAt.localeCompare(a.lastMessageAt)
}

type BroadcastMessage = {
  id: string
  content: string | null
  sentBy: string | null
  createdAt: string
  direction: string
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
  // Global kill switch overrides every conversation's own botEnabled -- fetched once so the
  // sidebar's Bot/Agen badge reflects whether the bot can actually reply right now, not just
  // whether it's toggled on for this conversation.
  const [killSwitchOn, setKillSwitchOn] = useState(false)
  const isFirstRender = useRef(true)

  // Latest-value mirrors read by the SSE effect below. Depending on `query`/`conversations`
  // directly would tear down and re-open the EventSource on every keystroke and on every
  // single incoming message; the refs let that effect stay mounted for the tab's lifetime.
  const queryRef = useRef(query)
  const conversationsRef = useRef(conversations)
  const selectedIdRef = useRef(selectedId)
  useEffect(() => {
    queryRef.current = query
  }, [query])
  useEffect(() => {
    conversationsRef.current = conversations
  }, [conversations])
  useEffect(() => {
    selectedIdRef.current = selectedId
    // Opening a conversation is an immediate "I've seen this" signal, ahead of ThreadView's
    // own PATCH landing — without this the badge would linger for the length of that request.
    if (selectedId) setConversations((prev) => prev.map((c) => (c.id === selectedId ? { ...c, unreadCount: 0 } : c)))
  }, [selectedId])

  const loadConversations = useCallback((q: string) => {
    // On a rejection the list simply keeps whatever it already had: a 401 has already sent
    // the browser to /login, and a 500 must not blank out the agent's inbox.
    fetchJson<ConversationSummary[]>(conversationsUrl(q))
      .then(setConversations)
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchJson<{ botKillSwitch: boolean }>('/api/settings')
      .then((settings) => setKillSwitchOn(settings.botKillSwitch))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      loadConversations(query)
      return
    }

    const timer = setTimeout(() => loadConversations(query), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, loadConversations])

  // Live updates. Without this the sidebar was a one-shot snapshot: a new customer message
  // never appeared as a row, and a reply on an existing conversation never moved it to the
  // top or refreshed its preview, so agents had to reload the page to see anything.
  //
  // Strategy is a hybrid rather than "always re-fetch" or "always patch":
  //   - conversation already in the list -> patch its preview/timestamp in place and re-sort.
  //     Every field the row renders (lastMessage, lastMessageSentBy, lastMessageAt) is
  //     already carried on the event, so a round trip would buy nothing.
  //   - conversation NOT in the list -> re-fetch. A brand-new conversation has fields this
  //     event cannot supply (contact name/phone, labels, botEnabled), and while a search is
  //     active the re-fetch is also what correctly decides whether the row belongs on screen
  //     at all.
  //
  // Note: this is the third EventSource a single tab can hold open (alongside ThreadView and
  // NotificationListener). Consolidating them behind one shared subscription is a deliberate
  // follow-up, not part of this fix.
  useEffect(() => {
    const es = new EventSource('/api/sse')
    es.onmessage = (e) => {
      const event = JSON.parse(e.data)
      if (event.type !== 'message.created') return

      // The membership test reads the mirror ref, not the state updater's `prev`: the updater
      // runs later, during React's render phase, so a flag set inside it would still hold its
      // initial value here — and firing a fetch from inside an updater is a side effect in
      // what must stay a pure function (React may invoke it twice).
      const known = conversationsRef.current.some((c) => c.id === event.conversationId)
      if (!known) {
        loadConversations(queryRef.current)
        return
      }

      const message = event.message as BroadcastMessage
      // A message arriving for the conversation currently open on screen is not
      // unread -- the agent is looking straight at it (ThreadView's own SSE handler
      // re-marks it read server-side). Anything else bumps the sidebar badge.
      const isUnreadable = message.direction === 'INBOUND' && event.conversationId !== selectedIdRef.current
      setConversations((prev) =>
        prev
          .map((c) =>
            c.id === event.conversationId
              ? {
                  ...c,
                  lastMessage: message.content ?? null,
                  lastMessageSentBy: message.sentBy ?? null,
                  lastMessageAt: message.createdAt,
                  unreadCount: isUnreadable ? c.unreadCount + 1 : c.unreadCount,
                }
              : c
          )
          .sort(byLastMessageAtDesc)
      )
    }
    return () => es.close()
  }, [loadConversations])

  return (
    <div className="flex h-full min-h-0 flex-col border-r">
      <div className="shrink-0 border-b p-2">
        <Input
          type="text"
          placeholder="Cari nama, nomor, atau isi pesan..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {conversations.map((c) => (
          <ConversationListItem
            key={c.id}
            conversation={c}
            active={c.id === selectedId}
            killSwitchOn={killSwitchOn}
            onClick={() => onSelect(c.id)}
          />
        ))}
      </div>
    </div>
  )
}
