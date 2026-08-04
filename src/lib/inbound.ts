import { Prisma, type Contact, type DeliveryStatus, type TemplateMetaStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { decideAndRespond } from '@/lib/bot/orchestrator'
import { sendMessage } from '@/lib/send'
import { withMediaUrl } from '@/lib/serialize-message'

type MetaMediaObject = { id: string; mime_type: string; caption?: string; filename?: string }

export type MetaInboundMessage = {
  id: string
  from: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: MetaMediaObject
  audio?: MetaMediaObject
  video?: MetaMediaObject
  document?: MetaMediaObject
  // Present when this message is a WhatsApp "reply" to an earlier one. `id` is the
  // wamid of the quoted message, matched against Message.externalId below.
  context?: { id?: string }
}

// A brand-new conversation must start with the bot in whatever state the global mode
// currently dictates -- On (Settings.botAutoReplyAll) means every conversation defaults
// active, Off means every conversation defaults inactive until an agent manually opts it
// in (see src/app/api/bot/mode/route.ts, which bulk-writes existing conversations the
// same way on every toggle). Reading this fresh on every new conversation, rather than
// relying on the schema's static default, is what keeps a conversation created five
// minutes after an Off toggle from starting active anyway.
async function defaultBotEnabled(): Promise<boolean> {
  const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
  return settings.botAutoReplyAll
}

// Every media message type Meta can send carries the same {id, mime_type, caption?,
// filename?} shape under a key matching `type` -- image/audio/video/document. Reading
// it off `message[message.type]` instead of four near-identical if-branches means a
// fifth media type (were Meta to add one) degrades to the existing `[type]` text
// fallback instead of silently losing the caption too.
function mediaObjectFor(message: MetaInboundMessage): MetaMediaObject | undefined {
  if (message.type === 'image') return message.image
  if (message.type === 'audio') return message.audio
  if (message.type === 'video') return message.video
  if (message.type === 'document') return message.document
  return undefined
}

// Reported when the business sends a message from the WhatsApp Business app or a linked
// device (coexistence mode) rather than through this app -- the reverse of an inbound
// message's from/to: `from` is the business's own number, `to` is the customer's. Structurally
// compatible with mediaObjectFor's MetaInboundMessage parameter (same id/from/timestamp/type
// plus media fields), so it's reused for echoes too rather than duplicated.
export type MetaMessageEcho = {
  id: string
  from: string
  to: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: MetaMediaObject
  audio?: MetaMediaObject
  video?: MetaMediaObject
  document?: MetaMediaObject
  // Meta also reports the business editing or revoking (deleting) a message sent from the
  // app through this same field. Neither has a home in this schema (no edit history, no
  // soft-delete) -- ingestEchoedMessage accepts and ignores both rather than mis-storing an
  // edit/revoke notice as if it were a new ordinary message.
  revoke?: { original_message_id: string }
  edit?: { original_message_id: string }
}

export type MetaContact = { profile?: { name?: string | null } | null; wa_id: string }

// Delivery receipts for previously-sent OUTBOUND messages. `id` is the wamid we
// stored as Message.externalId when we sent it.
export type MetaStatus = {
  id: string
  status: string
  recipient_id?: string
  timestamp?: string
}

// The outcome of Meta's asynchronous review of a template we submitted. Unlike
// messages/statuses these fields sit FLAT on `value` (the change is identified by
// its sibling `field: "message_template_status_update"`), so the union below is
// discriminated by the presence of `message_template_id` rather than by nesting.
// `message_template_id` is the id `submitMetaTemplate()` stored as Template.metaId
// -- Meta sends it as a number, hence the string|number.
export type MetaTemplateStatusUpdate = {
  event?: string
  message_template_id?: string | number
  message_template_name?: string
  message_template_language?: string
  reason?: string
}

export type MetaWebhookPayload = {
  // Every level here is an array and Meta genuinely batches: one webhook delivery
  // can carry several entries, several changes per entry, and several messages per
  // change (burst traffic, retry consolidation). Indexing [0] at any level silently
  // drops real customer messages, and because the route still answers 200 Meta never
  // retries -- permanent, invisible loss. Hence the full triple iteration below.
  entry?: Array<{
    changes?: Array<{
      field?: string
      value?: {
        contacts?: Array<MetaContact>
        messages?: Array<MetaInboundMessage>
        statuses?: Array<MetaStatus>
        message_echoes?: Array<MetaMessageEcho>
      } & MetaTemplateStatusUpdate
    }>
  }>
}

export type IngestResult = {
  /** Inbound messages that produced a new Message row. */
  processed: number
  /** Inbound messages skipped as already-ingested duplicates (Meta's at-least-once retries). */
  skipped: number
  /** Delivery-status receipts that updated an existing Message row. */
  statusUpdates: number
  /** Meta template-review outcomes that updated an existing Template row. */
  templateStatusUpdates: number
  /** Message echoes (sent from the WhatsApp Business app/a linked device) that produced a new Message row. */
  echoed: number
}

// How long a contact who was checked and found to have no profile photo stays
// "known photo-less" before we look again. Matches the 24h window the orchestrator
// already uses for Conversation.bookingCheckedAt (BOOKING_CACHE_MS), so the codebase
// has one consistent "re-check external enrichment daily" cadence. A photo added
// mid-day shows up within a day; a photo-less contact costs at most one wa-coexist
// round-trip per day instead of one per message.
const AVATAR_RECHECK_MS = 24 * 60 * 60 * 1000

const DELIVERY_STATUS_BY_META_STATUS: Record<string, DeliveryStatus> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
}

