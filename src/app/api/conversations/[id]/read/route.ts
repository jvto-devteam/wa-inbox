import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

/**
 * Marks a conversation as read up to now. Called when an agent opens a thread,
 * and again whenever a new inbound message arrives while that thread is already
 * open (see ThreadView's SSE handler) -- otherwise a message received while the
 * agent was actively looking at the conversation would still show as unread the
 * moment they navigated away.
 */
export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const conversation = await prisma.conversation.update({ where: { id }, data: { lastReadAt: new Date() } })
  return NextResponse.json({ lastReadAt: conversation.lastReadAt!.toISOString() })
}
