import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET() {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  // "Jatuh tempo" (due) means due today OR earlier, so overdue reminders must still surface --
  // matches the end-of-today upper bound used by /api/reminders/due (Task 42), keeping the
  // definition of "due" consistent across both widgets.
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)

  const [openCount, handoffTodayCount, needsAttentionConvos, remindersDueRaw, waNumber] = await Promise.all([
    prisma.conversation.count({ where: { status: 'OPEN' } }),
    // A handoff decision is logged (Task 34) as a Message row with content: null, sentBy: 'BOT'
    // -- no real reply was ever sent (see src/lib/inbound.ts and the matching comments in
    // MessageBubble/ConversationListItem). Counting all sentBy: 'BOT' messages today would also
    // sweep in ordinary funnel/FAQ auto-replies, wildly overcounting "handoffs".
    prisma.message.count({ where: { sentBy: 'BOT', content: null, createdAt: { gte: startOfToday } } }),
    // "Needs attention" = handed off to a human (botEnabled: false) but nobody has picked it up
    // yet (assignedAgentId: null) -- an already-assigned conversation has an agent on it and
    // isn't "waiting for an agent" (see the reason text below).
    prisma.conversation.findMany({
      where: { status: 'OPEN', botEnabled: false, assignedAgentId: null },
      include: { contact: true },
      take: 20,
    }),
    prisma.reminder.findMany({
      where: { done: false, dueAt: { lte: endOfToday } },
      include: { contact: true },
      orderBy: { dueAt: 'asc' },
      take: 20,
    }),
    prisma.waNumber.findFirstOrThrow(),
  ])

  // Unofficial is send-only (see src/lib/coexist/client.ts) -- there's no
  // live connectivity probe against the target service anymore, just an
  // honest "is this channel configured at all" read of our own DB.
  const unofficialConfigured = Boolean(
    waNumber.coexistBaseUrl && waNumber.coexistApiKey && waNumber.coexistNumberKey
  )

  // There is deliberately no `unreadCount` here. Nothing in the Prisma schema tracks reads
  // (no lastReadAt on Conversation, no per-agent read marker), so the field could only ever
  // be a hardcoded 0 — it claimed "nothing unread" even with a queue of unanswered
  // customers, and nothing rendered it. Real unread tracking is a feature, not a bug fix.
  return NextResponse.json({
    openCount,
    handoffTodayCount,
    officialTokenValid: Boolean(waNumber.accessToken),
    unofficialConfigured,
    needsAttention: needsAttentionConvos.map((c) => ({
      id: c.id,
      contactName: c.contact.name,
      reason: 'Menunggu agen setelah handoff',
    })),
    remindersDue: remindersDueRaw.map((r) => ({ id: r.id, note: r.note, contactName: r.contact.name })),
  })
}
