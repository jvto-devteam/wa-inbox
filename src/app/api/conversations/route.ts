import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim() || null

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
    botEnabled: c.botEnabled,
    status: c.status,
    labels: c.labels.map((l) => ({ id: l.label.id, name: l.label.name, color: l.label.color })),
  })))
}
