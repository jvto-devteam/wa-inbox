import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// No in-route session guard, deliberately -- like every other route under
// /api/bot, this relies on src/middleware.ts for auth. A lone guarded route
// in an otherwise middleware-guarded group would be a second pattern, not
// extra safety (see src/app/api/bot/decisions/route.ts).
export async function GET(request: Request) {
  const reason = new URL(request.url).searchParams.get('reason') ?? undefined

  const gaps = await prisma.knowledgeGapLog.findMany({
    where: reason ? { reason } : {},
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { conversation: { include: { contact: true } } },
  })

  return NextResponse.json(
    gaps.map((g) => ({
      id: g.id,
      conversationId: g.conversationId,
      contactName: g.conversation.contact.name,
      topic: g.topic,
      reason: g.reason,
      messageText: g.messageText,
      createdAt: g.createdAt,
    }))
  )
}
