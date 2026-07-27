import { prisma } from '@/lib/db'
import { sendMetaText } from '@/lib/meta/messages'
import { sendCoexistText } from '@/lib/coexist/client'
import { resolveChannel } from '@/lib/channel-router'
import { broadcast } from '@/lib/realtime'
import { withMediaUrl } from '@/lib/serialize-message'

export async function sendMessage(params: {
  conversationId: string
  text: string
  channel?: 'OFFICIAL' | 'UNOFFICIAL'
  sentBy: 'AGENT' | 'BOT'
  agentId?: string
  botTrace?: unknown
  replyToId?: string
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
  try {
    if (channel === 'OFFICIAL') {
      const result = await sendMetaText(waNumber, conversation.contact.phone, params.text, replyToExternalId)
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
      type: 'text',
      content: params.text,
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
