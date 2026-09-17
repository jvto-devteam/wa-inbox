import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { ensureTestConversation } from '@/lib/test-conversation'
import { bookingGuestName } from '@/lib/booking/display-name'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = url.searchParams.get('q')?.trim() || null
  const orderChannel = url.searchParams.get('orderChannel')?.trim() || null
  const labelId = url.searchParams.get('labelId')?.trim() || null

  // Only on the unfiltered load -- a search's own result set deciding whether the sandbox
  // room matches is normal filtering behavior, no need to re-upsert on every keystroke.
  if (!q) await ensureTestConversation()

  const where: Prisma.ConversationWhereInput = {}
  if (q) {
    where.OR = [
      { contact: { name: { contains: q, mode: 'insensitive' } } },
      { contact: { phone: { contains: q } } },
      { messages: { some: { content: { contains: q, mode: 'insensitive' } } } },
    ]
  }
  if (orderChannel) {
    where.orderChannel = orderChannel
  }
  // The inbox filter row is single-select (one pill active at a time), so the UI never sends
  // both -- but nothing here stops a caller from combining them, same as `q` above.
  if (labelId) {
    where.labels = { some: { labelId } }
  }

  const conversations = await prisma.conversation.findMany({
    where: Object.keys(where).length ? where : undefined,
    orderBy: [{ isPinned: 'desc' }, { lastMessageAt: 'desc' }],
    include: {
      contact: true,
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      labels: { include: { label: true } },
    },
  })

  // One count query per conversation rather than a single aggregated one: Prisma
  // can't compare a relation's own column (Message.createdAt) against another
  // column on the parent row (Conversation.lastReadAt) within one query, and at
  // this app's scale (a single tour operator's inbox) that's the same accepted
  // trade-off the rest of this codebase already makes (see Message's `content`
  // index comment) rather than reaching for raw SQL.
  const unreadCounts = await Promise.all(
    conversations.map((c) =>
      prisma.message.count({
        where: { conversationId: c.id, direction: 'INBOUND', createdAt: { gt: c.lastReadAt ?? new Date(0) } },
      })
    )
  )

  return NextResponse.json(conversations.map((c, i) => ({
    id: c.id,
    contactName: c.contact.name,
    contactPhone: c.contact.phone,
    avatarUrl: c.contact.avatarUrl,
    lastMessage: c.messages[0]?.content ?? null,
    lastMessageSentBy: c.messages[0]?.sentBy ?? null,
    lastMessageAt: c.lastMessageAt.toISOString(),
    botEnabled: c.botEnabled,
    status: c.status,
    pipelineStage: c.pipelineStage,
    // Sidebar shows this instead of the Bot/Agen badge -- null (no badge at all) until
    // there's an actual booking on file. A dedicated column (see schema.prisma), not parsed
    // out of bookingData: it's snapshotted once and permanent, unlike the rest of bookingData.
    orderChannel: c.orderChannel,
    // Nama dari data booking (bookingData.guest), ditampilkan di samping nama kontak WhatsApp
    // lewat contactDisplayName -- lihat src/lib/booking/display-name.ts.
    bookingGuestName: bookingGuestName(c.bookingData),
    isPinned: c.isPinned,
    isTest: c.isTest,
    unreadCount: unreadCounts[i],
    labels: c.labels.map((l) => ({ id: l.label.id, name: l.label.name, color: l.label.color })),
  })))
}
