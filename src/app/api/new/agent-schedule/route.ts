import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { jakartaDay } from '@/lib/bot/eval/replay-pairs'
import { addDays } from '@/lib/new/report'

/**
 * GET /api/new/agent-schedule — tab "Jadwal agent" di Antrean /new: salinan jadwal reminder WhatsApp cron legacy
 * (AgentSchedule, disegarkan tick 5 menit dari new-backoffice). Mulai kemarin WIB, urut jam kirim. Read-only.
 * Terbuka untuk semua yang login, seperti /api/summary-items.
 */
export type AgentScheduleRow = {
  key: string
  kind: string
  bookingCode: string | null
  bookingStatus: string | null
  guestName: string | null
  phoneTail: string | null
  conversationId: string | null
  recipient: string
  sendAt: string
  status: string
}
export type AgentScheduleResponse = { items: AgentScheduleRow[]; refreshedAt: string | null }

const TAKE = 300

export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const from = new Date(addDays(jakartaDay(new Date()), -1) + 'T00:00:00+07:00')
    const rows = await prisma.agentSchedule.findMany({
      where: { sendAt: { gte: from } },
      orderBy: [{ sendAt: 'asc' }, { key: 'asc' }],
      take: TAKE,
    })
    const latest = await prisma.agentSchedule.aggregate({ _max: { refreshedAt: true } })
    const body: AgentScheduleResponse = {
      items: rows.map((r) => ({
        key: r.key, kind: r.kind, bookingCode: r.bookingCode, bookingStatus: r.bookingStatus, guestName: r.guestName,
        phoneTail: r.phoneTail, conversationId: r.conversationId, recipient: r.recipient, sendAt: r.sendAt.toISOString(), status: r.status,
      })),
      refreshedAt: latest._max.refreshedAt?.toISOString() ?? null,
    }
    return NextResponse.json(body)
  } catch (err) {
    console.error('GET /api/new/agent-schedule failed', err)
    return NextResponse.json({ error: 'Gagal memuat jadwal agent' }, { status: 500 })
  }
}