// Meta does not guarantee ordering between status callbacks, so a late `sent`
// receipt can arrive after `delivered`/`read`. Only ever advance the status --
// never let a stale receipt walk a message backwards in the UI.
const DELIVERY_STATUS_RANK: Record<DeliveryStatus, number> = {
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 4,
}

/**
 * Meta sends the message timestamp as a stringified unix-seconds value. Garbage or a
 * missing value yields NaN -> `Invalid Date`, which Prisma rejects at write time and
 * which would fail ingestion of an otherwise perfectly good customer message. Falling
 * back to "now" (we did just receive it) keeps the message rather than losing it.
 */
function parseMetaTimestamp(raw: string | undefined): Date {
  const seconds = Number(raw)
  if (!Number.isFinite(seconds)) return new Date()
  const date = new Date(seconds * 1000)
  if (Number.isNaN(date.getTime())) return new Date()
  return date
}

/**
 * Best-effort avatar enrichment via wa-coexist. Every failure mode here -- no WaNumber
 * row configured, wa-coexist down, a non-JSON error page, an unexpected body shape --
 * must stay non-fatal: a decorative avatar can never be allowed to take down inbound
 * message ingestion. Note the WaNumber lookup lives INSIDE the try (it used to sit
 * outside, so an un-seeded environment 500'd every single webhook delivery).
 */
async function enrichContactAvatar(contact: Contact, phone: string): Promise<void> {
  if (contact.avatarUrl) return
  if (contact.avatarCheckedAt && Date.now() - contact.avatarCheckedAt.getTime() < AVATAR_RECHECK_MS) return

  try {
    let avatarUrl: string | null = null
    const waNumber = await prisma.waNumber.findFirst()
    if (!waNumber) {
      console.warn('inbound: avatar enrichment skipped — no WaNumber row configured')
    } else {
      const res = await fetch(`${waNumber.coexistBaseUrl}/api/contact/${phone}@s.whatsapp.net/avatar`)
      if (!res.ok) {
        console.warn('inbound: avatar lookup returned a non-OK response', { status: res.status, contactId: contact.id })
      } else {
        const body: unknown = await res.json()
        const url = (body as { url?: unknown } | null)?.url
        if (typeof url === 'string' && url.length > 0) avatarUrl = url
      }
    }
    // Stamped on every attempt, including the ones that found no photo or could not
    // reach wa-coexist -- that is the whole point of the negative cache.
    await prisma.contact.update({
      where: { id: contact.id },
      data: avatarUrl ? { avatarUrl, avatarCheckedAt: new Date() } : { avatarCheckedAt: new Date() },
    })
  } catch (error) {
    console.warn('inbound: avatar enrichment failed — continuing without an avatar', {
      contactId: contact.id,
      error,
    })
  }
}

