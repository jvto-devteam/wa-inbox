import type { Message } from '@prisma/client'
import type { SentTemplatePayload } from '@/lib/meta/carousel-types'

export type ReplyToView = { id: string; content: string | null; type: string; sentBy: string }

export type MessageView = {
  id: string
  direction: string
  type: string
  content: string | null
  mediaUrl: string | null
  mimeType: string | null
  fileName: string | null
  channel: string
  sentBy: string
  deliveryStatus: string
  createdAt: string
  botTrace: unknown
  replyTo: ReplyToView | null
  templatePayload: SentTemplatePayload | null
}

/**
 * The one place a `Message` row turns into what the REST message-list route
 * returns. Requires a genuine Prisma row (needs `createdAt` as an actual Date)
 * with its `replyTo` relation included -- the quoted-message preview only needs
 * a content/type/sender snapshot, not the parent's own media, so nothing beyond
 * that is carried across.
 */
export function serializeMessage(m: Message & { replyTo?: Message | null }): MessageView {
  return {
    id: m.id,
    direction: m.direction,
    type: m.type,
    content: m.content,
    mediaUrl: m.mediaId ? `/api/media/${m.id}` : null,
    mimeType: m.mimeType,
    fileName: m.fileName,
    channel: m.channel,
    sentBy: m.sentBy,
    deliveryStatus: m.deliveryStatus,
    createdAt: m.createdAt.toISOString(),
    botTrace: m.botTrace,
    replyTo: m.replyTo ? { id: m.replyTo.id, content: m.replyTo.content, type: m.replyTo.type, sentBy: m.replyTo.sentBy } : null,
    templatePayload: (m.templatePayload as SentTemplatePayload | null) ?? null,
  }
}

/**
 * Adds the resolvable media proxy path to a message row before it goes out over
 * SSE, leaving every other field untouched. Deliberately lighter-weight than
 * `serializeMessage` (no `createdAt.toISOString()`, no fixed field list) because
 * `broadcast()` call sites pass through whatever Prisma's `create`/`update`
 * returned as-is -- without this, a message delivered live would carry the raw
 * `mediaId` and a permanently-null legacy `mediaUrl` column instead of the proxy
 * path, so an inbound photo would only ever render after a manual refresh.
 */
export function withMediaUrl<T extends { id: string; mediaId?: string | null }>(
  m: T
): T & { mediaUrl: string | null } {
  return { ...m, mediaUrl: m.mediaId ? `/api/media/${m.id}` : null }
}
