'use client'
import { useEffect, useRef, useState } from 'react'
import { Film, Image as ImageIcon, Paperclip } from 'lucide-react'
import { BotTracePopover } from './BotTracePopover'
import { FixAnswerPanel } from './FixAnswerPanel'
import { isHandoffLogMessage, HANDOFF_LOG_SUMMARY } from '@/lib/message-display'
import { formatWhatsAppText } from '@/lib/whatsapp-format'
import { fetchJson } from '@/lib/fetch-json'
import type { BotDecision } from '@/lib/bot/types'
import type { TopicLabels } from '@/lib/inbox/topic-labels-schema'
import { jobLabelName, topicLabelName } from '@/lib/inbox/label-names'
import { knowledgeGapLabel } from '@/lib/inbox/gap-labels'
import { MessageDraftCard } from './MessageDraftCard'
import type { MessageDraftView } from '@/lib/inbox/message-draft-view'
import { isDraftableText } from '@/lib/inbox/draft-target'

export type MessageView = {
  id: string
  direction: 'INBOUND' | 'OUTBOUND'
  content: string | null
  channel: string
  sentBy: string
  deliveryStatus: string
  createdAt: string
  botTrace: unknown
  // Optional (rather than required) so every existing call site/test fixture built
  // before media support keeps compiling -- the API always sends these now, but a
  // message with none of them is just a plain text message, same as before.
  type?: string
  mediaUrl?: string | null
  mimeType?: string | null
  fileName?: string | null
  replyTo?: { id: string; content: string | null; type: string; sentBy: string } | null
  knowledgeGap?: {
    id: string
    topic: string
    reason: string
    messageText: string
    missingQuestion?: string | null
    answerSnippet?: string | null
    answerParagraph?: number | null
    createdAt: string
  } | null
  topicLabels?: TopicLabels | null
  templatePayload?: {
    templateName: string
    bodyText: string
    cards?: Array<{
      mediaType: 'IMAGE' | 'VIDEO'
      mediaUrl: string
      bodyText: string
      buttons: Array<{ type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url?: string; phoneNumber?: string }>
    }>
    // LTO/COUPON: the real per-send values that were actually used, snapshotted at send time
    // (see src/app/api/send/template/route.ts) -- never the template's own submission-time
    // has_expiration boolean or example code.
    limitedTimeOffer?: { text: string; expirationTimeMs: number }
    coupon?: { buttonText: string; code: string }
  } | null
  /** Task 5: draft jawaban bot yang menunggu di pesan masuk ini, kalau sudah dibuat. */
  draft?: MessageDraftView | null
  /** true pada pesan keluar yang dikirim lewat "Kirim pesan" di MessageDraftCard, bukan
   *  ComposeBox biasa -- dipakai untuk memperlakukannya seperti balasan bot (tombol alasan
   *  bot, indikator gap, FixAnswerPanel) walau `sentBy` tetap 'AGENT'. */
  fromDraft?: boolean
}

export const SENDER_LABEL: Record<string, string> = { CUSTOMER: 'Pelanggan', BOT: 'Bot', AGENT: 'Agen' }

function quotedPreviewLabel(replyTo: NonNullable<MessageView['replyTo']>): string {
  if (replyTo.content) return replyTo.content
  return replyTo.type && replyTo.type !== 'text' ? `[${replyTo.type}]` : ''
}

/** The small quoted-message box WhatsApp shows atop a reply, sourced from Message.replyTo. */
function QuotedPreview({ replyTo }: { replyTo: NonNullable<MessageView['replyTo']> }) {
  return (
    <div className="mq">
      <b>{SENDER_LABEL[replyTo.sentBy] ?? replyTo.sentBy}</b>
      <span>{formatWhatsAppText(quotedPreviewLabel(replyTo))}</span>
    </div>
  )
}

/**
 * A `<img>`/`<video>` fetches its full bytes the instant it's in the DOM -- unlike audio/video's
 * own default `preload="metadata"`, an `<img>` has no lazy/on-demand mode at all. With every
 * thread showing every image inline, that's a real, unbounded fetch (Official: a Graph API
 * resolve + download through the /api/media proxy on every render; Unofficial: a full request
 * to wherever the file lives) for media the agent may never actually need to look at closely.
 * Gating it behind an explicit tap -- same as WhatsApp's own default media behavior -- means the
 * fetch only happens when someone actually wants to see it.
 */