/**
 * Applies one Meta delivery receipt to the outbound Message it refers to.
 * Returns true if a row was actually updated.
 */
async function applyStatusUpdate(status: MetaStatus): Promise<boolean> {
  const mapped = DELIVERY_STATUS_BY_META_STATUS[status.status]
  // Unmapped status strings (Meta adds new ones over time) are ignored, not errors.
  if (!mapped || !status.id) return false

  // A receipt can legitimately reference a message this system never sent, or arrive
  // before our own message row has committed. Both are no-ops, never failures.
  const existing = await prisma.message.findUnique({ where: { externalId: status.id } })
  if (!existing) return false
  if (DELIVERY_STATUS_RANK[mapped] <= DELIVERY_STATUS_RANK[existing.deliveryStatus]) return false

  const updated = await prisma.message.update({
    where: { id: existing.id },
    data: { deliveryStatus: mapped },
  })
  broadcast({ type: 'message.updated', conversationId: updated.conversationId, message: withMediaUrl(updated) })
  return true
}

// Meta's template-review verdicts, narrowed to the ones this app's TemplateMetaStatus
// enum can actually express. Meta also emits PAUSED / DISABLED / FLAGGED /
// PENDING_DELETION / REINSTATED / LIMIT_EXCEEDED; those are deliberately left
// unmapped and ignored rather than squashed into NOT_APPLICABLE, which in this
// schema means "this template never went to Meta at all" and would be a lie.
const TEMPLATE_META_STATUS_BY_EVENT: Record<string, TemplateMetaStatus> = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PENDING: 'PENDING',
}

/**
 * Applies one Meta template-review outcome to the local Template row it refers to.
 * This is the only way metaStatus ever moves off the PENDING that submission
 * returned -- Meta reviews templates hours after submission, out of band.
 * Returns true if a row was actually updated.
 *
 * Requires the `message_template_status_update` webhook field to be subscribed on
 * the app in Meta's dashboard; if it is not, no such payload ever arrives and this
 * is simply never called (no error, just no reconciliation).
 */
async function applyTemplateStatusUpdate(update: MetaTemplateStatusUpdate): Promise<boolean> {
  if (update.message_template_id === undefined || update.message_template_id === null) return false
  const mapped = TEMPLATE_META_STATUS_BY_EVENT[update.event ?? '']
  if (!mapped) return false

  // updateMany (not update) because metaId is not a unique column and, more
  // importantly, a verdict for a template this system never submitted is a
  // legitimate no-op rather than a failure. The metaStatus guard keeps Meta's
  // repeated/duplicate deliveries from generating pointless writes.
  const result = await prisma.template.updateMany({
    where: { metaId: String(update.message_template_id), metaStatus: { not: mapped } },
    data: { metaStatus: mapped },
  })
  return result.count > 0
}

/**
 * Runs the bot orchestrator against one already-ingested inbound message and dispatches
 * whatever it decides -- shared between the real webhook path (ingestSingleMessage below) and
 * /api/conversations/[id]/test-message, which simulates an inbound message for the pinned
 * sandbox conversation (src/lib/test-conversation.ts) so an admin can exercise the bot without
 * a real WhatsApp number. Caller is responsible for the botEnabled/non-empty-text gate --
 * this always runs the decision once called.
 */
