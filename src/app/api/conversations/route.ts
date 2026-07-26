import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(_req: Request) {
  const conversations = await prisma.conversation.findMany({
    orderBy: { lastMessageAt: 'desc' },
    include: {
      contact: true,
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      labels: { include: { label: true } },
    },
  })

  return NextResponse.json(conversations.map((c) => ({
    id: c.id,
    contactName: c.contact.name,
    contactPhone: c.contact.phone,
    lastMessage: c.messages[0]?.content ?? null,
    lastMessageSentBy: c.messages[0]?.sentBy ?? null,
    lastMessageAt: c.lastMessageAt.toISOString(),
    unreadCount: 0,
    botEnabled: c.botEnabled,
    status: c.status,
    labels: c.labels.map((l) => ({ id: l.label.id, name: l.label.name, color: l.label.color })),
  })))
}