function LazyMedia({ url, alt, kind }: { url: string; alt: string; kind: 'image' | 'video' }) {
  const [revealed, setRevealed] = useState(false)

  if (revealed) {
    return kind === 'image' ? (
      <img src={url} alt={alt} className="h-auto w-full rounded-md" />
    ) : (
      <video src={url} controls className="h-auto w-full rounded-md" />
    )
  }
  return (
    <button
      type="button"
      onClick={() => setRevealed(true)}
      className="focus-ring flex aspect-4/3 w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-line-strong bg-surface-sunken text-sm text-ink-muted transition-colors hover:border-accent hover:text-ink"
    >
      {kind === 'image' ? (
        <ImageIcon aria-hidden="true" className="size-5" strokeWidth={1.5} />
      ) : (
        <Film aria-hidden="true" className="size-5" strokeWidth={1.5} />
      )}
      <span>Ketuk untuk memuat {kind === 'image' ? 'gambar' : 'video'}</span>
    </button>
  )
}

/** Renders an inbound/outbound image, audio, video, or document inline. */
function MediaContent({ message }: { message: MessageView }) {
  if (!message.mediaUrl) return null
  switch (message.type) {
    case 'image':
      return <LazyMedia url={message.mediaUrl} alt={message.content ?? 'Gambar'} kind="image" />
    case 'video':
      return <LazyMedia url={message.mediaUrl} alt={message.content ?? 'Video'} kind="video" />
    case 'audio':
      return <audio src={message.mediaUrl} controls className="w-full" />
    case 'document':
      return (
        <a
          href={message.mediaUrl}
          target="_blank"
          rel="noreferrer"
          className="focus-ring flex items-center gap-1.5 rounded-sm border border-line bg-surface px-2 py-1.5 text-sm text-ink hover:border-line-strong hover:bg-surface-sunken"
        >
          <Paperclip aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" strokeWidth={1.75} />
          <span className="min-w-0 truncate">{message.fileName ?? 'Dokumen'}</span>
        </a>
      )
    default:
      return null
  }
}

type CarouselCards = NonNullable<NonNullable<MessageView['templatePayload']>['cards']>

/**
 * Renders a sent carousel template's cards exactly as WhatsApp shows them: a horizontally
 * scrollable row of media + body + buttons. Sourced from Message.templatePayload, snapshotted
 * at send time, so this stays accurate even if the originating Template row is later edited.
 * Buttons are inert here (this is a read-only history view, not the customer's own WhatsApp
 * client) except URL buttons, which are real, clickable links.
 */