export async function runBotForConversation(
  conversation: { id: string; contactName: string | null },
  inboundText: string
): Promise<void> {
  const decision = await decideAndRespond(conversation.id, inboundText)
  if (decision.mode === 'faq' || decision.mode === 'booking_context' || decision.mode === 'clarify') {
    const text = decision.mode === 'faq' ? decision.draft : decision.reply
    await sendMessage({ conversationId: conversation.id, text, sentBy: 'BOT', botTrace: decision })
  } else {
    // mode 'handoff' never dispatches a real WhatsApp message (fail-safe: silence + human
    // takeover), so we deliberately do NOT call sendMessage() here -- it always dispatches via
    // sendMetaText/sendCoexistText and requires reply text we don't have. Instead we write a
    // log-only Message row directly, mirroring the shape sendMessage() itself writes (see
    // src/lib/send.ts) so the decision is still auditable on the bot-log page.
    const created = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        type: 'text',
        content: null,
        // Never actually dispatched, so this has no delivery effect either way -- set to
        // match the default outbound channel policy (Settings.defaultChannel, currently
        // UNOFFICIAL) purely for consistency with every other message this row sits next to.
        channel: 'UNOFFICIAL',
        sentBy: 'BOT',
        botTrace: decision as never,
        deliveryStatus: 'SENT',
      },
    })
    broadcast({ type: 'message.created', conversationId: conversation.id, message: withMediaUrl(created) })

    // A handoff has to actually hand off: without flipping botEnabled the conversation
    // stays bot-driven, so it never reaches the dashboard's "needs attention" widget
    // (which queries botEnabled: false, assignedAgentId: null) AND every further message
    // from that customer re-runs the same decision, writing another audit row and
    // re-firing handoff.alert -- one notification per message. Unlike the old global kill
    // switch, the bot On/Off mode (Settings.botAutoReplyAll) never reaches this far: it is
    // enforced entirely by the conversation.botEnabled gate above (bulk-set by
    // src/app/api/bot/mode/route.ts), so every handoff reaching this branch is a genuine
    // per-conversation one and always flips botEnabled off.
    await prisma.conversation.update({ where: { id: conversation.id }, data: { botEnabled: false } })
    broadcast({ type: 'handoff.alert', conversationId: conversation.id, contactName: conversation.contactName })
  }
}

/**
 * The full per-message pipeline: idempotency, contact upsert, avatar enrichment,
 * conversation upsert, message row + broadcast, bot dispatch.
 */
