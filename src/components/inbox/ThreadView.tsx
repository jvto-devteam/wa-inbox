'use client'
import { useEffect, useRef, useState } from 'react'
import { MessageBubble, type MessageView } from './MessageBubble'
import { ComposeBox } from './ComposeBox'
import { nameInitials } from './ConversationListItem'
import { fetchJson } from '@/lib/fetch-json'
import { PLATFORM_LABEL } from '@/lib/channel/platform'
import type { BookingData } from '@/lib/booking/client'
import { bookingGuestName, contactDisplayName } from '@/lib/booking/display-name'
import type { MessageDraftView } from '@/lib/inbox/message-draft-view'
import { threadMessageDomId } from '@/lib/inbox/message-anchor'
import { lastInboundAt } from '@/lib/inbox/service-window'
import { autoDraftTarget, type AutoDraftTarget } from '@/lib/inbox/draft-target'

type ConversationDetail = {
  botEnabled: boolean
  isTest?: boolean
  /** Mode uji tanpa WA (nomor whitelist): chat sebagai tamu/JVTO, tidak ada WhatsApp keluar. */
  dryRun?: boolean
  canDryRun?: boolean
  lastReadAt?: string | null
  contactName?: string | null
  avatarUrl?: string | null
  bookingData?: BookingData | null
  platform?: string | null
  subject?: string | null
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

function fetchMessages(conversationId: string): Promise<MessageView[]> {
  return fetchJson<MessageView[]>(`/api/conversations/${conversationId}/messages`)
}

/**
 * SSE broadcasts (`broadcast()` call sites in inbound.ts/send.ts/worker.ts/...) pass through
 * `withMediaUrl(prismaRow)` -- a raw `Message` row plus a resolved media URL, never `draft` or
 * `fromDraft` (neither is a column on `Message`; both are computed server-side only for the
 * GET .../messages route and the draft endpoints). Replacing a bubble wholesale from such an
 * event would silently erase a draft card or a "Dari draft bot" badge the agent is already
 * looking at. `'draft' in incoming` (not `incoming.draft !== undefined`) is deliberate: it lets
 * a payload that explicitly carries `draft: null` (a real "no draft" answer) through, while a
 * payload missing the key entirely falls back to what's already on screen.
 */
function withPreservedDraftFields(existing: MessageView, incoming: MessageView): MessageView {
  return {
    ...incoming,
    draft: 'draft' in incoming ? incoming.draft : existing.draft,
    fromDraft: 'fromDraft' in incoming ? incoming.fromDraft : existing.fromDraft,
  }
}

/**
 * The `.../draft/send` response's `message` is server-serialized with `fromDraft: false`
 * (Controller ruling, Task 5 spec): that field describes what an SSE broadcast about this same
 * message will look like, not what THIS agent's own thread should show right after sending from
 * a draft. Forcing it true here is what makes the "Dari draft bot" badge appear without a reload.
 */
function upsertSentMessage(prev: MessageView[], sent: MessageView): MessageView[] {
  const withBadge: MessageView = { ...sent, fromDraft: true }
  const index = prev.findIndex((m) => m.id === withBadge.id)
  if (index === -1) return [...prev, withBadge]
  const next = [...prev]
  next[index] = withBadge
  return next
}

/**
 * Pembatas di dalam thread, bentuk pesan sistem artifact (.m.s, pil di tengah). Pembatas hari netral; "Pesan belum
 * dibaca" memakai aksen supaya bisa ditemukan mata saat menggulung.
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
  return (
    <div ref={innerRef} className={'m s' + (tone === 'accent' ? ' info' : '')} style={{ margin: '0 auto 9px', width: 'fit-content' }}>
      {label}
    </div>
  )
}

export function ThreadView({
  conversationId,
  onBack,
  onInfo,
  focusMessageId,
  openFixOnFocus = true,
  autoDraft = false,
  followUp = false,
}: {
  conversationId: string
  /** Tombol kembali ke daftar; hanya tampil di ponsel (.mback), tempat tiga kolom menjadi satu. */
  onBack?: () => void
  /** Tombol info (.minfo, hanya di ponsel): membuka panel kanan sebagai lembar bawah. */
  onInfo?: () => void
  /**
   * Pesan yang harus dituju saat thread dibuka dari notifikasi gap (`/inbox?...&message=<id>`):
   * digulung ke tengah layar, disorot, dan panel perbaikannya dibuka.
   */
  focusMessageId?: string
  /**
   * false = pesan fokus hanya digulung dan disorot, panel perbaikannya tidak dibuka sendiri
   * (`&lihat=1` dari butir ringkasan). Default true: perilaku notifikasi gap dan Balas.
   */
  openFixOnFocus?: boolean
  /**
   * `&draft=1` (Balas dari antrean): alur "Generate draft" yang sama dipicu sekali untuk pesan
   * teks masuk TERAKHIR dalam rangkaian yang dimulai di pesan fokus (`autoDraftTarget`), kalau
   * draftnya belum ada. Sorotan tetap di pesan fokus. Draft hanya ditampilkan, tidak terkirim.
   */
  autoDraft?: boolean
  /**
   * `&followup=1` (Follow up dari antrean): ComposeBox membuka pemilih template kalau jendela
   * layanan tertutup, atau memfokuskan kotak balasan kalau masih terbuka. Tidak mengirim apa pun.
   */
  followUp?: boolean
}) {
  const [messages, setMessages] = useState<MessageView[]>([])
  const [botEnabled, setBotEnabled] = useState(false)
  const [isTest, setIsTest] = useState(false)
  const [dryRun, setDryRun] = useState(false)
  const [canDryRun, setCanDryRun] = useState(false)
  const [isEmail, setIsEmail] = useState(false)
  const [platform, setPlatform] = useState<string | null>(null)
  const [subject, setSubject] = useState<string | null>(null)
  const [contactName, setContactName] = useState<string | null>(null)
  const [bookingData, setBookingData] = useState<BookingData | null>(null)
  const [botToggleError, setBotToggleError] = useState<string | null>(null)
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
  const lastFocusScrolledRef = useRef<string | null>(null)
  // Runs the initial scroll-into-place exactly once per opened conversation (ThreadView
  // remounts on conversation switch -- see the `key` on its call site -- so this never needs
  // resetting itself).
  const hasScrolledRef = useRef(false)

  // Each of these swallows its rejection: fetchJson has already redirected on a 401, and on
  // any other failure the thread must keep its empty/default state rather than take an error
  // object into `messages` (which `messages.map` would then throw on).
  useEffect(() => {
    fetchMessages(conversationId)
      .then(setMessages)
      .catch(() => {})
      .finally(() => setMessagesLoaded(true))
  }, [conversationId])

  useEffect(() => {
    fetchJson<ConversationDetail>(`/api/conversations/${conversationId}`)
      .then((data) => {
        setBotEnabled(data.botEnabled)
        setIsTest(data.isTest ?? false)
        setDryRun(data.dryRun ?? false)
        setCanDryRun(data.canDryRun ?? false)
        setIsEmail(data.platform === 'EMAIL')
        setPlatform(data.platform ?? null)
        setSubject(data.subject ?? null)
        setUnreadCutoff(data.lastReadAt ?? null)
        setContactName(data.contactName ?? null)
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
      // Dicatat supaya efek di bawah -- yang mengurus PERGANTIAN pesan sorot -- tidak
      // menggulung ke elemen yang sama sekali lagi pada pemasangan pertama.
      lastFocusScrolledRef.current = focusMessageId ?? null
      return
    }
    const target = unreadDividerRef.current ?? bottomRef.current
    target?.scrollIntoView({ block: unreadDividerRef.current ? 'start' : 'end' })
  }, [messagesLoaded, detailLoaded])

  // Dua notifikasi gap di percakapan yang SAMA adalah kasus biasa, bukan pengecualian. Thread-
  // nya tidak dipasang ulang saat itu terjadi (ThreadView di-key pada conversationId, bukan
  // pesan), dan gulungan pertama di atas sudah terkunci `hasScrolledRef`. Tanpa efek ini
  // notifikasi kedua hanya memindahkan cincin sorot -- ke pesan yang bisa berada jauh di luar
  // layar, yang bagi operator tidak bisa dibedakan dari tombol yang tidak berfungsi.
  useEffect(() => {
    if (!focusMessageId || !messagesLoaded) return
    if (lastFocusScrolledRef.current === focusMessageId) return
    lastFocusScrolledRef.current = focusMessageId
    focusRef.current?.scrollIntoView({ block: 'center' })
  }, [focusMessageId, messagesLoaded])

  // Pindah dari ComposeBox: tombolnya sekarang di header (dekat nama kontak), bukan di dasar
  // kolom pesan, jadi state botEnabled yang sudah ada di ThreadView bisa diubah langsung tanpa
  // lewat prop callback lagi. Baris error di bawah header (dulu punya "Belum ditugaskan") dipakai
  // ulang untuk ini, bukan dihapus -- kegagalan tetap butuh tempat terlihat.
  async function toggleDryRun() {
    setBotToggleError(null)
    try {
      const { dryRun: newValue } = await fetchJson<{ dryRun: boolean }>(`/api/conversations/${conversationId}/dry-run`, {
        method: 'POST',
        body: JSON.stringify({ enabled: !dryRun }),
      })
      setDryRun(newValue)
    } catch {
      setBotToggleError('Gagal mengubah mode uji')
    }
  }

  async function toggleBot() {
    setBotToggleError(null)
    try {
      const { botEnabled: newValue } = await fetchJson<{ botEnabled: boolean }>(
        `/api/conversations/${conversationId}/toggle-bot`,
        { method: 'POST' }
      )
      setBotEnabled(newValue)
    } catch {
      setBotToggleError('Gagal mengambil alih dari bot')
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

  /** Task 5: draft baru dibuat/diedit/dibuat-ulang -- ganti `draft` pada pesan sumbernya saja. */
  function handleDraftChange(messageId: string, draft: MessageDraftView) {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, draft } : m)))
  }

  /**
   * Task 5: draft terkirim -- ganti `draft` pada pesan sumber DAN masukkan pesan yang baru
   * terkirim, menggantikan yang sudah masuk lewat SSE (message.created bisa mendahului
   * respons POST .../draft/send ini, sama seperti race ComposeBox yang sudah ada) atau
   * menambahkannya kalau belum.
   */
  function handleDraftSent(messageId: string, draft: MessageDraftView, sent: MessageView) {
    setMessages((prev) => upsertSentMessage(prev.map((m) => (m.id === messageId ? { ...m, draft } : m)), sent))
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
        setMessages((prev) =>
          prev.map((m) => (m.id === event.message.id ? withPreservedDraftFields(m, event.message) : m))
        )
      }
      // inbound.ts flips conversation.botEnabled to false server-side the moment the bot hands
      // off -- broadcasting this alert is the ONLY signal of that, since it happens without any
      // click in THIS browser tab. Without syncing local state to it, an agent who had just
      // manually re-activated the bot for this one chat (see the header's "Aktifkan Bot untuk
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
      if (event.type === 'knowledge.gap' && event.conversationId === conversationId) {
        fetchMessages(conversationId)
          .then(setMessages)
          .catch(() => {})
      }
    }
    return () => es.close()
  }, [conversationId])

  // Target draft otomatis (`&draft=1`) dikunci per pesan fokus, dihitung sekali begitu pesan
  // termuat: pesan pelanggan baru yang masuk lewat SSE sesudahnya tidak memindahkan target dan
  // tidak memicu draft kedua. Pesan fokus lain (tautan Balas lain di percakapan yang sama)
  // menghitung ulang. Penyesuaian di fase render, pola yang sama dengan `urlKey` di inbox/page.
  const [autoDraftLock, setAutoDraftLock] = useState<{ focusId: string; target: AutoDraftTarget } | null>(null)
  if (autoDraft && focusMessageId && messagesLoaded && autoDraftLock?.focusId !== focusMessageId) {
    setAutoDraftLock({ focusId: focusMessageId, target: autoDraftTarget(messages, focusMessageId) })
  }
  const lockedTarget = autoDraft && autoDraftLock && autoDraftLock.focusId === focusMessageId ? autoDraftLock.target : null
  const autoDraftMessageId = lockedTarget?.kind === 'target' ? lockedTarget.messageId : null

  // -1 (never renders) when the conversation has never been read before -- everything being
  // "unread" on a first-ever open isn't a useful signal, only a boundary that moved is.
  const firstUnreadIndex = unreadCutoff
    ? messages.findIndex((m) => m.direction === 'INBOUND' && new Date(m.createdAt) > new Date(unreadCutoff))
    : -1

  const displayName = contactDisplayName(contactName, bookingGuestName(bookingData), 'Tanpa nama')
  const subtitle = [
    platform ? PLATFORM_LABEL[platform as keyof typeof PLATFORM_LABEL] ?? platform : 'WhatsApp',
    bookingData?.booking_number ?? null,
  ].filter(Boolean).join(' · ')

  return (
    // Kolom tengah .inbox (desain artifact): kepala tetap, riwayat yang menggulung sendiri, kotak tulis di bawah.
    <div className="col" id="i-chat" role="region" aria-label="Percakapan">
      <div className="chead">
        {onBack && (
          // Hanya tampil di ponsel (CSS .mback): di sana daftar percakapan tergantikan oleh thread ini.
          <button type="button" className="mback" aria-label="Kembali ke daftar percakapan" onClick={onBack}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
          </button>
        )}
        <div className="av" aria-hidden="true">{nameInitials(contactName || displayName)}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <b style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</b>
          <div className="mut sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isEmail && subject ? subject : subtitle}
          </div>
          {isTest && <div className="sm" style={{ color: 'var(--warn)' }}>Room Tes -- tidak terkirim ke WhatsApp</div>}
          {dryRun && <div className="sm" style={{ color: 'var(--warn)' }}>Mode uji -- tidak ada yang terkirim ke WhatsApp</div>}
        </div>
        {isTest && (
          <button type="button" className="btn sm bad" onClick={clearChat} disabled={clearingChat}>
            {clearingChat ? 'Menghapus...' : 'Hapus Chat'}
          </button>
        )}
        {canDryRun && (
          <button type="button" className={'btn sm' + (dryRun ? ' bad' : '')} onClick={toggleDryRun}>
            {dryRun ? 'Matikan mode uji' : 'Mode uji tanpa WA'}
          </button>
        )}
        {/* Bot tidak pernah menjawab email (D1) -- sakelar bot tidak berarti apa-apa di sana. */}
        {!isEmail && (
          <>
            <label className="sw" title="Bot untuk chat ini">
              <input type="checkbox" checked={botEnabled} aria-label="Bot aktif untuk chat ini" onChange={toggleBot} />
              <i />
            </label>
            <span className="sm mut" style={{ width: 62 }}>{botEnabled ? 'Bot aktif' : 'Manual'}</span>
          </>
        )}
        {onInfo && (
          <button type="button" className="minfo" aria-label="Info chat" onClick={onInfo}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
          </button>
        )}
      </div>
      {botToggleError && (
        <p role="alert" className="sm" style={{ margin: 0, padding: '6px 14px', background: 'var(--bad-bg)', color: 'var(--bad)' }}>
          {botToggleError}
        </p>
      )}
      {/* role="log": riwayat yang bertambah sendiri lewat SSE. */}
      <div role="log" aria-label="Riwayat pesan" className="msgs">
        {!messagesLoaded ? (
          <div className="mut" aria-hidden="true" style={{ padding: 8 }}>Memuat pesan…</div>
        ) : messages.length === 0 ? (
          <p className="mut" style={{ textAlign: 'center', padding: '32px 0', margin: 0 }}>
            Belum ada pesan di percakapan ini. Tulis yang pertama di bawah.
          </p>
        ) : null}
        {messages.map((m, i) => {
          const focused = m.id === focusMessageId
          return (
            <div
              key={m.id}
              id={threadMessageDomId(m.id)}
              ref={focused ? focusRef : undefined}
              className={focused ? 'flash' : undefined}
              style={focused ? { borderRadius: 14 } : undefined}
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
                autoOpenFix={focused && openFixOnFocus}
                autoGenerateDraft={m.id === autoDraftMessageId}
                onDraftChange={handleDraftChange}
                onDraftSent={handleDraftSent}
              />
              {focused && lockedTarget?.kind === 'no-text' && (
                // Sorotan tetap di pesan fokus; catatan ini menggantikan "tidak terjadi apa-apa".
                <p role="status" className="mut sm" style={{ margin: '4px 0 0' }}>
                  Tidak ada pesan teks dari pelanggan di sini untuk disusun draftnya — balas langsung dari kotak di bawah.
                </p>
              )}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
      <ComposeBox
        conversationId={conversationId}
        contactName={contactName}
        bookingData={bookingData}
        isTest={isTest}
        dryRun={dryRun}
        platform={platform}
        lastInboundAt={lastInboundAt(messages)}
        // Baru diteruskan setelah kedua permintaan selesai: sebelum itu platform dan pesan masuk
        // terakhir belum diketahui, dan keputusan template-atau-tidak akan dibuat dari kekosongan.
        followUp={followUp && messagesLoaded && detailLoaded}
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
      />
    </div>
  )
}
