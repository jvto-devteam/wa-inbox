'use client'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, PanelRight, PanelRightClose } from 'lucide-react'
import { MessageBubble, type MessageView } from './MessageBubble'
import { ComposeBox } from './ComposeBox'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { SkeletonText } from '@/components/ui/skeleton'
import { ContactAvatar } from '@/components/ContactAvatar'
import { cn } from '@/lib/utils'
import { fetchJson } from '@/lib/fetch-json'
import type { BookingData } from '@/lib/booking/client'

type Agent = { id: string; name: string }
type ConversationDetail = {
  botEnabled: boolean
  isTest?: boolean
  assignedAgentId?: string | null
  lastReadAt?: string | null
  contactName?: string | null
  avatarUrl?: string | null
  bookingData?: BookingData | null
}

/** Fire-and-forget: a failed mark-as-read is a cosmetic sidebar-badge staleness, never worth surfacing. */
function markAsRead(conversationId: string) {
  fetch(`/api/conversations/${conversationId}/read`, { method: 'PATCH' }).catch(() => {})
}

function isSameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString()
}

/**
 * "Hari ini" / "Kemarin" / a full date -- a long-running conversation otherwise mixes
 * messages from many different days with nothing but a bare HH.MM under each bubble
 * (MessageBubble's `formatTime` never shows the date), reading as if they all happened
 * today.
 */