async function ingestSingleMessage(message: MetaInboundMessage, contacts: MetaContact[] | undefined): Promise<boolean> {
  const existing = await prisma.message.findUnique({ where: { externalId: message.id } })
  if (existing) return false

  // Profile name comes from THIS change's own contacts array (each change carries its
  // own), matched on wa_id where possible -- a hoisted single value would attach one
  // sender's name to another sender's contact once several changes are batched.
  const profileName =
    contacts?.find((c) => c.wa_id === message.from)?.profile?.name ?? contacts?.[0]?.profile?.name ?? undefined

  const contact = await prisma.contact.upsert({
    where: { phone: message.from },
    update: profileName ? { name: profileName } : {},
    create: { phone: message.from, name: profileName ?? null },
  })

  await enrichContactAvatar(contact, message.from)

  const sentAt = parseMetaTimestamp(message.timestamp)
  const conversation = await prisma.conversation.upsert({
    where: { contactId: contact.id },
    update: { lastMessageAt: sentAt },
    create: { contactId: contact.id, lastMessageAt: sentAt, botEnabled: await defaultBotEnabled() },
  })

  const media = mediaObjectFor(message)

  // The parent may legitimately not exist locally (a reply to a message from before this
  // feature shipped, or one this system never ingested) -- that's a plain null replyToId,
  // not a failure, since the reply itself is still a perfectly good message on its own.
  const replyToId = message.context?.id
    ? (await prisma.message.findUnique({ where: { externalId: message.context.id } }))?.id ?? null
    : null

  try {
    const created = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        externalId: message.id,
        direction: 'INBOUND',
        type: message.type,
        content: message.text?.body ?? media?.caption ?? null,
        mediaId: media?.id ?? null,
        mimeType: media?.mime_type ?? null,
        fileName: media?.filename ?? null,
        replyToId,
        channel: 'OFFICIAL',
        sentBy: 'CUSTOMER',
        deliveryStatus: 'DELIVERED',
        createdAt: sentAt,
      },
      include: { replyTo: true },
    })
    broadcast({ type: 'message.created', conversationId: conversation.id, message: withMediaUrl(created) })
  } catch (error) {
    // Race condition: a concurrent delivery of the same message (Meta's at-least-once
    // retries) can pass the findUnique check above before either request's create()
    // commits. The DB's @unique constraint on externalId prevents a duplicate row, but
    // whichever request loses the race must still report a clean idempotent skip rather
    // than let the unique-constraint violation propagate as an unhandled 500.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return false
    }
    throw error
  }

  // The bot only ever sees text. Images/audio/location/stickers carry no question to
  // answer, and passing '' to decideAndRespond made Mode 3 generate an LLM reply to an
  // empty prompt -- an automated answer to a message nobody read. They are deliberately
  // NOT routed through the handoff branch either: a customer sending a photo is not a
  // bot failure, and firing handoff.alert (plus flipping botEnabled off) for it would
  // both misreport the bot-log/dashboard handoff counters and bury the real handoffs in
  // noise. The inbound message itself still broadcasts message.created and bumps the
  // conversation to the top of the inbox, which is the existing "a human should look at
  // this" signal.
  const inboundText = message.type === 'text' ? (message.text?.body ?? '') : ''
  const botCanAnswer = inboundText.trim().length > 0

  if (conversation.botEnabled && botCanAnswer) {
    await runBotForConversation({ id: conversation.id, contactName: contact.name }, inboundText)
  }

  return true
}

/**
 * Ingests one smb_message_echoes entry -- a message the business sent from the WhatsApp
 * Business app or a linked device (coexistence), not through this app. Deliberately a
 * separate function from ingestSingleMessage rather than a shared one with extra branches:
 * the contact lookup key is reversed (echo.to, the customer, vs an inbound message's
 * echo.from, the business itself) and there is no bot dispatch -- a human already handled
 * this message by typing it.
 */
