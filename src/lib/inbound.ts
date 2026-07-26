import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'

export type MetaWebhookPayload = {
  entry: Array<{
    changes: Array<{
      value: {
        contacts?: Array<{ profile: { name: string }; wa_id: string }>
        messages?: Array<{
          id: string
          from: string
          timestamp: string
          type: string
          text?: { body: string }
        }>
      }
    }>
  }>
}

export async function ingestMetaMessage(payload: MetaWebhookPayload): Promise<{ skipped: boolean }> {
  const change = payload.entry?.[0]?.changes?.[0]?.value
  const message = change?.messages?.[0]
  if (!message) return { skipped: true }

  const existing = await prisma.message.findUnique({ where: { externalId: message.id } })
  if (existing) return { skipped: true }

  const profileName = change?.contacts?.[0]?.profile.name
  const contact = await prisma.contact.upsert({
    where: { phone: message.from },
    update: profileName ? { name: profileName } : {},
    create: { phone: message.from, name: profileName ?? null },
  })

  if (!contact.avatarUrl) {
    const waNumber = await prisma.waNumber.findFirstOrThrow()
    try {
      const res = await fetch(`${waNumber.coexistBaseUrl}/api/contact/${message.from}@s.whatsapp.net/avatar`)
      const { url } = await res.json()
      if (url) await prisma.contact.update({ where: { id: contact.id }, data: { avatarUrl: url } })
    } catch {
      // wa-coexist unreachable — leave avatarUrl null, not fatal to message ingestion
    }
  }

  const conversation = await prisma.conversation.upsert({
    where: { contactId: contact.id },
    update: { lastMessageAt: new Date(Number(message.timestamp) * 1000) },
    create: { contactId: contact.id, lastMessageAt: new Date(Number(message.timestamp) * 1000) },
  })

  try {
    const created = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        externalId: message.id,
        direction: 'INBOUND',
        type: message.type,
        content: message.text?.body ?? null,
        channel: 'OFFICIAL',
        sentBy: 'CUSTOMER',
        deliveryStatus: 'DELIVERED',
        createdAt: new Date(Number(message.timestamp) * 1000),
      },
    })
    broadcast({ type: 'message.created', conversationId: conversation.id, message: created })
  } catch (error) {
    // Race condition: a concurrent delivery of the same message (Meta's at-least-once
    // retries) can pass the findUnique check above before either request's create()
    // commits. The DB's @unique constraint on externalId prevents a duplicate row, but
    // whichever request loses the race must still report a clean idempotent skip rather
    // than let the unique-constraint violation propagate as an unhandled 500.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { skipped: true }
    }
    throw error
  }

  return { skipped: false }
}
