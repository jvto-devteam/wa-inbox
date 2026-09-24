/**
 * Sends a system template on behalf of another program (POST /api/v1/system-messages).
 *
 * javavolcano-touroperator and new-backoffice used to build these messages themselves and curl
 * them straight at wa-dashboard: hardcoded text, no retry, every error swallowed. They now send
 * only a template key, a destination, and the values; the text lives here, editable by the
 * operator, and delivery rides the same OutboundJob queue as every other Unofficial send
 * (retry ladder, provider pause, stuck recovery — .claude/rules/channel-policy.md).
 *
 * Where a send lands depends on who it is for:
 *
 * - CUSTOMER template to a phone → a real Message in that customer's conversation (created if
 *   this is their first contact), so an agent opening the chat sees what the customer was told.
 * - INTERNAL template, or any group → an OutboundJob only. A crew member's number or a hotel's
 *   WhatsApp group is not a customer, and a group has no phone to make a Contact from; giving
 *   them conversations would fill the Inbox with rows nobody is meant to answer.
 *
 * Idempotency: the caller sends one key per real-world event and is told to retry on failure,
 * so the same key arriving twice is expected, and must never produce a second message.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { upsertChannelIdentity } from '@/lib/channel/identity'
import { broadcast } from '@/lib/realtime'
import { withMediaUrl } from '@/lib/serialize-message'
import { enqueueOutboundJob, type OutboundJobPayload } from '@/lib/outbound/queue'
import { processOutboundJob } from '@/lib/outbound/worker'
import { defaultBotEnabled } from '@/lib/inbound'
import { normalizePhoneNumber } from '@/lib/phone'
import { renderSystemTemplate } from './render'
import { parseVariables, type VariableValues } from './types'

export type SystemSendTarget = { phone: string } | { groupId: string }

export type SystemSendParams = {
  clientId: string
  templateKey: string
  to: SystemSendTarget
  variables: VariableValues
  idempotencyKey: string
  /** Gambar khusus kiriman ini; menggantikan SystemTemplate.imageUrl. Sudah divalidasi pemanggil. */
  imageUrl?: string
}

export type SystemSendResult =
  | { ok: true; jobId: string; status: string; duplicate: boolean }
  | { ok: false; code: 'TEMPLATE_NOT_FOUND' | 'INVALID_PHONE' | 'ENQUEUE_FAILED' }
  | { ok: false; code: 'MISSING_VARIABLES'; missing: string[] }

function imageMimeType(url: string): string {
  const path = url.split('?')[0].toLowerCase()
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}

/**
 * Runs an upsert, and once more if it loses a unique-constraint race.
 *
 * Prisma's upsert is a read followed by a write, not an atomic INSERT ... ON CONFLICT, so two
 * sends to the same NEW customer arriving together (a caller retrying, or two different events
 * for one booking) both see "no row" and one of the inserts fails with P2002. On the second
 * try the row exists and the upsert takes its update branch. Found against a real Postgres, not
 * a mock.
 *
 * Applies to the `conversation.upsert` below, whose compound key
 * (channelIdentityId, externalThreadId) is still unique. It does NOT protect the
 * `contact.create` it also wraps: Task 9 dropped `Contact.phone @unique`, so that insert can no
 * longer raise P2002 at all and the retry there is unreachable. The duplicate-Contact race it
 * used to catch is handled instead by reading `identity.contactId` back off the
 * ChannelIdentity upsert (see the conversation `create` below) -- the loser of the race still
 * attaches to the contact the identity points at, rather than being prevented from losing.
 */
async function upsertOnce<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return run()
    throw error
  }
}

async function existingJob(idempotencyKey: string) {
  return prisma.outboundJob.findUnique({ where: { idempotencyKey }, select: { id: true, status: true } })
}