function dayDividerLabel(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  if (isSameDay(date, now)) return 'Hari ini'
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (isSameDay(date, yesterday)) return 'Kemarin'
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * Pembatas mendatar di dalam thread: garis - teks - garis.
 *
 * Dua pemakaiannya sengaja terlihat berbeda. Pembatas hari adalah orientasi (netral, kalem);
 * "Pesan belum dibaca" adalah penanda belum dibaca -- salah satu dari tiga tempat aksen boleh
 * dibelanjakan di sistem ini -- dan ia memang harus bisa ditemukan mata saat menggulung.
 */
function ThreadDivider({
  label,
  tone = 'neutral',
  innerRef,
}: {
  label: string
  tone?: 'neutral' | 'accent'
  innerRef?: React.Ref<HTMLDivElement>
}) {
  const accent = tone === 'accent'
  return (
    <div ref={innerRef} className="mb-3 flex items-center gap-2">
      <div className={cn('h-px flex-1', accent ? 'bg-accent/35' : 'bg-line')} />
      <span
        className={cn(
          'rounded-sm px-2 py-0.5 text-xs font-medium',
          accent ? 'bg-accent-subtle text-accent' : 'border border-line bg-surface text-ink-muted'
        )}
      >
        {label}
      </span>
      <div className={cn('h-px flex-1', accent ? 'bg-accent/35' : 'bg-line')} />
    </div>
  )
}

export function ThreadView({
  conversationId,
  onBack,
  contactPanelOpen,
  onToggleContactPanel,
  className,
  focusMessageId,
}: {
  conversationId: string
  /** Hanya dirender di bawah md, tempat tiga kolom menjadi satu kolom bertingkat. */
  onBack?: () => void
  contactPanelOpen?: boolean
  onToggleContactPanel?: () => void
  className?: string
  /**
   * Pesan yang harus dituju saat thread dibuka dari notifikasi gap (`/inbox?...&message=<id>`):
   * digulung ke tengah layar, disorot, dan panel perbaikannya dibuka.
   */
  focusMessageId?: string
}) {
  const [messages, setMessages] = useState<MessageView[]>([])
  const [botEnabled, setBotEnabled] = useState(false)
  const [isTest, setIsTest] = useState(false)
  const [contactName, setContactName] = useState<string | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [bookingData, setBookingData] = useState<BookingData | null>(null)
  const [assignedAgentId, setAssignedAgentId] = useState<string | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [assignError, setAssignError] = useState<string | null>(null)
  const [clearingChat, setClearingChat] = useState(false)
  // Captured once, from the conversation's lastReadAt as of the moment the thread was opened --
  // this draws the "Pesan belum dibaca" divider. It must not track later markAsRead() calls
  // (which move the read boundary forward as the agent keeps watching) or the divider would
  // vanish out from under them mid-read.
  const [unreadCutoff, setUnreadCutoff] = useState<string | null>(null)
  const [replyingTo, setReplyingTo] = useState<MessageView | null>(null)
  // Gate the initial scroll (below) on BOTH requests having settled -- messages and
  // lastReadAt/unreadCutoff load in parallel effects and can resolve in either order, and
  // firstUnreadIndex is meaningless until unreadCutoff is actually known one way or the other.
  const [messagesLoaded, setMessagesLoaded] = useState(false)
  const [detailLoaded, setDetailLoaded] = useState(false)
  const unreadDividerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const focusRef = useRef<HTMLDivElement>(null)
  // Runs the initial scroll-into-place exactly once per opened conversation (ThreadView
  // remounts on conversation switch -- see the `key` on its call site -- so this never needs
  // resetting itself).
  const hasScrolledRef = useRef(false)

  // Each of these swallows its rejection: fetchJson has already redirected on a 401, and on
  // any other failure the thread must keep its empty/default state rather than take an error
  // object into `messages` (which `messages.map` would then throw on).
  useEffect(() => {
    fetchJson<MessageView[]>(`/api/conversations/${conversationId}/messages`)
      .then(setMessages)
      .catch(() => {})
      .finally(() => setMessagesLoaded(true))
  }, [conversationId])

  useEffect(() => {
    fetchJson<ConversationDetail>(`/api/conversations/${conversationId}`)
      .then((data) => {
        setBotEnabled(data.botEnabled)
        setIsTest(data.isTest ?? false)
        setAssignedAgentId(data.assignedAgentId ?? null)
        setUnreadCutoff(data.lastReadAt ?? null)
        setContactName(data.contactName ?? null)
        setAvatarUrl(data.avatarUrl ?? null)
        setBookingData(data.bookingData ?? null)
        // Only after lastReadAt is captured above -- otherwise a mark-as-read that lands
        // before this GET resolves would erase the very boundary the divider needs.
        markAsRead(conversationId)
      })
      .catch(() => {})
      .finally(() => setDetailLoaded(true))
  }, [conversationId])

  // Opening a thread used to always land scrolled to the very top (the browser's default for
  // a tall overflow container), forcing the agent to scroll down past the whole history every
  // single time -- even when nothing was unread. Once both requests above have settled, jump
  // straight to the first unread message (matching the "Pesan belum dibaca" divider below), or
  // to the very last message when everything is already read.
  useEffect(() => {
    if (hasScrolledRef.current || !messagesLoaded || !detailLoaded) return
    hasScrolledRef.current = true
    // Pesan yang diminta notifikasi menang atas pembatas "belum dibaca": operator sampai di
    // sini justru untuk melihat jawaban itu, bukan untuk melanjutkan bacaan.
    if (focusRef.current) {
      focusRef.current.scrollIntoView({ block: 'center' })
      return
    }
    const target = unreadDividerRef.current ?? bottomRef.current
    target?.scrollIntoView({ block: unreadDividerRef.current ? 'start' : 'end' })
  }, [messagesLoaded, detailLoaded])

  useEffect(() => {
    fetchJson<Agent[]>('/api/accounts')
      .then(setAgents)
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

  // Wipes this test room's message history + TripBrief server-side (see clear/route.ts) so a
  // manual bot test starts from a genuinely clean slate -- otherwise a fact learned in an
  // earlier test (destination, origin, dayCount, finishCity) silently carries into the next
  // one. Optimistically clears local state on success rather than waiting for the
  // 'conversation.cleared' SSE echo, which stays in place so other open tabs stay in sync.
  async function clearChat() {
    if (!window.confirm('Hapus semua riwayat pesan di room tes ini? Tindakan ini tidak bisa dibatalkan.')) return
    setClearingChat(true)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/clear`, { method: 'POST' })
      if (res.ok) {
        setMessages([])
        setBotEnabled(true)
        setUnreadCutoff(null)
      }
    } finally {
      setClearingChat(false)
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
      // inbound.ts flips conversation.botEnabled to false server-side the moment the bot hands
      // off -- broadcasting this alert is the ONLY signal of that, since it happens without any
      // click in THIS browser tab. Without syncing local state to it, an agent who had just
      // manually re-activated the bot for this one chat (see ComposeBox's "Aktifkan Bot untuk
      // Chat Ini") kept seeing "Ambil Alih dari Bot" -- implying the bot was still answering --
      // for a chat the bot had already handed straight back off, which is exactly backwards.
      if (event.type === 'handoff.alert' && event.conversationId === conversationId) {
        setBotEnabled(false)
      }
      // Another tab (or this one, via its own optimistic update above) cleared this test
      // room -- drop every locally-held message rather than leaving a stale history visible.
      if (event.type === 'conversation.cleared' && event.conversationId === conversationId) {
        setMessages([])
        setBotEnabled(true)
        setUnreadCutoff(null)
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
    // Kolom tengah: kepala tetap, riwayat yang menggulung sendiri, kotak tulis menempel di
    // bawah. min-h-0 wajib supaya scroller di tengah yang menyusut, bukan kolomnya yang tumbuh.
    <section
      aria-label="Percakapan"
      className={cn('flex h-full min-h-0 flex-col bg-canvas', className)}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-2">
        {onBack && (
          // Hanya ada di layar sempit: di sana daftar percakapan tergantikan oleh thread ini,
          // jadi tanpa tombol ini tidak ada jalan kembali ke daftar.
          <IconButton
            label="Kembali ke daftar percakapan"
            icon={<ArrowLeft strokeWidth={1.75} />}
            onClick={onBack}
            className="md:hidden"
          />
        )}
        <ContactAvatar name={contactName} avatarUrl={avatarUrl} size="size-8" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-semibold text-ink">{contactName ?? 'Tanpa nama'}</span>
          {isTest && (
            <span className="truncate text-xs text-warning">Room Tes -- tidak terkirim ke WhatsApp</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isTest && (
            <Button type="button" variant="destructive" size="sm" onClick={clearChat} disabled={clearingChat}>
              {clearingChat ? 'Menghapus...' : 'Hapus Chat'}
            </Button>
          )}
          {/* Label "Ditugaskan ke" tidak lagi ditulis di layar: nilainya sendiri sudah berbunyi
              "Belum ditugaskan" atau sebuah nama, dan dua kata tetap di kepala yang sempit
              memakan ruang yang seharusnya milik nama pelanggan. Namanya untuk pembaca layar
              tetap ada lewat aria-label. */}
          <Select
            id="assign-agent"
            aria-label="Ditugaskan ke"
            title="Ditugaskan ke"
            value={assignedAgentId ?? ''}
            onChange={(e) => changeAssignedAgent(e.target.value === '' ? null : e.target.value)}
            className="w-auto max-w-40 text-sm"
          >
            <option value="">Belum ditugaskan</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </Select>
          {onToggleContactPanel && (
            // Hanya dari xl ke atas: di bawah itu panel kontak memang tidak punya kolom untuk
            // ditempati, jadi tombol yang tidak bisa menampilkan apa-apa lebih baik tidak ada.
            <IconButton
              label={contactPanelOpen ? 'Sembunyikan panel kontak' : 'Tampilkan panel kontak'}
              icon={contactPanelOpen ? <PanelRightClose strokeWidth={1.75} /> : <PanelRight strokeWidth={1.75} />}
              aria-pressed={contactPanelOpen}
              onClick={onToggleContactPanel}
              className="hidden xl:inline-flex"
            />
          )}
        </div>
      </header>
      {assignError && (
        <p role="alert" className="shrink-0 border-b border-line bg-danger-subtle px-3 py-1.5 text-xs text-danger">
          {assignError}
        </p>
      )}
      {/* role="log": riwayat yang bertambah sendiri lewat SSE. Pembaca layar butuh tahu bahwa
          kotak ini bertambah, bukan sekadar sebuah div yang menggulung. */}
      <div
        role="log"
        aria-label="Riwayat pesan"
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-4 sm:px-4"
      >
        {!messagesLoaded ? (
          <div className="space-y-4" aria-hidden="true">
            <SkeletonText lines={2} className="max-w-md" />
            <SkeletonText lines={1} className="ml-auto max-w-xs" />
            <SkeletonText lines={3} className="max-w-md" />
          </div>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-muted">
            Belum ada pesan di percakapan ini. Tulis yang pertama di bawah.
          </p>
        ) : null}
        {messages.map((m, i) => {
          const focused = m.id === focusMessageId
          return (
            <div
              key={m.id}
              ref={focused ? focusRef : undefined}
              className={cn(focused && 'rounded-lg ring-2 ring-accent/40')}
            >
              {(i === 0 || !isSameDay(new Date(m.createdAt), new Date(messages[i - 1].createdAt))) && (
                <ThreadDivider label={dayDividerLabel(m.createdAt)} />
              )}
              {i === firstUnreadIndex && (
                <ThreadDivider label="Pesan belum dibaca" tone="accent" innerRef={unreadDividerRef} />
              )}
              <MessageBubble
                message={m}
                onReply={setReplyingTo}
                conversationId={conversationId}
                autoOpenFix={focused}
              />
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
      <ComposeBox
        conversationId={conversationId}
        botEnabled={botEnabled}
        contactName={contactName}
        bookingData={bookingData}
        isTest={isTest}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        onSent={(m) => {
          // A test-room send's SSE echo (broadcast the instant the message is created,
          // server-side) can outrace this fetch's own response when the bot takes a while to
          // answer (e.g. the booking_context path's real Ollama call) -- without this guard
          // the same message lands here a second time once the response finally arrives.
          setMessages((prev) => (prev.some((existing) => existing.id === m.id) ? prev : [...prev, m]))
          setReplyingTo(null)
        }}
        onBotToggled={setBotEnabled}
      />
    </section>
  )
}
