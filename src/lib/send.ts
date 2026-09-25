import { unlink } from 'fs/promises'
import path from 'path'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { sendMetaText, sendMetaMedia } from '@/lib/meta/messages'
import { uploadMetaMediaFromUrl } from '@/lib/meta/media-upload'
import { sendMessengerText } from '@/lib/meta/messenger-send'
import { sendCoexistText, sendCoexistMedia } from '@/lib/coexist/client'
import { resolveChannelForCapability } from '@/lib/channel-router'
import type { ChannelCapabilityKey } from '@/lib/bot-control/channel-capabilities'
import { broadcast } from '@/lib/realtime'
import { withMediaUrl } from '@/lib/serialize-message'
import { enqueueOutboundJob } from '@/lib/outbound/queue'
import { processOutboundJob } from '@/lib/outbound/worker'
import { sanitizeTrace } from '@/lib/bot-control/trace-sanitizer'

/**
 * `Message.botTrace` is this app's OTHER botTrace write -- `BotDecisionRun.trace`/
 * `knowledgeRefs` (decision-recorder.ts) already go through `sanitizeTrace` before the write,
 * but this column, the popover's primary data source (bot-safety.md: it must stay written),
 * did not. Sanitized ONCE here, at the one module every send path funnels through (direct,
 * blocked, and the queued Unofficial path via `sendViaQueue`), rather than at each call site in
 * inbound.ts -- that covers every current AND future caller, not just today's two. A secret
 * that reaches the database is permanent (decision-recorder.ts's own header), so this runs
 * BEFORE the write, exactly like `trace`/`knowledgeRefs` already do.
 */
function sanitizedBotTrace(botTrace: unknown): Prisma.InputJsonValue | undefined {
  if (botTrace === undefined) return undefined
  const value = sanitizeTrace(botTrace)
  return value === null ? undefined : (value as Prisma.InputJsonValue)
}

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

/**
 * Which published capability rule governs this particular send.
 *
 * Derived from the payload rather than passed in, so no caller can forget it and quietly opt
 * out of the policy. Audio and document are their own rows in the matrix because Unofficial
 * carries them differently (see channel-capabilities.ts), and an operator may reasonably want
 * one routed differently from a plain image.
 */