export async function enqueueSystemTemplateSend(params: SystemSendParams): Promise<SystemSendResult> {
  // Checked first, before the template is even read: a retry of an event that already went out
  // must succeed even if the operator has since switched that template off.
  const previous = await existingJob(params.idempotencyKey)
  if (previous) return { ok: true, jobId: previous.id, status: previous.status, duplicate: true }

  const template = await prisma.systemTemplate.findUnique({ where: { key: params.templateKey } })
  if (!template || !template.isActive) return { ok: false, code: 'TEMPLATE_NOT_FOUND' }

  const rendered = renderSystemTemplate(
    { body: template.body, variables: parseVariables(template.variables) },
    params.variables
  )
  if (!rendered.ok) return { ok: false, code: 'MISSING_VARIABLES', missing: rendered.missing }

  // Gambar kiriman menang atas gambar template: pickup sign bernama tamu, bukan gambar umum.
  const imageUrl = params.imageUrl ?? template.imageUrl
  const media: OutboundJobPayload['media'] = imageUrl
    ? { url: imageUrl, type: 'image', mimeType: imageMimeType(imageUrl) }
    : undefined

  const common = {
    channel: 'UNOFFICIAL' as const,
    provider: 'COEXIST' as const,
    // A system message is the business speaking, not the bot: 'AGENT' with no agentId, the same
    // attribution a human reply gets, so the bot-control views never count it as a bot turn.
    sentBy: 'AGENT' as const,
    purpose: 'SYSTEM' as const,
    idempotencyKey: params.idempotencyKey,
    templateKey: template.key,
    sourceClientId: params.clientId,
  }

  if ('groupId' in params.to) {
    return finish(
      await enqueueOutboundJob({
        ...common,
        conversationId: null,
        messageId: null,
        contactId: null,
        target: `grup:${params.to.groupId}`,
        payload: { to: params.to.groupId, text: rendered.text, media, targetType: 'GROUP' },
      })
    )
  }

  const phone = normalizePhoneNumber(params.to.phone)
  if (!phone) return { ok: false, code: 'INVALID_PHONE' }

  if (template.audience === 'INTERNAL') {
    return finish(
      await enqueueOutboundJob({
        ...common,
        conversationId: null,
        messageId: null,
        contactId: null,
        target: phone,
        payload: { to: phone, text: rendered.text, media, targetType: 'PHONE' },
      })
    )
  }

  // CUSTOMER: the message becomes part of the customer's conversation, exactly like an agent's
  // queued reply (send.ts's sendViaQueue) — bubble first, as PENDING, then the job.
  const nameValue = params.variables.name
  const resolvedName = typeof nameValue === 'string' && nameValue.trim() ? nameValue.trim() : null

  const known = await prisma.channelIdentity.findUnique({
    where: { platform_externalId: { platform: 'WHATSAPP', externalId: phone } },
    select: { contactId: true },
  })

  const contact = known
    ? await prisma.contact.update({
        where: { id: known.contactId },
        data: resolvedName ? { name: resolvedName } : {},
      })
    : await upsertOnce(() => prisma.contact.create({ data: { phone, name: resolvedName } }))

  const identity = await upsertChannelIdentity({
    platform: 'WHATSAPP',
    externalId: phone,
    contactId: contact.id,
    displayName: resolvedName,
  })

  const now = new Date()
  const botEnabled = await defaultBotEnabled({ platform: 'WHATSAPP', phone })

  const conversation = await upsertOnce(() =>
    prisma.conversation.upsert({
      where: {
        channelIdentityId_externalThreadId: { channelIdentityId: identity.id, externalThreadId: '' },
      },
      update: { lastMessageAt: now },
      create: {
        // `identity.contactId`, not the locally resolved `contact.id` -- see the equivalent
        // comment in src/lib/inbound.ts's ingestSingleMessage. Contact.phone is no longer
        // @unique, so two parallel first sends to the same new number can each create their own
        // Contact; reading the id back off the identity means the loser still attaches its
        // conversation to the contact the identity actually points at, instead of leaving
        // Conversation.contactId disagreeing with ChannelIdentity.contactId forever.
        contactId: identity.contactId,
        channelIdentityId: identity.id,
        externalThreadId: '',
        lastMessageAt: now,
        botEnabled,
      },
    })
  )

  const created = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'OUTBOUND',
      type: media ? 'image' : 'text',
      content: rendered.text,
      mediaUrl: media?.url ?? null,
      mimeType: media?.mimeType ?? null,
      channel: 'UNOFFICIAL',
      sentBy: 'AGENT',
      deliveryStatus: 'PENDING',
    },
    include: { replyTo: true },
  })

  const enqueued = await enqueueOutboundJob({
    ...common,
    conversationId: conversation.id,
    messageId: created.id,
    // Same contact the conversation above was opened under, for the same reason: this id is
    // what the outbound safety guard reads consent for (src/lib/outbound/safety-guard.ts), so
    // it must not be able to point at a different Contact row than the conversation does.
    contactId: identity.contactId,
    target: phone,
    payload: { to: phone, text: rendered.text, media, targetType: 'PHONE' },
  })

  if (enqueued.duplicate) {
    // Lost a race with a parallel request carrying the same key; that request owns the bubble.
    await prisma.message.delete({ where: { id: created.id } }).catch(() => undefined)
    return finish(enqueued)
  }

  if (enqueued.blocked || !enqueued.jobId) {
    const failed = await prisma.message.update({
      where: { id: created.id },
      data: { deliveryStatus: 'FAILED' },
      include: { replyTo: true },
    })
    broadcast({ type: 'message.created', conversationId: conversation.id, message: withMediaUrl(failed) })
    return finish(enqueued)
  }

  broadcast({ type: 'message.created', conversationId: conversation.id, message: withMediaUrl(created) })
  return finish(enqueued)
}

function finish(enqueued: Awaited<ReturnType<typeof enqueueOutboundJob>>): SystemSendResult {
  if (!enqueued.jobId) return { ok: false, code: 'ENQUEUE_FAILED' }
  if (enqueued.duplicate) return { ok: true, jobId: enqueued.jobId, status: 'QUEUED', duplicate: true }
  if (enqueued.blocked) return { ok: true, jobId: enqueued.jobId, status: 'CANCELLED', duplicate: false }

  const jobId = enqueued.jobId
  // Attempt 1 immediately and without awaiting, as sendViaQueue does: the caller gets its answer
  // as soon as the job is durable, and the retry ladder owns everything after that.
  void processOutboundJob(jobId).catch((error: unknown) => {
    console.error('system-templates: percobaan pertama gagal dijadwalkan', { jobId, error })
  })
  return { ok: true, jobId, status: 'QUEUED', duplicate: false }
}