async function ingestEchoedMessage(echo: MetaMessageEcho): Promise<boolean> {
  if (echo.type === 'revoke' || echo.type === 'edit') return false

  const existing = await prisma.message.findUnique({ where: { externalId: echo.id } })
  if (existing) return false

  const contact = await prisma.contact.upsert({
    where: { phone: echo.to },
    update: {},
    create: { phone: echo.to, name: null },
  })

  await enrichContactAvatar(contact, echo.to)

  const sentAt = parseMetaTimestamp(echo.timestamp)
  const conversation = await prisma.conversation.upsert({
    where: { contactId: contact.id },
    update: { lastMessageAt: sentAt },
    create: { contactId: contact.id, lastMessageAt: sentAt, botEnabled: await defaultBotEnabled() },
  })

  const media = mediaObjectFor(echo)
  const content = echo.text?.body ?? media?.caption ?? null

  // wa-coexist's send API never returns a message id (see sendCoexistText/sendCoexistMedia in
  // src/lib/coexist/client.ts) -- every Unofficial-channel message THIS app itself just sent
  // (agent or bot) is created with externalId: null, so it can never be matched against its own
  // future echo by id alone. When that same send's coexistence echo later arrives, blindly
  // creating a second row would double it up in the thread even though only one message ever
  // reached the customer. Instead, look for an unmatched self-sent row in this conversation with
  // the same content from moments ago and attach the now-known real wamid to THAT row, rather
  // than creating a duplicate. Scoped to a short window and to rows that still have no
  // externalId (once matched, a row drops out of consideration, so a second identical send
  // shortly after correctly matches its own separate row instead of colliding with this one).
  const SELF_SENT_MATCH_WINDOW_MS = 60_000
  const selfSent =
    content != null
      ? await prisma.message.findFirst({
          where: {
            conversationId: conversation.id,
            direction: 'OUTBOUND',
            channel: 'UNOFFICIAL',
            externalId: null,
            content,
            createdAt: { gte: new Date(sentAt.getTime() - SELF_SENT_MATCH_WINDOW_MS) },
          },
          orderBy: { createdAt: 'desc' },
          include: { replyTo: true },
        })
      : null

  if (selfSent) {
    const updated = await prisma.message.update({
      where: { id: selfSent.id },
      data: { externalId: echo.id },
      include: { replyTo: true },
    })
    broadcast({ type: 'message.updated', conversationId: conversation.id, message: withMediaUrl(updated) })
    return true
  }

  try {
    const created = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        externalId: echo.id,
        direction: 'OUTBOUND',
        type: echo.type,
        content,
        mediaId: media?.id ?? null,
        mimeType: media?.mime_type ?? null,
        fileName: media?.filename ?? null,
        // Deliberately UNOFFICIAL, even though this genuinely arrived via the Official Cloud
        // API's smb_message_echoes (a message sent from the phone app, not through wa-inbox at
        // all): the "Official" label is reserved for messages this app itself deliberately
        // dispatched that way (a template send, or an agent explicitly picking Official in
        // ComposeBox) -- an operator preference, not a claim about which Meta API carried it.
        channel: 'UNOFFICIAL',
        sentBy: 'AGENT',
        // Deliberately SENT, not DELIVERED: Meta's ordinary `statuses` receipts for this same
        // wamid (delivered/read) still arrive independently and applyStatusUpdate's rank
        // check already advances this row correctly when they do -- no special-casing needed.
        deliveryStatus: 'SENT',
        createdAt: sentAt,
      },
      include: { replyTo: true },
    })
    broadcast({ type: 'message.created', conversationId: conversation.id, message: withMediaUrl(created) })
  } catch (error) {
    // Same at-least-once-retry race as ingestSingleMessage: a concurrent delivery of the
    // same echo can pass the findUnique check above before either request's create() commits.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return false
    }
    throw error
  }

  return true
}

/**
 * A genuinely unexpected failure (DB down, etc.) is deliberately allowed to propagate:
 * the route then answers non-2xx and Meta retries the whole delivery, which is safe
 * because every step is idempotent. Swallowing it to return 200 would reintroduce
 * exactly the silent-loss failure mode this function was restructured to fix.
 */
export async function ingestMetaMessage(payload: MetaWebhookPayload): Promise<IngestResult> {
  let processed = 0
  let skipped = 0
  let statusUpdates = 0
  let templateStatusUpdates = 0
  let echoed = 0

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change?.value
      if (!value) continue

      // A template-review verdict arrives as its own change (field ===
      // 'message_template_status_update') carrying neither messages nor statuses.
      // Keyed off message_template_id rather than `field` so it still works if a
      // relaying BSP drops the field label -- nothing else in this webhook's
      // payload carries that key, so it cannot false-positive.
      if (value.message_template_id !== undefined && value.message_template_id !== null) {
        if (await applyTemplateStatusUpdate(value)) templateStatusUpdates += 1
        continue
      }

      for (const message of value.messages ?? []) {
        // Messages are processed sequentially: two messages from the same new contact in
        // one batch must not race each other's contact/conversation upserts.
        if (await ingestSingleMessage(message, value.contacts)) processed += 1
        else skipped += 1
      }

      for (const status of value.statuses ?? []) {
        if (await applyStatusUpdate(status)) statusUpdates += 1
      }

      for (const echo of value.message_echoes ?? []) {
        if (await ingestEchoedMessage(echo)) echoed += 1
      }
    }
  }

  return { processed, skipped, statusUpdates, templateStatusUpdates, echoed }
}