function capabilityForSend(media?: { type: 'image' | 'video' | 'audio' | 'document' }): ChannelCapabilityKey {
  if (!media) return 'send_text'
  if (media.type === 'document') return 'send_document'
  if (media.type === 'audio') return 'send_audio'
  return 'send_media'
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
  // Override eksplisit, jarang dipakai (mis. test yang tidak ingin memuat conversation
  // lengkap hanya untuk membuktikan sebuah cabang). Sumber kebenaran platform ada di
  // `conversation.channelIdentity.platform`, dibaca beberapa baris di bawah -- pemanggil
  // TIDAK perlu (dan sebaiknya tidak) mengisi field ini. Sebelum fix ini `platform` adalah
  // parameter yang harus diingat SETIAP pemanggil, dengan default salah (WhatsApp) yang
  // gagal ke arah paling membingungkan: percakapan Facebook diam-diam dikirim lewat gerbang
  // telepon WhatsApp dan selalu gagal, karena kontak Facebook tidak pernah punya nomor
  // telepon. Review round 1, Temuan 1.
  platform?: 'WHATSAPP' | 'FACEBOOK' | 'INSTAGRAM'
}) {
  // Sanitized ONCE, here, before any of this function's writes (blocked below, the direct
  // write further down, sendViaQueue's own write, and sendMessengerMessage's write below --
  // all receive this already-sanitized value rather than the raw params.botTrace).
  const botTrace = sanitizedBotTrace(params.botTrace)

  // Percakapan dimuat SEKALI, di sini, dengan `contact` (identitas WhatsApp) DAN
  // `channelIdentity` (platform + PSID Facebook) sekaligus -- platform lalu DITURUNKAN dari
  // baris ini, bukan diminta dari pemanggil (lihat komentar `platform` di atas). Setiap
  // percakapan sudah punya ChannelIdentity sejak fase fondasi (upsertChannelIdentity mengisi
  // keduanya untuk WhatsApp maupun Facebook); satu-satunya baris yang mungkin `channelIdentity:
  // null` adalah baris pra-backfill yang sudah tidak ada di produksi, dan itu diperlakukan
  // sebagai WhatsApp -- perilaku lama, aman, tidak berubah.
  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: params.conversationId },
    include: { contact: true, channelIdentity: true },
  })
  const platform = params.platform ?? conversation.channelIdentity?.platform ?? 'WHATSAPP'

  // Cabang platform duluan, baru cabang MessageChannel. MessageChannel { OFFICIAL,
  // UNOFFICIAL } berarti "Meta Cloud API vs wa-coexist" -- dua jalur DI DALAM WhatsApp,
  // bukan dua platform, jadi FACEBOOK tidak pernah jadi nilai ketiga enum itu (lihat
  // sendMessengerMessage di bawah, yang menulis 'OFFICIAL' -- pengiriman Graph API
  // sungguhan, hanya kebetulan bukan WhatsApp). Messenger juga tidak melewati capability
  // matrix WhatsApp (resolveChannelForCapability) atau gerbang `contact.phone` di bawah --
  // kontak Facebook tidak pernah punya nomor telepon; identitasnya PSID di ChannelIdentity.
  // Instagram DM memakai adapter, endpoint, dan token yang SAMA dengan Messenger (akun
  // Instagram Professional tertaut ke Page yang sama), jadi satu cabang untuk keduanya --
  // bukan dua cabang yang cepat atau lambat berselisih. `platform` diteruskan ke bawah
  // supaya body kirim dan pesan error tetap benar per platform.
  if (platform === 'FACEBOOK' || platform === 'INSTAGRAM') {
    return sendMessengerMessage(params, botTrace, conversation, platform)
  }

  // The capability matrix decides both WHICH channel carries this send and whether it may go
  // out at all. SDD Manage Second §15 Phase H task 4.
  const capability = capabilityForSend(params.media)
  const routing = await resolveChannelForCapability(capability, params.channel)
  const channel = routing.channel

  // A send that cannot physically go out (no channel supports the capability, or -- since
  // Task 9 -- the contact has no phone number for this WhatsApp-only send path) is recorded as
  // a FAILED message rather than thrown: the bubble then shows what was attempted, with the
  // retry button, instead of the send vanishing with only a server log to show for it.
  const recordBlocked = async () => {
    const blocked = await prisma.message.create({
      data: {
        conversationId: params.conversationId,
        direction: 'OUTBOUND',
        type: params.media?.type ?? 'text',
        content: params.text || null,
        mediaUrl: params.media?.url ?? null,
        mimeType: params.media?.mimeType ?? null,
        fileName: params.media?.fileName ?? null,
        channel,
        sentBy: params.sentBy,
        agentId: params.agentId,
        botTrace: botTrace as never,
        deliveryStatus: 'FAILED',
        replyToId: params.replyToId,
      },
      include: { replyTo: true },
    })
    broadcast({ type: 'message.created', conversationId: params.conversationId, message: withMediaUrl(blocked) })
    return blocked
  }

  if (routing.disabled) {
    console.warn('sendMessage: kemampuan tidak didukung channel mana pun', {
      conversationId: params.conversationId,
      capability,
    })
    return recordBlocked()
  }

  // `sendMessage` only ever carries WhatsApp (Meta Official / coexist Unofficial) -- both need
  // a real phone number. A null `contact.phone` (Task 9: contacts born on IG/FB/email have no
  // phone) reaching this path is a routing bug elsewhere, not something to crash on; other
  // channels get their own send path once they exist, not this one.
  if (!conversation.contact.phone) {
    console.error('sendMessage: kontak tidak punya nomor telepon untuk jalur kirim WhatsApp', {
      conversationId: params.conversationId,
    })
    return recordBlocked()
  }
  const contactPhone = conversation.contact.phone

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
    // Already sanitized above -- sendViaQueue's own write must not sanitize a second time
    // (idempotent, but pointless) or, worse, skip it by reaching for params.botTrace directly.
    // `contact.phone` rebuilt with the already-narrowed `contactPhone`: the guard above proved
    // it non-null, but that narrowing doesn't survive re-reading it off `conversation` here.
    return sendViaQueue({
      ...params,
      botTrace,
      conversation: { ...conversation, contact: { phone: contactPhone } },
      channel,
    })
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
            contactPhone,
            params.media.type,
            uploaded.id,
            params.text || undefined,
            replyToExternalId
          )
          externalId = result.externalId
        } else {
          const result = await sendMetaText(waNumber, contactPhone, params.text, replyToExternalId)
          externalId = result.externalId
        }
      } else if (params.media) {
        // wa-coexist's WatZap-compatible API has no distinct audio endpoint (see
        // src/lib/coexist/client.ts) -- audio rides the same send_file_url path as video/document,
        // which is fine since it's plain file delivery either way; only our own Message.type keeps
        // it labeled 'audio' so the bubble still renders an audio player.
        const result = await sendCoexistMedia(
          waNumber,
          contactPhone,
          params.media.url,
          params.media.type === 'audio' ? 'document' : params.media.type,
          params.text || undefined
        )
        externalId = result.externalId
      } else {
        const result = await sendCoexistText(waNumber, contactPhone, params.text)
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
      botTrace: botTrace as never,
      deliveryStatus,
      replyToId: params.replyToId,
    },
    include: { replyTo: true },
  })
  broadcast({ type: 'message.created', conversationId: params.conversationId, message: withMediaUrl(created) })
  return created
}

