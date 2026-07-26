import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const messages = await prisma.message.findMany({ where: { conversationId: id }, orderBy: { createdAt: 'asc' } })
  return NextResponse.json(messages.map((m) => ({
    id: m.id,
    direction: m.direction,
    content: m.content,
    channel: m.channel,
    sentBy: m.sentBy,
    deliveryStatus: m.deliveryStatus,
    createdAt: m.createdAt.toISOString(),
    botTrace: m.botTrace,
  })))
}
