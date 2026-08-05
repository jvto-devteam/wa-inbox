import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'

/**
 * Wipes the pinned sandbox conversation's message history and TripBrief so a bot test can
 * start from a genuinely clean slate -- otherwise a customer-facing fact learned in an earlier
 * test (destination, origin, dayCount, finishCity) silently carries into the next one, which
 * makes results hard to trust while manually re-testing fixes. Gated on conversation.isTest,
 * mirroring test-message's own gate, so this can never wipe a real customer's message history.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id } })
  if (!conversation.isTest) {
    return NextResponse.json({ error: 'Endpoint ini hanya untuk percakapan tes' }, { status: 403 })
  }

  await prisma.message.deleteMany({ where: { conversationId: conversation.id } })
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { tripBrief: {}, botEnabled: true, lastReadAt: null },
  })
  broadcast({ type: 'conversation.cleared', conversationId: conversation.id })

  return NextResponse.json({ ok: true })
}
