import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { withMediaUrl } from '@/lib/serialize-message'
import { runBotForConversation } from '@/lib/inbound'
import { parseJsonBody } from '@/lib/parse-json'

const bodySchema = z.object({ text: z.string().min(1) })

/**
 * Simulates one inbound customer message for the pinned sandbox conversation
 * (src/lib/test-conversation.ts) and runs the bot against it -- an admin talks to this
 * endpoint as if they were the customer, to exercise the bot without a real WhatsApp number.
 * Gated on conversation.isTest so this can never be used to fabricate an inbound message on a
 * real customer's conversation.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = await parseJsonBody(req, bodySchema, 'Pesan wajib diisi')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id },
    include: { contact: true },
  })
  if (!conversation.isTest) {
    return NextResponse.json({ error: 'Endpoint ini hanya untuk percakapan tes' }, { status: 403 })
  }

  const created = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'INBOUND',
      type: 'text',
      content: parsed.data.text,
      channel: 'UNOFFICIAL',
      sentBy: 'CUSTOMER',
      deliveryStatus: 'DELIVERED',
    },
    include: { replyTo: true },
  })
  await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: created.createdAt } })
  broadcast({ type: 'message.created', conversationId: conversation.id, message: withMediaUrl(created) })

  if (conversation.botEnabled) {
    await runBotForConversation({ id: conversation.id, contactName: conversation.contact.name }, parsed.data.text)
  }

  return NextResponse.json(withMediaUrl(created))
}
