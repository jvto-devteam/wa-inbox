import { prisma } from '@/lib/db'
import { sendMetaText } from '@/lib/meta/messages'
import { sendCoexistText } from '@/lib/coexist/client'
import { resolveChannel } from '@/lib/channel-router'
import { broadcast } from '@/lib/realtime'

export async function sendMessage(params: {
  conversationId: string
  text: string
  channel?: 'OFFICIAL' | 'UNOFFICIAL'
  sentBy: 'AGENT' | 'BOT'
  agentId?: string
  botTrace?: unknown
}) {
  const channel = await resolveChannel(params.channel)
  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: params.conversationId },
    include: { contact: true },
  })
  const waNumber = await prisma.waNumber.findFirstOrThrow()

  let externalId: string | undefined
  let deliveryStatus: 'SENT' | 'FAILED' = 'SENT'
  try {
    if (channel === 'OFFICIAL') {
      const result = await sendMetaText(waNumber, conversation.contact.phone, params.text)
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
    },
  })
  broadcast({ type: 'message.created', conversationId: params.conversationId, message: created })
  return created
}
