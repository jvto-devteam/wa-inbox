import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { serializeMessage } from '@/lib/serialize-message'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const messages = await prisma.message.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: 'asc' },
    include: { replyTo: true },
  })
  return NextResponse.json(messages.map(serializeMessage))
}
