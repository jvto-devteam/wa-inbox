'use client'
import { useState } from 'react'
import { Bot, Brain, Copy, CornerUpLeft, Film, Image as ImageIcon, Paperclip, Tag, Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'
import { BotTracePopover } from './BotTracePopover'
import { FixAnswerPanel } from './FixAnswerPanel'
import { isHandoffLogMessage, HANDOFF_LOG_SUMMARY } from '@/lib/message-display'
import { formatWhatsAppText } from '@/lib/whatsapp-format'
import { fetchJson } from '@/lib/fetch-json'
import type { BotDecision } from '@/lib/bot/types'
import type { TopicLabels } from '@/lib/inbox/topic-labels-schema'
import { jobLabelName, topicLabelName } from '@/lib/inbox/label-names'

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
}

export const SENDER_LABEL: Record<string, string> = { CUSTOMER: 'Pelanggan', BOT: 'Bot', AGENT: 'Agen' }

function quotedPreviewLabel(replyTo: NonNullable<MessageView['replyTo']>): string {
  if (replyTo.content) return replyTo.content
  return replyTo.type && replyTo.type !== 'text' ? `[${replyTo.type}]` : ''
}

/** The small quoted-message box WhatsApp shows atop a reply, sourced from Message.replyTo. */
function QuotedPreview({ replyTo }: { replyTo: NonNullable<MessageView['replyTo']> }) {
  return (
    <div className="mb-1.5 rounded-sm border-l-2 border-ink/25 bg-ink/5 px-2 py-1 text-xs">
      <p className="font-medium text-ink">{SENDER_LABEL[replyTo.sentBy] ?? replyTo.sentBy}</p>
      <p className="truncate text-ink-muted">{formatWhatsAppText(quotedPreviewLabel(replyTo))}</p>
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
    <>
      <Badge variant="brand">{topicLabelName(labels.topic)}</Badge>
      {labels.alsoTopics.map((topic) => (
        <Badge key={topic} variant="muted">
          {topicLabelName(topic)}
        </Badge>
      ))}
      <Badge variant="default">{jobLabelName(labels.job)}</Badge>
      {labels.topicSource === 'regex_fallback' && <span className="italic">perkiraan</span>}
    </>
  )
}

const CHANNEL_LABEL: Record<string, string> = { OFFICIAL: 'Official', UNOFFICIAL: 'Unofficial' }

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
}

// WhatsApp-style receipt ticks for an OUTBOUND message's current deliveryStatus.
// A single tick means Meta/wa-coexist has accepted the send (SENT); a second tick
// means the recipient's device got it (DELIVERED); both tick blue once the
// recipient has actually opened it (READ). FAILED is handled by the caller
// (a destructive badge + retry button, not a tick).
//
// Ikonnya SELALU didampingi katanya (lihat DELIVERY_LABEL di bawah). Satu centang, dua
// centang, dan dua centang biru adalah konvensi WhatsApp yang dihafal, bukan yang dibaca --
// dan "dihafal" berarti setiap operator baru menebak selama beberapa hari pertama. Kata di
// sebelahnya menghapus tebakan itu tanpa mengubah ikon yang sudah dikenal orang lama.
const DELIVERY_LABEL: Record<string, string> = {
  PENDING: 'Mengantre',
  SENT: 'Terkirim',
  DELIVERED: 'Diterima',
  READ: 'Dibaca',
}