/**
 * The Messenger send path, shared by Facebook and Instagram DM: same adapter, same Graph API
 * endpoint, same Page-linked token (an Instagram Professional account is tied to the same
 * Page), so one function for both -- not two that could drift apart. Deliberately its own
 * small function, not spliced into the WhatsApp direct path above: Messenger has no capability
 * matrix, no OFFICIAL/UNOFFICIAL choice, no waNumber, and its recipient identity is a PSID/IGSID
 * (ChannelIdentity.externalId), not `contact.phone` -- a Facebook- or Instagram-born contact's
 * `phone` column is always null (see prisma/schema.prisma's Contact.phone comment).
 * `channel: 'OFFICIAL'` on the written row is not a lie: this is a real, direct Graph API call,
 * the same shape of fact OFFICIAL records for WhatsApp -- it only ever means "not queued
 * through the Unofficial outbound job".
 *
 * `conversation` is passed in already-loaded from `sendMessage` (which needed it anyway to
 * derive `platform`) rather than re-queried here -- one fetch, not two.
 */
async function sendMessengerMessage(
  params: {
    conversationId: string
    text: string
    sentBy: 'AGENT' | 'BOT'
    agentId?: string
    replyToId?: string
    // Declared explicitly, not omitted from the type, so the next reader can see this field
    // is read (the gate right below) rather than quietly forgotten. Sending Messenger/Instagram
    // media is its own separate task -- deliberately out of scope here (review round 1, Temuan 2).
    media?: OutboundMedia
  },
  botTrace: Prisma.InputJsonValue | undefined,
  conversation: { channelIdentity: { externalId: string } | null },
  platform: 'FACEBOOK' | 'INSTAGRAM',
) {
  const nama = platform === 'INSTAGRAM' ? 'Instagram' : 'Facebook'
  // Nama PLATFORM (`nama`, dipakai di klausa "Kirim lampiran ke X belum didukung") dan nama
  // APLIKASI tempat operator membalas manual (dipakai di klausa "balas lewat") sengaja
  // dipisah, bukan dipakai ulang: DM Facebook dibawa oleh aplikasi bernama Messenger, bukan
  // aplikasi bernama "Facebook" -- menyamakan keduanya pernah membuat teks produksi berubah
  // jadi "balas lewat aplikasi Facebook", yang faktual salah dan pernah harus dikembalikan.
  // Jangan gabungkan lagi jadi satu variabel.
  const namaAplikasi = platform === 'INSTAGRAM' ? 'Instagram' : 'Messenger'
  const recordFailed = async (content: string | null) => {
    const failed = await prisma.message.create({
      data: {
        conversationId: params.conversationId,
        direction: 'OUTBOUND',
        type: 'text',
        content,
        channel: 'OFFICIAL',
        sentBy: params.sentBy,
        agentId: params.agentId,
        botTrace: botTrace as never,
        deliveryStatus: 'FAILED',
        replyToId: params.replyToId,
      },
      include: { replyTo: true },
    })
    broadcast({ type: 'message.created', conversationId: params.conversationId, message: withMediaUrl(failed) })
    return failed
  }

  // Lampiran ke Facebook maupun Instagram BELUM diimplementasikan -- sendMessengerText
  // hanya mengirim teks, untuk kedua platform yang lewat fungsi bersama ini. Gagal TERLIHAT
  // di sini, bukan diam-diam mengirim teksnya saja dan kehilangan lampirannya tanpa jejak:
  // kelas bug yang sama persis yang inbound-messenger.ts (attachmentPlaceholder) sudah
  // tutup di sisi masuk. Dicek SEBELUM memanggil sendMessengerText sama sekali -- nol
  // pemanggilan provider untuk kasus ini.
  if (params.media) {
    console.error('sendMessage: lampiran belum didukung', {
      conversationId: params.conversationId, platform,
    })
    return recordFailed(`Kirim lampiran ke ${nama} belum didukung -- kirim teks, atau balas lewat ${namaAplikasi}`)
  }

  // A Facebook conversation with no ChannelIdentity is a routing bug elsewhere (every FB
  // conversation is created FROM a ChannelIdentity -- see inbound-messenger.ts), not something
  // to crash on: record it as a normal FAILED send, same as the WhatsApp `!contact.phone` gate
  // above does for its own equivalent impossible state.
  const recipientId = conversation.channelIdentity?.externalId
  if (!recipientId) {
    console.error('sendMessage: percakapan tanpa ChannelIdentity', {
      conversationId: params.conversationId, platform,
    })
    return recordFailed(params.text || null)
  }

  let externalId: string | undefined
  let deliveryStatus: 'SENT' | 'FAILED' = 'SENT'
  try {
    const result = await sendMessengerText(recipientId, params.text, platform)
    externalId = result.externalId
  } catch (error) {
    console.error('sendMessage: Messenger send attempt failed', {
      conversationId: params.conversationId, platform, error,
    })
    deliveryStatus = 'FAILED'
  }

  const created = await prisma.message.create({
    data: {
      conversationId: params.conversationId,
      externalId,
      direction: 'OUTBOUND',
      type: 'text',
      content: params.text || null,
      channel: 'OFFICIAL',
      sentBy: params.sentBy,
      agentId: params.agentId,
      botTrace: botTrace as never,
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
      // Already sanitized by sendMessage's own single call to sanitizedBotTrace() before this
      // function was invoked -- this is the module's only other caller, so no second pass here.
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
