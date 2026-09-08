'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MessagesSquare, Search, SearchX } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { ConversationListItem, type ConversationSummary } from './ConversationListItem'
import { fetchJson } from '@/lib/fetch-json'

const SEARCH_DEBOUNCE_MS = 300

function conversationsUrl(query: string) {
  const trimmed = query.trim()
  return trimmed ? `/api/conversations?q=${encodeURIComponent(trimmed)}` : '/api/conversations'
}

// Pinned first, then newest -- the same ordering the API applies
// (`orderBy: [{ isPinned: 'desc' }, { lastMessageAt: 'desc' }]`), re-applied client-side
// after a live patch so a pinned row (the isTest sandbox conversation) can't drift below a
// very recently active one once its own lastMessageAt is no longer the newest.
function byPinnedThenLastMessageAtDesc(a: ConversationSummary, b: ConversationSummary) {
  if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
  return b.lastMessageAt.localeCompare(a.lastMessageAt)
}

type BroadcastMessage = {
  id: string
  content: string | null
  sentBy: string | null
  createdAt: string
  direction: string
}

/**
 * Baris palsu selagi permintaan pertama berjalan. Bentuknya sengaja meniru geometri baris
 * sungguhan (avatar 36px, tiga baris teks) supaya daftar tidak melompat saat datanya tiba --
 * itulah bedanya keadaan memuat yang dirancang dari kotak abu sembarangan.
 */
function ConversationListSkeleton() {
  return (
    <div className="divide-y divide-line" aria-hidden="true">
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="flex gap-2.5 py-2.5 pr-3 pl-2">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
            <Skeleton className={cn('h-3', i % 3 === 0 ? 'w-2/5' : 'w-3/5')} />
            <Skeleton className={cn('h-3', i % 2 === 0 ? 'w-4/5' : 'w-3/5')} />
            <Skeleton className="h-3.5 w-16" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function ConversationList({
  selectedId,
  onSelect,
  className,
}: {
  selectedId: string | null
  onSelect: (id: string) => void
  className?: string
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [query, setQuery] = useState('')
  // Hanya menandai permintaan PERTAMA. Menyalakan kerangka di setiap pencarian akan membuat
  // daftar berkedip di setiap ketukan tombol; hasil lama yang tinggal sebentar lebih tenang.
  const [firstLoadDone, setFirstLoadDone] = useState(false)
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
  }, [selectedId])

  // Opening a conversation is an immediate "I've seen this" signal, ahead of ThreadView's own
  // PATCH landing — without it the badge lingers for the length of that request.
  //
  // Adjusting state DURING RENDER on a changed prop, rather than from an effect watching it:
  // react.dev's own "adjusting state when a prop changes" pattern. React re-runs this
  // component immediately, before touching the DOM, so nothing intermediate is ever painted —
  // which is exactly why the effect form (setState in an effect body, then a second commit)
  // is the one the lint rule rejects.
  //
  // Zeroing it in the state itself rather than masking it at render time is load-bearing: the
  // SSE handler below increments `unreadCount` from whatever the row currently holds, so a
  // render-time mask would let a stale server count reappear the moment the next message
  // arrived for a conversation the agent had already read.
  const [readSelectedId, setReadSelectedId] = useState(selectedId)
  if (selectedId !== readSelectedId) {
    setReadSelectedId(selectedId)
    if (selectedId) {
      setConversations((prev) => prev.map((c) => (c.id === selectedId ? { ...c, unreadCount: 0 } : c)))
    }
  }

  const loadConversations = useCallback((q: string) => {
    // On a rejection the list simply keeps whatever it already had: a 401 has already sent
    // the browser to /login, and a 500 must not blank out the agent's inbox.
    //
    // The deep-link case (/inbox?conversation=<id>) is why the selected row is cleared here
    // too: there the id is already selected on mount, so the adjustment above has nothing to
    // react to by the time the list itself arrives.
    fetchJson<ConversationSummary[]>(conversationsUrl(q))
      .then((list) =>
        setConversations(
          selectedIdRef.current
            ? list.map((c) => (c.id === selectedIdRef.current ? { ...c, unreadCount: 0 } : c))
            : list
        )
      )
      .catch(() => {})
      .finally(() => setFirstLoadDone(true))
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

      // Tahap pipeline / kanal pesanan berubah di server tanpa pesan baru -- mis. saat data
      // booking di-refresh dan trip-nya ternyata sudah lewat. Sebelum ini badge di baris
      // hanya ikut berubah setelah seluruh halaman dimuat ulang, sehingga percakapan yang
      // jelas-jelas sudah punya booking masih memakai lencana "Baru".
      //
      // Mengambil ulang daftar, bukan menambal satu baris: satu baris butuh nama kontak,
      // label, dan botEnabled yang tidak dibawa event ini -- alasan yang sama dengan cabang
      // "percakapan belum dikenal" di bawah.
      if (event.type === 'conversation.updated') {
        if (conversationsRef.current.some((c) => c.id === event.conversationId)) {
          loadConversations(queryRef.current)
        }
        return
      }

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
          .sort(byPinnedThenLastMessageAtDesc)
      )
    }
    return () => es.close()
  }, [loadConversations])

  const isSearching = query.trim().length > 0

  return (
    // min-h-0 + h-full: kolom ini menggulung SENDIRI. Tanpa min-h-0 sebuah item flex/grid
    // menolak menyusut di bawah tinggi isinya, dan overflow-nya terdorong balik ke pembungkus
    // layout -- yaitu gulungan ganda yang dilarang.
    <aside
      aria-label="Daftar percakapan"
      className={cn('flex h-full min-h-0 flex-col border-r border-line bg-surface', className)}
    >
      <div className="shrink-0 border-b border-line p-2">
        <div className="relative">
          <Search
            aria-hidden="true"
            strokeWidth={1.75}
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-subtle"
          />
          <Input
            type="search"
            aria-label="Cari percakapan"
            placeholder="Cari nama, nomor, atau isi pesan..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {!firstLoadDone ? (
          <ConversationListSkeleton />
        ) : conversations.length === 0 ? (
          isSearching ? (
            <EmptyState
              icon={<SearchX strokeWidth={1.5} />}
              title="Tidak ada yang cocok"
              description={`Tidak ada percakapan yang memuat "${query.trim()}". Coba potongan nomor atau satu kata dari isi pesannya.`}
              action={
                <Button variant="outline" size="sm" onClick={() => setQuery('')}>
                  Hapus pencarian
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<MessagesSquare strokeWidth={1.5} />}
              title="Belum ada percakapan"
              description="Percakapan muncul di sini begitu pelanggan mengirim pesan pertama ke nomor WhatsApp JVTO."
            />
          )
        ) : (
          <ul>
            {conversations.map((c) => (
              <ConversationListItem
                key={c.id}
                conversation={c}
                active={c.id === selectedId}
                onClick={() => onSelect(c.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
