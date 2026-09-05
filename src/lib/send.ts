import { unlink } from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/db'
import { sendMetaText, sendMetaMedia } from '@/lib/meta/messages'
import { uploadMetaMediaFromUrl } from '@/lib/meta/media-upload'
import { sendCoexistText, sendCoexistMedia } from '@/lib/coexist/client'
import { resolveChannel } from '@/lib/channel-router'
import { broadcast } from '@/lib/realtime'
import { withMediaUrl } from '@/lib/serialize-message'
import { enqueueOutboundJob } from '@/lib/outbound/queue'
import { processOutboundJob } from '@/lib/outbound/worker'

/**
 * Removes an agent's uploaded attachment from local disk (see POST /api/uploads) once Meta has
 * its own durable copy (a `mediaId`, resolvable later through the existing /api/media proxy) --
 * there's no reason to keep two copies forever. Only ever called for Official-channel sends;
 * Unofficial has no equivalent remote copy (wa-coexist doesn't retain what it sends), so that
 * upload has to stay in place as the only surviving copy the bubble can ever render again.
 * Best-effort: a failed delete is just a few stray KB on disk, never worth failing a send that
 * has already gone out.
 */
async function deleteLocalUpload(url: string): Promise<void> {
  try {
    const { pathname } = new URL(url)
    if (!pathname.startsWith('/uploads/')) return
    await unlink(path.join(process.cwd(), 'public', pathname))
  } catch (error) {
    console.warn('sendMessage: failed to clean up local upload after Official send', { url, error })
  }
}

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

  // --- Phase 6: Unofficial goes through the outbound queue ---
  //
  // Unofficial is the primary send path, and until now it was fire-and-forget: one attempt at
  // wa-coexist, and a five-second outage destroyed the message permanently. Queued sends get
  // the retry ladder, a safety-guard check, and a row an operator can actually retry.
  //
  // Official deliberately keeps the direct path. It carries templates, campaigns and the media
  // upload/cleanup dance (uploadMetaMediaFromUrl -> deleteLocalUpload), it reports real
  // delivery status through the Meta webhook, and it is not the channel this phase was written
  // to make durable. Moving it too would have been a second, unrelated behaviour change in the
  // same commit.
  //
  // The sandbox conversation still short-circuits everything, exactly as before.
  if (channel === 'UNOFFICIAL' && !conversation.isTest) {
    return sendViaQueue({ ...params, conversation, channel })
  }

  let externalId: string | undefined
  let deliveryStatus: 'SENT' | 'FAILED' = 'SENT'
  // Only ever set on the Official path: a Meta media id, resolvable later through the same
  // /api/media/{id} proxy inbound media already uses. The Unofficial path has no such id --
  // it stores the agent's own upload URL directly on `mediaUrl` instead (see below).
  let mediaId: string | undefined

  // The sandbox conversation's entire point (src/lib/test-conversation.ts) is that nothing
  // ever reaches a real WhatsApp number -- skip the Meta/wa-coexist dispatch (and the
  // waNumber/replyToExternalId lookups it needs) entirely and record the message as if it
  // had gone out cleanly.
  if (!conversation.isTest) {
    const waNumber = await prisma.waNumber.findFirstOrThrow()

    // Only looked up to grab the parent's own wamid for Meta's `context.message_id` --
    // wa-coexist's send API has no equivalent field, so Unofficial sends still store
    // replyToId locally (for the UI's own quote preview) but never pass it upstream.
    const replyToExternalId = params.replyToId
      ? (await prisma.message.findUnique({ where: { id: params.replyToId } }))?.externalId ?? undefined
      : undefined

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

    // mediaId only ever ends up set once uploadMetaMediaFromUrl has actually succeeded (see
    // above), independent of whether the follow-up sendMetaMedia call itself then failed --
    // either way, Meta already holds a durable copy, so the local one is no longer needed.
    if (mediaId && params.media) await deleteLocalUpload(params.media.url)
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

/**
 * The queued Unofficial path: store the message first, then let the worker deliver it.
 *
 * Ordering is deliberate and is the opposite of the direct path's. The Message row is created
 * BEFORE any provider call, as PENDING, so the agent's own bubble appears instantly and the
 * message physically cannot be lost by a provider failure — guidebook §24 (Risiko 4). The
 * first attempt is then fired immediately, so a healthy send is no slower than it was before
 * the queue existed.
 */
async function sendViaQueue(params: {
  conversationId: string
  text: string
  sentBy: 'AGENT' | 'BOT'
  agentId?: string
  botTrace?: unknown
  replyToId?: string
  media?: OutboundMedia
  conversation: { id: string; contactId: string; contact: { phone: string } }
  channel: 'OFFICIAL' | 'UNOFFICIAL'
}) {
  const created = await prisma.message.create({
    data: {
      conversationId: params.conversationId,
      direction: 'OUTBOUND',
      type: params.media?.type ?? 'text',
      content: params.text || null,
      // Unofficial has no Meta media id, so the agent's own upload URL stays the only copy the
      // bubble can render -- same as the direct path, and the reason deleteLocalUpload is
      // never called for this channel.
      mediaUrl: params.media?.url ?? null,
      mimeType: params.media?.mimeType ?? null,
      fileName: params.media?.fileName ?? null,
      channel: params.channel,
      sentBy: params.sentBy,
      agentId: params.agentId,
      botTrace: params.botTrace as never,
      deliveryStatus: 'PENDING',
      replyToId: params.replyToId,
    },
    include: { replyTo: true },
  })
  broadcast({ type: 'message.created', conversationId: params.conversationId, message: withMediaUrl(created) })

  const enqueued = await enqueueOutboundJob({
    conversationId: params.conversationId,
    messageId: created.id,
    contactId: params.conversation.contactId,
    channel: params.channel,
    provider: 'COEXIST',
    payload: {
      // Resolved once, here: a retry ten minutes later must send to the number this message was
      // addressed to, not to whatever the contact row says by then.
      to: params.conversation.contact.phone,
      text: params.text,
      media: params.media,
    },
    sentBy: params.sentBy,
  })

  if (enqueued.warnings.length > 0) {
    console.warn('sendMessage: peringatan safety guard', { conversationId: params.conversationId, warnings: enqueued.warnings })
  }

  if (enqueued.blocked || !enqueued.jobId) {
    // A blocked or un-queueable send is marked FAILED rather than left PENDING forever. The
    // reason lives on the cancelled job row; the bubble shows FAILED with a retry button, so
    // the outcome is visible instead of being a message that silently never arrives.
    const failed = await prisma.message.update({
      where: { id: created.id },
      data: { deliveryStatus: 'FAILED' },
      include: { replyTo: true },
    })
    broadcast({ type: 'message.updated', conversationId: params.conversationId, message: withMediaUrl(failed) })
    return failed
  }

  // Attempt 1, immediately and without awaiting: the retry ladder's first rung is zero delay,
  // and awaiting it here would put the provider round-trip back on the caller's critical path,
  // reintroducing exactly the latency the queue is meant to decouple. Rejections cannot escape
  // -- processOutboundJob handles its own failures and records them on the job.
  void processOutboundJob(enqueued.jobId).catch((error: unknown) => {
    console.error('sendMessage: percobaan pertama gagal dijadwalkan', { jobId: enqueued.jobId, error })
  })

  return created
}
