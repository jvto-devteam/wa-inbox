import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/get-session'
import { prisma } from '@/lib/db'

/**
 * GET /api/new/unread — jumlah percakapan yang punya pesan masuk belum dibaca, untuk lencana Inbox di menu /new.
 * Baca saja. "Belum dibaca" = definisi yang sama dengan `unreadCount` per baris di GET /api/conversations: pesan
 * INBOUND yang lebih baru dari `lastReadAt`. Percakapan sandbox (`isTest`) tidak dihitung.
 */
export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const [row] = await prisma.$queryRaw<{ n: number }[]>`
      select count(*)::int as n from "Conversation" c
      where c."isTest" = false and exists (
        select 1 from "Message" m
        where m."conversationId" = c.id and m.direction = 'INBOUND' and m."createdAt" > coalesce(c."lastReadAt", to_timestamp(0))
      )`
    return NextResponse.json({ unread: row?.n ?? 0 })
  } catch (error) {
    console.error('GET /api/new/unread gagal', { error })
    return NextResponse.json({ error: 'Gagal menghitung chat belum dibaca' }, { status: 500 })
  }
}
