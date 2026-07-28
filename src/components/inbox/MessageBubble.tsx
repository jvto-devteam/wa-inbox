'use client'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BotTracePopover } from './BotTracePopover'
import { isHandoffLogMessage, HANDOFF_LOG_TEXT } from '@/lib/message-display'
import { formatWhatsAppText } from '@/lib/whatsapp-format'
import type { BotDecision } from '@/lib/bot/types'

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
  templatePayload?: {
    templateName: string
    bodyText: string
    cards?: Array<{
      mediaType: 'IMAGE' | 'VIDEO'
      mediaUrl: string
      bodyText: string
      buttons: Array<{ type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url?: string; phoneNumber?: string }>
    }>
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
    <div className="mb-1.5 rounded border-l-2 border-brand bg-black/5 px-2 py-1 text-xs">
      <p className="font-medium text-brand">{SENDER_LABEL[replyTo.sentBy] ?? replyTo.sentBy}</p>
      <p className="truncate text-muted-foreground">{formatWhatsAppText(quotedPreviewLabel(replyTo))}</p>
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
      className="flex aspect-4/3 w-full flex-col items-center justify-center gap-1 rounded-md bg-black/5 text-sm text-muted-foreground hover:bg-black/10"
    >
      <span className="text-2xl">{kind === 'image' ? '🖼️' : '🎞️'}</span>
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
          className="flex items-center gap-1.5 text-brand underline"
        >
          📎 {message.fileName ?? 'Dokumen'}
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
        <div key={i} className="w-48 shrink-0 overflow-hidden rounded-md border border-border bg-white shadow-sm">
          {card.mediaType === 'VIDEO' ? (
            <video src={card.mediaUrl} controls className="h-28 w-full object-cover" />
          ) : (
            <img src={card.mediaUrl} alt={card.bodyText} className="h-28 w-full object-cover" />
          )}
          <div className="flex flex-col gap-2 p-2">
            <p className="text-xs text-foreground">{formatWhatsAppText(card.bodyText)}</p>
            {card.buttons.length > 0 && (
              <div className="flex flex-col gap-1">
                {card.buttons.map((b, bi) =>
                  b.type === 'URL' ? (
                    <a
                      key={bi}
                      href={b.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded border border-border py-1 text-center text-[11px] text-brand hover:bg-secondary"
                    >
                      {b.text}
                    </a>
                  ) : (
                    <span key={bi} className="rounded border border-border py-1 text-center text-[11px] text-muted-foreground">
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

const CHANNEL_LABEL: Record<string, string> = { OFFICIAL: 'Official', UNOFFICIAL: 'Unofficial' }

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
}

// WhatsApp-style receipt ticks for an OUTBOUND message's current deliveryStatus.
// A single tick means Meta/wa-coexist has accepted the send (SENT); a second tick
// means the recipient's device got it (DELIVERED); both tick blue once the
// recipient has actually opened it (READ). FAILED and the initial PENDING state
// are handled by the caller (a destructive badge + retry button, not a tick) so
// this only ever needs to render for the three "in flight or done" states.
function DeliveryTicks({ status }: { status: string }) {
  if (status === 'PENDING') return null
  const isRead = status === 'READ'
  const isDouble = status === 'DELIVERED' || status === 'READ'
  const label = status === 'SENT' ? 'Terkirim' : status === 'DELIVERED' ? 'Diterima' : 'Dibaca'
  return (
    <svg
      role="img"
      aria-label={label}
      width={isDouble ? 18 : 12}
      height="12"
      viewBox={`0 0 ${isDouble ? 18 : 12} 12`}
      className={isRead ? 'text-sky-500' : 'text-muted-foreground'}
      fill="none"
    >
      <path d="M1 6.5L4 9.5L11 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {isDouble && (
        <path d="M6 6.5L9 9.5L16 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  )
}

export function MessageBubble({ message, onReply }: { message: MessageView; onReply?: (message: MessageView) => void }) {
  const isOutbound = message.direction === 'OUTBOUND'
  const isFailed = message.deliveryStatus === 'FAILED'
  const hasTrace = message.sentBy === 'BOT' && Boolean(message.botTrace)
  // A handoff decision is logged (Task 34) as a Message row with content: null, sentBy: 'BOT' --
  // no real reply was ever sent to the customer. Without this, the bubble renders empty, which
  // reads as "the bot sent something and it's broken" rather than "the bot silently handed off".
  const isHandoffLog = isHandoffLogMessage(message)
  const hasMedia = Boolean(message.mediaUrl)
  const cards = message.templatePayload?.cards
  const [showTrace, setShowTrace] = useState(false)

  return (
    <div className={`flex flex-col gap-1 ${isOutbound ? 'items-end' : 'items-start'}`}>
      <div
        role={hasTrace ? 'button' : undefined}
        tabIndex={hasTrace ? 0 : undefined}
        onClick={hasTrace ? () => setShowTrace((prev) => !prev) : undefined}
        onKeyDown={
          hasTrace
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setShowTrace((prev) => !prev)
                }
              }
            : undefined
        }
        className={
          (cards?.length ? 'max-w-lg' : 'max-w-md') +
          ' overflow-hidden whitespace-pre-wrap rounded-lg px-3.5 py-2.5 ring-1 ' +
          (isOutbound ? 'rounded-tr-none bg-accent ring-brand/10' : 'rounded-tl-none bg-white shadow-sm ring-border')
        }
      >
        {!isHandoffLog && message.replyTo && <QuotedPreview replyTo={message.replyTo} />}
        {isHandoffLog ? (
          <span className="italic text-muted-foreground">{HANDOFF_LOG_TEXT}</span>
        ) : (
          <div className="flex flex-col gap-1.5">
            {hasMedia && <MediaContent message={message} />}
            {message.content ? (
              <span>{formatWhatsAppText(message.content)}</span>
            ) : (
              !hasMedia && message.type && message.type !== 'text' && `[${message.type}]`
            )}
            {cards && cards.length > 0 && <CarouselContent cards={cards} />}
          </div>
        )}
      </div>
      {hasTrace && showTrace && <BotTracePopover trace={message.botTrace as BotDecision} />}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        {message.sentBy === 'BOT' && <Badge variant="brand">Bot</Badge>}
        {message.sentBy === 'AGENT' && <span>Agen</span>}
        {message.templatePayload && <Badge variant="muted">Template</Badge>}
        {/* Only outbound: which channel WE sent through is useful to an agent; which channel a
            customer's own inbound message happened to arrive on is not. */}
        {isOutbound && CHANNEL_LABEL[message.channel] && <Badge variant="muted">{CHANNEL_LABEL[message.channel]}</Badge>}
        <span>{formatTime(message.createdAt)}</span>
        {isFailed ? (
          <>
            <Badge variant="destructive">{message.deliveryStatus}</Badge>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Kirim ulang"
              className="h-auto px-0 text-brand hover:bg-transparent hover:underline"
            >
              Kirim Ulang
            </Button>
          </>
        ) : (
          isOutbound && <DeliveryTicks status={message.deliveryStatus} />
        )}
        {!isHandoffLog && onReply && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Balas pesan ini"
            className="h-auto px-0 text-muted-foreground hover:bg-transparent hover:text-brand hover:underline"
            onClick={() => onReply(message)}
          >
            Balas
          </Button>
        )}
      </div>
    </div>
  )
}