function DeliveryTicks({ status }: { status: string }) {
  if (status === 'PENDING') return null
  const isRead = status === 'READ'
  const isDouble = status === 'DELIVERED' || status === 'READ'
  const label = DELIVERY_LABEL[status] ?? status
  return (
    <svg
      role="img"
      aria-label={label}
      width={isDouble ? 18 : 12}
      height="12"
      viewBox={`0 0 ${isDouble ? 18 : 12} 12`}
      // READ memakai aksen, bukan biru langit dari palet lain. Ini satu-satunya pemakaian
      // aksen di luar tiga yang disebut sistem desain, dan disengaja: centang biru "sudah
      // dibaca" adalah satu-satunya tanda di layar ini yang sudah punya arti bawaan bagi
      // siapa pun yang pernah memakai WhatsApp.
      className={isRead ? 'text-accent' : 'text-ink-subtle'}
      fill="none"
    >
      <path d="M1 6.5L4 9.5L11 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {isDouble && (
        <path d="M6 6.5L9 9.5L16 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  )
}

/** Ikon + kata, untuk semua status non-gagal sebuah pesan keluar. */
function DeliveryStatus({ status }: { status: string }) {
  const label = DELIVERY_LABEL[status]
  if (!label) return null
  return (
    <span className={cn('flex items-center gap-1', status === 'READ' ? 'text-accent' : 'text-ink-subtle')}>
      <DeliveryTicks status={status} />
      {label}
    </span>
  )
}

export function MessageBubble({
  message,
  onReply,
  conversationId,
  autoOpenFix,
}: {
  message: MessageView
  onReply?: (message: MessageView) => void
  /** Dibutuhkan route "Cek topik"; tanpa ini ikonnya tidak tampil. */
  conversationId?: string
  /** Dipakai saat operator tiba dari notifikasi gap: panel perbaikan terbuka tanpa satu klik lagi. */
  autoOpenFix?: boolean
}) {
  // Declared before the handoff-log early return below so every render calls the same hooks
  // in the same order (Rules of Hooks) -- unused in that branch, which is fine.
  const [showTrace, setShowTrace] = useState(false)
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
      <div className="flex w-full flex-col items-center gap-1">
        <div className="flex w-full items-center gap-2">
          <div className="h-px flex-1 bg-line" />
          <button
            type="button"
            onClick={() => setShowTrace((prev) => !prev)}
            className="focus-ring cursor-pointer rounded-sm border border-line bg-surface px-2 py-0.5 text-xs font-medium text-ink-muted hover:border-line-strong hover:text-ink"
          >
            {HANDOFF_LOG_SUMMARY}
          </button>
          <div className="h-px flex-1 bg-line" />
        </div>
        {showTrace && (
          <BotTracePopover
            trace={(message.botTrace as BotDecision | null) ?? null}
            messageId={message.id}
            onClose={() => setShowTrace(false)}
          />
        )}
      </div>
    )
  }

  const isOutbound = message.direction === 'OUTBOUND'
  const isFailed = message.deliveryStatus === 'FAILED'
  // Every BOT message gets the trigger, not just the ones that happen to carry a botTrace
  // (guidebook §12). A bot reply with no stored trace is precisely the case an agent most
  // needs an answer for, and hiding the button there left them with no way to ask -- the
  // popover now says "Trace tidak tersedia untuk pesan ini" instead of silently not existing.
  const isBotMessage = message.sentBy === 'BOT'
  const hasMedia = Boolean(message.mediaUrl)
  const cards = message.templatePayload?.cards
  const topicLabels = message.topicLabels ?? checkedLabels
  const canCheckTopic = !isOutbound && !topicLabels && Boolean(conversationId && message.content?.trim())
  const canCopyBotReply = isBotMessage && Boolean(message.content?.trim())

  return (
    // `group`: aksi balas hanya muncul saat baris ini di-hover atau salah satu kontrolnya
    // menerima fokus keyboard. Sebuah tombol tetap di bawah setiap gelembung mengubah riwayat
    // percakapan jadi daftar tombol; di layar sentuh (yang tidak punya hover) ia tetap terlihat.
    <div className={cn('group flex flex-col gap-1', isOutbound ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          cards?.length ? 'max-w-lg' : 'max-w-md',
          // text-md (15px), bukan ukuran UI 13.5px: isi pesan adalah satu-satunya teks di
          // aplikasi ini yang dibaca berparagraf-paragraf, berjam-jam, setiap hari.
          'overflow-hidden rounded-lg border px-3.5 py-2.5 text-md whitespace-pre-wrap',
          // Masuk vs keluar dibedakan oleh warna dan sudut yang dipangkas, bukan oleh bayangan:
          // keluar = tint aksen dengan sudut kanan atas rata, masuk = putih dengan sudut kiri
          // atas rata. Dua-duanya bergaris rambut, jadi keduanya tetap terbaca di atas canvas.
          isOutbound
            ? 'rounded-tr-none border-accent/20 bg-accent-subtle text-ink'
            : 'rounded-tl-none border-line bg-surface text-ink'
        )}
      >
        {message.replyTo && <QuotedPreview replyTo={message.replyTo} />}
        <div className="flex flex-col gap-1.5">
          {message.templatePayload?.limitedTimeOffer && (
            <LimitedTimeOfferBanner offer={message.templatePayload.limitedTimeOffer} />
          )}
          {hasMedia && <MediaContent message={message} />}
          {message.content ? (
            <span className="select-text cursor-text">{formatWhatsAppText(message.content)}</span>
          ) : (
            !hasMedia && message.type && message.type !== 'text' && `[${message.type}]`
          )}
          {cards && cards.length > 0 && <CarouselContent cards={cards} />}
          {message.templatePayload?.coupon && <CouponChip coupon={message.templatePayload.coupon} />}
        </div>
      </div>
      {isBotMessage && showTrace && (
        <BotTracePopover
          trace={(message.botTrace as BotDecision | null) ?? null}
          messageId={message.id}
          onClose={() => setShowTrace(false)}
        />
      )}
      {isBotMessage && showFix && (
        <FixAnswerPanel
          messageId={message.id}
          trace={(message.botTrace as BotDecision | null) ?? null}
          replyText={message.content}
          onClose={() => setShowFix(false)}
        />
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-subtle">
        {message.sentBy === 'BOT' && (
          <Badge variant="default" className="gap-1">
            <Bot aria-hidden="true" className="size-3" strokeWidth={1.75} />
            Bot
          </Badge>
        )}
        {/* Dedicated trigger for the reasoning trace, separate from the bubble itself -- clicking
            the message text/media should never be overloaded with an unrelated toggle. */}
        {isBotMessage && (
          <IconButton
            size="sm"
            label={showTrace ? 'Sembunyikan alasan bot' : 'Lihat alasan bot'}
            icon={<Brain strokeWidth={1.75} />}
            aria-pressed={showTrace}
            onClick={() => setShowTrace((prev) => !prev)}
            className="-my-1"
          />
        )}
        {isBotMessage && (
          <IconButton
            size="sm"
            label="Perbaiki jawaban bot"
            icon={<Wrench strokeWidth={1.75} />}
            onClick={() => setShowFix(true)}
            className="-my-1"
          />
        )}
        {canCopyBotReply && (
          <IconButton
            size="sm"
            label="Salin balasan bot"
            icon={<Copy strokeWidth={1.75} />}
            onClick={() => {
              void copyBotReply().catch(() => {})
            }}
            className="-my-1"
          />
        )}
        {message.sentBy === 'AGENT' && <span>Agen</span>}
        {message.templatePayload && <Badge variant="muted">Template</Badge>}
        {/* Only outbound: which channel WE sent through is useful to an agent; which channel a
            customer's own inbound message happened to arrive on is not. */}
        {isOutbound && CHANNEL_LABEL[message.channel] && <Badge variant="muted">{CHANNEL_LABEL[message.channel]}</Badge>}
        {!isOutbound && topicLabels && <TopicChips labels={topicLabels} />}
        {canCheckTopic && (
          <IconButton
            size="sm"
            label={checkingTopic ? 'Memeriksa topik...' : 'Cek topik'}
            icon={<Tag strokeWidth={1.75} />}
            onClick={checkTopic}
            disabled={checkingTopic}
            className="-my-1"
          />
        )}
        {topicError && (
          <span role="alert" className="text-danger">
            {topicError}
          </span>
        )}
        <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
        {isFailed ? (
          <>
            {/* "FAILED" adalah nama kolom database, bukan kalimat. Operator yang melihat baris
                merah ini sedang memutuskan apakah pelanggannya menerima pesan itu atau tidak. */}
            <Badge variant="destructive">Gagal terkirim</Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={retrySend}
              disabled={retrying}
              aria-label="Kirim ulang"
            >
              {retrying ? 'Mengirim ulang...' : 'Kirim ulang'}
            </Button>
            {retryError && (
              <span role="alert" className="text-danger">
                {retryError}
              </span>
            )}
          </>
        ) : (
          isOutbound && <DeliveryStatus status={message.deliveryStatus} />
        )}
        {onReply && (
          <IconButton
            size="sm"
            label="Balas pesan ini"
            icon={<CornerUpLeft strokeWidth={1.75} />}
            onClick={() => onReply(message)}
            className="-my-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
          />
        )}
      </div>
    </div>
  )
}