function CarouselContent({ cards }: { cards: CarouselCards }) {
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {cards.map((card, i) => (
        <div key={i} className="w-48 shrink-0 overflow-hidden rounded-md border border-line bg-surface">
          {card.mediaType === 'VIDEO' ? (
            <video src={card.mediaUrl} controls className="h-28 w-full object-cover" />
          ) : (
            <img src={card.mediaUrl} alt={card.bodyText} className="h-28 w-full object-cover" />
          )}
          <div className="flex flex-col gap-2 p-2">
            <p className="text-xs text-ink">{formatWhatsAppText(card.bodyText)}</p>
            {card.buttons.length > 0 && (
              <div className="flex flex-col gap-1">
                {card.buttons.map((b, bi) =>
                  b.type === 'URL' ? (
                    <a
                      key={bi}
                      href={b.url}
                      target="_blank"
                      rel="noreferrer"
                      className="focus-ring rounded-sm border border-line py-1 text-center text-[11px] font-medium text-accent hover:bg-surface-sunken"
                    >
                      {b.text}
                    </a>
                  ) : (
                    <span key={bi} className="rounded-sm border border-line py-1 text-center text-[11px] text-ink-subtle">
                      {b.text}
                    </span>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/** The countdown banner WhatsApp shows atop an LTO template, sourced from Message.templatePayload. */
function LimitedTimeOfferBanner({ offer }: { offer: NonNullable<NonNullable<MessageView['templatePayload']>['limitedTimeOffer']> }) {
  const expires = new Date(offer.expirationTimeMs).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
  return (
    <div className="rounded-sm bg-warning-subtle px-2.5 py-1.5 text-xs font-medium text-warning">
      {offer.text} — berakhir {expires}
    </div>
  )
}

/** The coupon code chip WhatsApp shows on a COPY_CODE button template, sourced from Message.templatePayload. */
function CouponChip({ coupon }: { coupon: NonNullable<NonNullable<MessageView['templatePayload']>['coupon']> }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-sm border border-dashed border-line-strong bg-surface px-2.5 py-1.5 text-xs">
      <span className="font-mono font-semibold tracking-wide text-ink">{coupon.code}</span>
      <span className="text-ink-muted">{coupon.buttonText}</span>
    </div>
  )
}

/** Topik & intent satu pesan masuk. "perkiraan" = topik dari regex cadangan, bukan dari model. */
function TopicChips({ labels }: { labels: TopicLabels }) {
  return (
    <span className="mtopic">
      <span className="pill info">{topicLabelName(labels.topic)}</span>
      {labels.alsoTopics.map((topic) => (
        <span key={topic} className="pill neu">
          {topicLabelName(topic)}
        </span>
      ))}
      <span className="pill neu">{jobLabelName(labels.job)}</span>
      {labels.topicSource === 'regex_fallback' && <i>perkiraan</i>}
    </span>
  )
}

const CHANNEL_LABEL: Record<string, string> = { OFFICIAL: 'Official', UNOFFICIAL: 'Unofficial' }

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
}

// Status kirim pesan keluar, ditulis sebagai kata di baris waktu gelembung (FAILED punya tanda + tombol sendiri).
const DELIVERY_LABEL: Record<string, string> = {
  PENDING: 'Mengantre',
  SENT: 'Terkirim',
  DELIVERED: 'Diterima',
  READ: 'Dibaca',
}

export function MessageBubble({
  message,
  onReply,
  conversationId,
  autoOpenFix,
  autoGenerateDraft,
  onDraftChange,
  onDraftSent,
}: {
  message: MessageView
  onReply?: (message: MessageView) => void
  /** Dibutuhkan route "Cek topik"; tanpa ini ikonnya tidak tampil. */
  conversationId?: string
  /** Dipakai saat operator tiba dari notifikasi gap: panel perbaikan terbuka tanpa satu klik lagi. */
  autoOpenFix?: boolean
  /**
   * Operator tiba dari "Balas" di antrean (`&draft=1`): alur "Generate draft" di bawah dipicu
   * sekali untuk pesan ini kalau draftnya belum ada. Hanya menyusun dan menampilkan.
   */
  autoGenerateDraft?: boolean
  /** Task 5: draft baru dibuat/diedit/dibuat-ulang -- ganti `draft` pada pesan sumber ini. */
  onDraftChange?: (messageId: string, draft: MessageDraftView) => void
  /** Task 5: draft terkirim -- ganti `draft` pada pesan sumber DAN masukkan pesan yang terkirim. */
  onDraftSent?: (messageId: string, draft: MessageDraftView, sent: MessageView) => void
}) {
  // Declared before the handoff-log early return below so every render calls the same hooks
  // in the same order (Rules of Hooks) -- unused in that branch, which is fine.
  const [showTrace, setShowTrace] = useState(false)
  // Posisi tombol panah saat menu aksi pesan terbuka; null = tertutup.
  const [menu, setMenu] = useState<DOMRect | null>(null)
  // Nilai awal, bukan efek: gelembung ini dirender ulang saat pesannya berubah, dan sebuah efek
  // akan membuka kembali panel yang baru saja ditutup operator.
  const [showFix, setShowFix] = useState(Boolean(autoOpenFix))
  // Phase 6: the "Kirim Ulang" button below shipped with no onClick at all -- it looked like a
  // working recovery path and did nothing. It now re-queues the message's outbound job.
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [checkedLabels, setCheckedLabels] = useState<TopicLabels | null>(null)
  const [checkingTopic, setCheckingTopic] = useState(false)
  const [topicError, setTopicError] = useState<string | null>(null)
  const [generatingDraft, setGeneratingDraft] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  // Pemicu otomatis `&draft=1` hanya boleh berjalan sekali per gelembung: render ulang (SSE,
  // tanda terima, draft yang baru tiba) atau parameter lain yang berubah tidak boleh menyusun
  // draft kedua. Kalau gagal, tombol "Generate draft" tetap ada untuk dicoba manual.
  const autoDraftTriggeredRef = useRef(false)

  const isOutbound = message.direction === 'OUTBOUND'
  // Aturan teks-yang-bisa-didraft ada di `isDraftableText` (dipakai juga ThreadView untuk memilih
  // target draft otomatis), supaya tombol dan pemicu otomatis tidak pernah berselisih.
  const canGenerateDraft = !isOutbound && isDraftableText(message) && Boolean(conversationId) && !message.draft

  async function retrySend() {
    if (retrying) return
    setRetrying(true)
    setRetryError(null)
    try {
      await fetchJson('/api/outbound-jobs/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: message.id }),
      })
      // No local state change on success: the worker broadcasts `message.updated` when the
      // attempt resolves, and the thread replaces this bubble from that. Optimistically
      // flipping to "sent" here would claim a delivery that has not happened yet.
    } catch (error: unknown) {
      setRetryError(error instanceof Error ? error.message : 'Gagal mengirim ulang')
    } finally {
      setRetrying(false)
    }
  }

  async function checkTopic() {
    if (checkingTopic || !conversationId) return
    setCheckingTopic(true)
    setTopicError(null)
    try {
      const data = await fetchJson<{ topicLabels: TopicLabels }>(
        `/api/conversations/${conversationId}/messages/${message.id}/topic-labels`,
        { method: 'POST' }
      )
      setCheckedLabels(data.topicLabels)
    } catch (error: unknown) {
      setTopicError(error instanceof Error ? error.message : 'Gagal memeriksa topik')
    } finally {
      setCheckingTopic(false)
    }
  }

  async function copyBotReply() {
    if (!message.content?.trim()) return
    await navigator.clipboard?.writeText(message.content)
  }

  // `ifAbsent` hanya dari pemicu otomatis: server mengembalikan draft yang sudah ada alih-alih
  // menyusun ulang, jadi editan operator yang belum terkirim tidak tertimpa. Tombol manual tetap
  // POST tanpa body (= buat ulang).
  async function generateDraft(opts: { ifAbsent?: boolean } = {}) {
    if (generatingDraft || !conversationId) return
    setGeneratingDraft(true)
    setDraftError(null)
    try {
      const draft = await fetchJson<MessageDraftView>(
        `/api/conversations/${conversationId}/messages/${message.id}/draft`,
        opts.ifAbsent
          ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ifAbsent: true }) }
          : { method: 'POST' }
      )
      onDraftChange?.(message.id, draft)
    } catch (error: unknown) {
      setDraftError(error instanceof Error ? error.message : 'Gagal membuat draft')
    } finally {
      setGeneratingDraft(false)
    }
  }

  // Sebelum early return log handoff di bawah (Rules of Hooks). Log handoff selalu OUTBOUND,
  // jadi `canGenerateDraft` sudah false di sana.
  useEffect(() => {
    if (!autoGenerateDraft || !canGenerateDraft || autoDraftTriggeredRef.current) return
    autoDraftTriggeredRef.current = true
    void generateDraft({ ifAbsent: true })
    // generateDraft sengaja tidak masuk dependensi: fungsinya dibuat ulang setiap render, dan
    // penjaga ref di atas yang memastikan pemicu ini hanya berjalan sekali.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerateDraft, canGenerateDraft])

  // A handoff decision is logged (Task 34) as a Message row with content: null, sentBy: 'BOT' --
  // no real reply was ever sent to the customer. Rendered as WhatsApp's own centered system
  // divider (the same line-text-line style as the "Pesan belum dibaca" marker in ThreadView),
  // not a chat bubble: no channel/sender badge, no timestamp, no delivery ticks, no reply
  // action -- none of those describe an actual message, so showing them here is just noise.
  // The reason IS worth surfacing though: an agent picking up a handoff wants to know why
  // without digging through settings/logs, so the divider itself is clickable and opens the
  // same BotTracePopover a real bot reply's 🧠 icon would.
  if (isHandoffLogMessage(message)) {
    return (
      <div className="mwrap" style={{ alignItems: 'center' }}>
        <button type="button" className="m s" onClick={() => setShowTrace((prev) => !prev)} style={{ border: 0 }}>
          {HANDOFF_LOG_SUMMARY}
        </button>
        {showTrace && (
          <div className="legacy-skin mlegacy">
            <BotTracePopover
              trace={(message.botTrace as BotDecision | null) ?? null}
              messageId={message.id}
              onClose={() => setShowTrace(false)}
            />
          </div>
        )}
      </div>
    )
  }

  const isFailed = message.deliveryStatus === 'FAILED'
  // Every BOT message gets the trigger, not just the ones that happen to carry a botTrace
  // (guidebook §12). A bot reply with no stored trace is precisely the case an agent most
  // needs an answer for, and hiding the button there left them with no way to ask -- the
  // popover now says "Trace tidak tersedia untuk pesan ini" instead of silently not existing.
  const isBotMessage = message.sentBy === 'BOT'
  // Task 5: pesan yang dikirim lewat "Kirim pesan" di MessageDraftCard -- sebuah balasan
  // seorang agen menulis SEBAGIAN dari draft bot. Untuk tombol alasan bot, indikator gap, dan
  // FixAnswerPanel ia diperlakukan seperti balasan bot; tombol salin (`canCopyBotReply` di
  // bawah) tetap hanya untuk BOT sungguhan -- lihat catatan di MessageView.fromDraft.
  const isFromDraft = Boolean(message.fromDraft) && message.sentBy === 'AGENT'
  const showsBotReasoning = isBotMessage || isFromDraft
  const hasMedia = Boolean(message.mediaUrl)
  const cards = message.templatePayload?.cards
  const topicLabels = message.topicLabels ?? checkedLabels
  const canCheckTopic = !isOutbound && !topicLabels && Boolean(conversationId && message.content?.trim())
  const canCopyBotReply = isBotMessage && Boolean(message.content?.trim())
  const knowledgeGap = showsBotReasoning ? message.knowledgeGap : null
  // Desain artifact: tamu = .m.g (putih, kiri), bot = .m.b, agen = .m.a (aksen, kanan).
  const kind = !isOutbound ? 'g' : isBotMessage ? 'b' : 'a'
  const meta = [
    isBotMessage ? 'Bot' : message.sentBy === 'AGENT' ? 'Agen' : null,
    formatTime(message.createdAt),
    isFromDraft ? 'Dari draft bot' : null,
    message.templatePayload ? 'Template' : null,
    // Only outbound: which channel WE sent through is useful to an agent.
    isOutbound ? CHANNEL_LABEL[message.channel] : null,
    isOutbound && !isFailed ? DELIVERY_LABEL[message.deliveryStatus] : null,
  ].filter(Boolean).join(' · ')

  const closeMenu = () => setMenu(null)
  const menuItem = (label: string, onClick: () => void, opts: { disabled?: boolean; danger?: boolean } = {}) => (
    <button
      type="button"
      role="menuitem"
      className={'mp-act' + (opts.danger ? '' : ' mp-neu')}
      disabled={opts.disabled}
      onClick={() => {
        closeMenu()
        onClick()
      }}
    >
      {label}
    </button>
  )

  return (
    <div className={'mwrap' + (isOutbound ? ' out' : '')}>
      <div
        className={'m ' + kind + ' hasmeta' + (knowledgeGap ? ' gap' : '')}
        title={knowledgeGap ? knowledgeGapLabel(knowledgeGap.reason) : undefined}
      >
        {message.replyTo && <QuotedPreview replyTo={message.replyTo} />}
        {message.templatePayload?.limitedTimeOffer && (
          <div className="legacy-skin mlegacy"><LimitedTimeOfferBanner offer={message.templatePayload.limitedTimeOffer} /></div>
        )}
        {hasMedia && <div className="legacy-skin mlegacy"><MediaContent message={message} /></div>}
        {message.content ? (
          <span className="mtext">{formatWhatsAppText(message.content)}</span>
        ) : (
          !hasMedia && message.type && message.type !== 'text' && `[${message.type}]`
        )}
        {cards && cards.length > 0 && <div className="legacy-skin mlegacy"><CarouselContent cards={cards} /></div>}
        {message.templatePayload?.coupon && <div className="legacy-skin mlegacy"><CouponChip coupon={message.templatePayload.coupon} /></div>}
        <small>
          {meta}
          {knowledgeGap ? ' · Ada gap knowledge' : ''}
        </small>
        <button
          type="button"
          className="mchev"
          aria-label="Aksi pesan"
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          onClick={(e) => {
            e.stopPropagation()
            const rect = e.currentTarget.getBoundingClientRect()
            setMenu((m) => (m ? null : rect))
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>
      {!isOutbound && topicLabels && <TopicChips labels={topicLabels} />}
      {menu && (
        <MessageMenu rect={menu} onClose={closeMenu}>
          {knowledgeGap && (
            <div className="mp-src">
              <div className="mp-h">Gap knowledge</div>
              <div className="mp-why">{knowledgeGapLabel(knowledgeGap.reason)}</div>
            </div>
          )}
          {onReply && menuItem('Balas pesan ini', () => onReply(message))}
          {showsBotReasoning && menuItem(showTrace ? 'Sembunyikan alasan bot' : 'Lihat alasan bot', () => setShowTrace((prev) => !prev))}
          {showsBotReasoning && menuItem('Tandai jawaban salah', () => setShowFix(true), { danger: true })}
          {canCopyBotReply && menuItem('Salin balasan bot', () => void copyBotReply().catch(() => {}))}
          {canGenerateDraft && menuItem(generatingDraft ? 'Menyusun draft...' : 'Generate draft', () => void generateDraft(), { disabled: generatingDraft })}
          {canCheckTopic && menuItem(checkingTopic ? 'Memeriksa topik...' : 'Cek topik', () => void checkTopic(), { disabled: checkingTopic })}
        </MessageMenu>
      )}
      {(generatingDraft || draftError || topicError) && (
        <p role={draftError || topicError ? 'alert' : 'status'} className="mnote">
          {draftError ?? topicError ?? 'Menyusun draft...'}
        </p>
      )}
      {isFailed && (
        <div className="mnote">
          <span className="pill bad">Gagal terkirim</span>
          <button type="button" className="btn sm" onClick={retrySend} disabled={retrying} aria-label="Kirim ulang">
            {retrying ? 'Mengirim ulang...' : 'Kirim ulang'}
          </button>
          {retryError && <span role="alert" style={{ color: 'var(--bad)' }}>{retryError}</span>}
        </div>
      )}
      {message.draft && conversationId && (
        <div className="legacy-skin mlegacy mwide">
          <MessageDraftCard
            draft={message.draft}
            conversationId={conversationId}
            messageId={message.id}
            onDraftChange={onDraftChange}
            onDraftSent={onDraftSent}
          />
        </div>
      )}
      {showsBotReasoning && showTrace && (
        <div className="legacy-skin mlegacy mwide">
          <BotTracePopover
            trace={(message.botTrace as BotDecision | null) ?? null}
            messageId={message.id}
            onFix={() => {
              setShowTrace(false)
              setShowFix(true)
            }}
            onClose={() => setShowTrace(false)}
          />
        </div>
      )}
      {showsBotReasoning && showFix && (
        <div className="legacy-skin mlegacy mwide">
          <FixAnswerPanel
            messageId={message.id}
            trace={(message.botTrace as BotDecision | null) ?? null}
            replyText={message.content}
            onClose={() => setShowFix(false)}
          />
        </div>
      )}
    </div>
  )
}

/** Menu aksi satu pesan (.mpop, desain artifact): melayang di dekat tombol panah, tertutup saat klik di luar/Escape/gulir. */
function MessageMenu({ rect, onClose, children }: { rect: DOMRect; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!t.closest('.mpop') && !t.closest('.mchev')) onClose()
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('click', close)
    document.addEventListener('keydown', esc)
    window.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', esc)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])
  const h = typeof window === 'undefined' ? 800 : window.innerHeight
  const w = typeof window === 'undefined' ? 1200 : window.innerWidth
  const top = rect.bottom + 6 + 220 > h ? Math.max(8, rect.top - 226) : rect.bottom + 6
  return (
    <div className="mpop" role="menu" style={{ right: Math.max(8, w - rect.right), top }} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  )
}
