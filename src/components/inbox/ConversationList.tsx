'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ConversationListItem, type ConversationSummary } from './ConversationListItem'
import type { LabelOption } from './LabelPicker'
import { fetchJson } from '@/lib/fetch-json'
import { SHIPPED_PLATFORMS, PLATFORM_LABEL } from '@/lib/channel/platform'

// The filter row is single-select across three different dimensions -- a booking's origin
// platform (orderChannel, e.g. JVTO/KLOOK), an operator-defined Label, and the messaging
// platform the conversation itself came in on (WhatsApp/Facebook/...) -- so "which pill is
// active" needs both which kind and which value, not just a bare id.
//
// 'channel' here is Conversation.orderChannel -- where a BOOKING originated -- not the
// messaging platform. That is a different fact about the same row; see 'platform' below.
type FilterOption =
  | { kind: 'channel'; value: string }
  | { kind: 'label'; value: string }
  | { kind: 'platform'; value: string }

function sameFilter(a: FilterOption | null, b: FilterOption | null) {
  return a === b || (a !== null && b !== null && a.kind === b.kind && a.value === b.value)
}

// Pencarian ada di kotak cari bar atas (Shell), yang membuka percakapan langsung; daftar ini hanya memakai filter.
function conversationsUrl(filter: FilterOption | null) {
  const params = new URLSearchParams()
  if (filter?.kind === 'channel') params.set('orderChannel', filter.value)
  if (filter?.kind === 'label') params.set('labelId', filter.value)
  if (filter?.kind === 'platform') params.set('platform', filter.value)
  const qs = params.toString()
  return qs ? `/api/conversations?${qs}` : '/api/conversations'
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

/** Baris palsu selagi permintaan pertama berjalan, setinggi baris sungguhan supaya daftar tidak melompat. */
function ConversationListSkeleton() {
  return (
    <div aria-hidden="true">
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="row" style={{ pointerEvents: 'none' }}>
          <div className="av" />
          <div>
            <b style={{ display: 'block', height: 12, width: i % 3 === 0 ? '40%' : '60%', background: 'var(--neutral-bg)', borderRadius: 4 }} />
            <p style={{ height: 10, width: i % 2 === 0 ? '80%' : '60%', background: 'var(--neutral-bg)', borderRadius: 4, marginTop: 6 }} />
          </div>
          <div className="t" />
        </div>
      ))}
    </div>
  )
}

export function ConversationList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  // Default WhatsApp, bukan null ("Semua") -- hari pertama setelah deploy tim melihat persis
  // apa yang mereka lihat sekarang (satu-satunya platform yang pernah ada sebelum tab ini).
  const [filter, setFilter] = useState<FilterOption | null>({ kind: 'platform', value: 'WHATSAPP' })
  const [channels, setChannels] = useState<string[]>([])
  const [allLabels, setAllLabels] = useState<LabelOption[]>([])
  // Hanya menandai permintaan PERTAMA. Menyalakan kerangka di setiap ganti filter akan membuat
  // daftar berkedip; hasil lama yang tinggal sebentar lebih tenang.
  const [firstLoadDone, setFirstLoadDone] = useState(false)

  // Latest-value mirrors read by the SSE effect below. Depending on `filter`/`conversations`
  // directly would tear down and re-open the EventSource on every filter change and on every
  // single incoming message; the refs let that effect stay mounted for the tab's lifetime.
  const filterRef = useRef(filter)
  const conversationsRef = useRef(conversations)
  const selectedIdRef = useRef(selectedId)
  useEffect(() => {
    filterRef.current = filter
  }, [filter])
  useEffect(() => {
    conversationsRef.current = conversations
  }, [conversations])
  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  // Distinct orderChannel values actually on file (JVTO/KLOOK/TWT/...), not a hardcoded list --
  // whichever platforms have sent a booking so far are exactly the ones worth filtering by.
  useEffect(() => {
    fetchJson<string[]>('/api/conversations/order-channels').then(setChannels).catch(() => {})
  }, [])

  // Operator-defined labels, the other filterable dimension. Created/renamed from ContactPanel
  // (a sibling, separate mount) -- a label made mid-session shows up here on the next full
  // reload of this list, same as it does for the per-row label badges.
  useEffect(() => {
    fetchJson<LabelOption[]>('/api/labels').then(setAllLabels).catch(() => {})
  }, [])

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

  const loadConversations = useCallback((f: FilterOption | null) => {
    // On a rejection the list simply keeps whatever it already had: a 401 has already sent
    // the browser to /login, and a 500 must not blank out the agent's inbox.
    //
    // The deep-link case (/inbox?conversation=<id>) is why the selected row is cleared here
    // too: there the id is already selected on mount, so the adjustment above has nothing to
    // react to by the time the list itself arrives.
    fetchJson<ConversationSummary[]>(conversationsUrl(f))
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
    loadConversations(filter)
  }, [filter, loadConversations])

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
          loadConversations(filterRef.current)
        }
        return
      }

      // Label "Permintaan perubahan" berubah di server tanpa pesan baru (ditutup, dibuat bot).
      if (event.type === 'booking-actions.changed') {
        if (conversationsRef.current.some((c) => c.id === event.conversationId)) {
          loadConversations(filterRef.current)
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
        loadConversations(filterRef.current)
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

  const filterButton = (key: string, active: boolean, onClick: () => void, label: React.ReactNode) => (
    <button key={key} type="button" className={active ? 'on' : ''} aria-pressed={active} onClick={onClick}>
      {label}
    </button>
  )

  return (
    // Kolom pertama .inbox (desain artifact): deret filter + daftar yang menggulung sendiri.
    <div className="col" role="region" aria-label="Daftar percakapan">
      {(SHIPPED_PLATFORMS.length > 0 || channels.length > 0 || allLabels.length > 0) && (
        // Tiga dimensi, satu pilihan: platform pesan, asal booking (orderChannel), label operator.
        <div className="flt" id="i-flt" role="group" aria-label="Filter inbox">
          {filterButton('all', filter === null, () => setFilter(null), 'Semua')}
          {SHIPPED_PLATFORMS.map((p) =>
            filterButton(`platform:${p}`, sameFilter(filter, { kind: 'platform', value: p }), () => setFilter({ kind: 'platform', value: p }), PLATFORM_LABEL[p])
          )}
          {channels.map((c) =>
            filterButton(`channel:${c}`, sameFilter(filter, { kind: 'channel', value: c }), () => setFilter({ kind: 'channel', value: c }), c)
          )}
          {allLabels.map((l) =>
            filterButton(`label:${l.id}`, sameFilter(filter, { kind: 'label', value: l.id }), () => setFilter({ kind: 'label', value: l.id }), l.name)
          )}
        </div>
      )}

      <div className="rows" id="i-rows">
        {!firstLoadDone ? (
          <ConversationListSkeleton />
        ) : conversations.length === 0 ? (
          <div className="mut" style={{ padding: 16 }}>Tidak ada chat.</div>
        ) : (
          conversations.map((c) => (
            <ConversationListItem
              key={c.id}
              conversation={c}
              active={c.id === selectedId}
              onClick={() => onSelect(c.id)}
              // Hidden ONLY when a single platform tab is active (filter.kind === 'platform')
              // -- that is the one state where every row on screen already agrees on its
              // platform. Every other state -- "Semua", an orderChannel pill, a label pill --
              // can mix rows from more than one platform (see GET /api/conversations).
              showPlatformBadge={filter?.kind !== 'platform'}
            />
          ))
        )}
      </div>
    </div>
  )
}
