import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// Distinct values actually on file, not a hardcoded JVTO/KLOOK/TWT list -- orderChannel is
// snapshotted per-booking (see Conversation.orderChannel), so whichever platforms have sent
// a booking so far are exactly the ones worth offering as a filter.
export async function GET() {
  const rows = await prisma.conversation.findMany({
    where: { orderChannel: { not: null } },
    select: { orderChannel: true },
    distinct: ['orderChannel'],
    orderBy: { orderChannel: 'asc' },
  })
  return NextResponse.json(rows.map((r) => r.orderChannel))
}
