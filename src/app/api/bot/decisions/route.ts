import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

export async function GET(req: Request) {
  const mode = new URL(req.url).searchParams.get('mode')

  // The mode filter has to live in the `where` clause, not in a post-query
  // `.filter()`. `take: 200` is applied by the database BEFORE any JS runs, so
  // filtering afterwards means "the most recent 200 bot messages, of which the
  // handoffs" — on a busy day dominated by faq/funnel replies that is
  // legitimately empty even when real handoffs exist, in the one feature whose
  // entire purpose is bot-decision auditability.
  //
  // `botTrace` is a nullable Json column on Postgres, so Prisma's JSON-path
  // filter takes `path` as a string ARRAY of key segments (the MySQL-style
  // `'$.mode'` string form is not accepted by the postgres connector).
  //
  // Note: the `unknown` mode surfaced below is a display-only fallback for rows
  // with no botTrace at all — it is not a stored value, so `?mode=unknown` is
  // not a queryable filter and correctly returns nothing. The UI's filter
  // dropdown only offers real, stored modes.
  const where: Prisma.MessageWhereInput = { sentBy: 'BOT' }
  if (mode) where.botTrace = { path: ['mode'], equals: mode }

  const messages = await prisma.message.findMany({
    where,
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

  return NextResponse.json(decisions)
}
