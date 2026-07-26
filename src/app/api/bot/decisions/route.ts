import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(req: Request) {
  const mode = new URL(req.url).searchParams.get('mode')
  const messages = await prisma.message.findMany({
    where: { sentBy: 'BOT' },
    include: { conversation: { include: { contact: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  const decisions = messages.map((m) => ({
    id: m.id,
    conversationId: m.conversationId,
    contactName: m.conversation.contact?.name ?? null,
    mode: (m.botTrace as { mode: string } | null)?.mode ?? 'unknown',
    trace: m.botTrace,
    createdAt: m.createdAt.toISOString(),
  }))

  return NextResponse.json(mode ? decisions.filter((d) => d.mode === mode) : decisions)
}
