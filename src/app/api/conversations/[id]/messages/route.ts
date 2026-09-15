import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { serializeMessage, type MessageKnowledgeGap } from '@/lib/serialize-message'
import { draftsForConversation } from '@/lib/inbox/message-draft'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const messages = await prisma.message.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: 'asc' },
    include: { replyTo: true },
  })
  const messageIds = messages.map((message) => message.id)
  const gaps = messageIds.length > 0
    ? await prisma.knowledgeGapLog.findMany({
        where: { resolvedAt: null, messageId: { in: messageIds } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          messageId: true,
          topic: true,
          reason: true,
          messageText: true,
          missingQuestion: true,
          answerSnippet: true,
          answerParagraph: true,
          createdAt: true,
        },
      })
    : []
  const { bySourceMessageId, sentMessageIds } = await draftsForConversation(id)

  const gapsByMessageId = new Map<string, MessageKnowledgeGap>()
  for (const gap of gaps) {
    if (!gap.messageId || gapsByMessageId.has(gap.messageId)) continue
    gapsByMessageId.set(gap.messageId, {
      id: gap.id,
      topic: gap.topic,
      reason: gap.reason,
      messageText: gap.messageText,
      missingQuestion: gap.missingQuestion,
      answerSnippet: gap.answerSnippet,
      answerParagraph: gap.answerParagraph,
      createdAt: gap.createdAt.toISOString(),
    })
  }

  return NextResponse.json(
    messages.map((message) =>
      serializeMessage(message, gapsByMessageId.get(message.id) ?? null, {
        draft: bySourceMessageId.get(message.id) ?? null,
        fromDraft: sentMessageIds.has(message.id),
      })
    )
  )
}
