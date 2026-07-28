import { prisma } from '@/lib/db'
import { sendMetaText, sendMetaMedia } from '@/lib/meta/messages'
import { uploadMetaMediaFromUrl } from '@/lib/meta/media-upload'
import { sendCoexistText, sendCoexistMedia } from '@/lib/coexist/client'
import { resolveChannel } from '@/lib/channel-router'
import { broadcast } from '@/lib/realtime'
import { withMediaUrl } from '@/lib/serialize-message'

export type OutboundMedia = {
  // Wherever /api/uploads just stored the agent's file -- a normal https URL, fetchable by
  // both Meta (uploadMetaMediaFromUrl downloads it before re-uploading to Meta's Media API)
  // and wa-coexist (which fetches URLs directly, no re-upload step of its own).
  url: string
  type: 'image' | 'video' | 'audio' | 'document'
  mimeType: string
  fileName?: string
}

export async function sendMessage(params: {
  conversationId: string
  text: string
  channel?: 'OFFICIAL' | 'UNOFFICIAL'
  sentBy: 'AGENT' | 'BOT'
  agentId?: string
  botTrace?: unknown
  replyToId?: string
  media?: OutboundMedia
}) {
  const channel = await resolveChannel(params.channel)
  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: params.conversationId },
    include: { contact: true },
  })
  const waNumber = await prisma.waNumber.findFirstOrThrow()

  // Only looked up to grab the parent's own wamid for Meta's `context.message_id` --
  // wa-coexist's send API has no equivalent field, so Unofficial sends still store
  // replyToId locally (for the UI's own quote preview) but never pass it upstream.
  const replyToExternalId = params.replyToId
    ? (await prisma.message.findUnique({ where: { id: params.replyToId } }))?.externalId ?? undefined
    : undefined

  let externalId: string | undefined
  let deliveryStatus: 'SENT' | 'FAILED' = 'SENT'
  // Only ever set on the Official path: a Meta media id, resolvable later through the same
  // /api/media/{id} proxy inbound media already uses. The Unofficial path has no such id --
  // it stores the agent's own upload URL directly on `mediaUrl` instead (see below).
  let mediaId: string | undefined
  try {
    if (channel === 'OFFICIAL') {
      if (params.media) {
        const uploaded = await uploadMetaMediaFromUrl(waNumber, params.media.url)
        mediaId = uploaded.id
        const result = await sendMetaMedia(
          waNumber,
          conversation.contact.phone,
          params.media.type,
          uploaded.id,
          params.text || undefined,
          replyToExternalId
        )
        externalId = result.externalId
      } else {
        const result = await sendMetaText(waNumber, conversation.contact.phone, params.text, replyToExternalId)
        externalId = result.externalId
      }
    } else if (params.media) {
      // wa-coexist's WatZap-compatible API has no distinct audio endpoint (see
      // src/lib/coexist/client.ts) -- audio rides the same send_file_url path as video/document,
      // which is fine since it's plain file delivery either way; only our own Message.type keeps
      // it labeled 'audio' so the bubble still renders an audio player.
      const result = await sendCoexistMedia(
        waNumber,
        conversation.contact.phone,
        params.media.url,
        params.media.type === 'audio' ? 'document' : params.media.type,
        params.text || undefined
      )
      externalId = result.externalId
    } else {
      const result = await sendCoexistText(waNumber, conversation.contact.phone, params.text)
      externalId = result.externalId
    }
  } catch (error) {
    console.error('sendMessage: send attempt failed', { conversationId: params.conversationId, channel, error })
    deliveryStatus = 'FAILED'
  }

  const created = await prisma.message.create({
    data: {
      conversationId: params.conversationId,
      externalId,
      direction: 'OUTBOUND',
      type: params.media?.type ?? 'text',
      content: params.text || null,
      mediaId: mediaId ?? null,
      // Raw URL fallback, used only when there's no Meta media id to resolve through the proxy
      // (i.e. an Unofficial-channel media send) -- see withMediaUrl in serialize-message.ts.
      mediaUrl: !mediaId && params.media ? params.media.url : null,
      mimeType: params.media?.mimeType ?? null,
      fileName: params.media?.fileName ?? null,
      channel,
      sentBy: params.sentBy,
      agentId: params.agentId,
      botTrace: params.botTrace as never,
      deliveryStatus,
      replyToId: params.replyToId,
    },
    include: { replyTo: true },
  })
  broadcast({ type: 'message.created', conversationId: params.conversationId, message: withMediaUrl(created) })
  return created
}
