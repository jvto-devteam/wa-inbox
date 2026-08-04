import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ensureTestConversation } from '@/lib/test-conversation'

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim() || null

  // Only on the unfiltered load -- a search's own result set deciding whether the sandbox
  // room matches is normal filtering behavior, no need to re-upsert on every keystroke.
  if (!q) await ensureTestConversation()

  const conversations = await prisma.conversation.findMany({
    where: q
      ? {
          OR: [
            { contact: { name: { contains: q, mode: 'insensitive' } } },
            { contact: { phone: { contains: q } } },
            { messages: { some: { content: { contains: q, mode: 'insensitive' } } } },
          ],
        }
      : undefined,
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
    isPinned: c.isPinned,
    isTest: c.isTest,
    unreadCount: unreadCounts[i],
    labels: c.labels.map((l) => ({ id: l.label.id, name: l.label.name, color: l.label.color })),
  })))
}
