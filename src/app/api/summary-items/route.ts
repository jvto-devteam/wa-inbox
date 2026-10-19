import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { reconcileSummaryItems } from '@/lib/summary-items/sync'
import { SUMMARY_ITEM_INCLUDE, toSummaryItemView, type SummaryItemView } from '@/lib/summary-items/view'

/**
 * GET /api/summary-items — antrean tindakan Summary Harian. Rekonsiliasi dulu dengan pesan
 * dan pengingat terbaru, lalu OPEN (REPLY, lalu FOLLOW_UP, lalu PROMISE; tertua dulu) dan SCHEDULED
 * (jatuh tempo terdekat dulu). Terbuka untuk semua yang login, seperti /api/daily-summary.
 */
export type SummaryItemsResponse = { open: SummaryItemView[]; scheduled: SummaryItemView[]; openGapTotal: number }

export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await reconcileSummaryItems()
    const [rows, openGapTotal] = await Promise.all([
      prisma.summaryItem.findMany({
        where: { state: { in: ['OPEN', 'SCHEDULED'] } },
        include: SUMMARY_ITEM_INCLUDE,
      }),
      prisma.knowledgeGapLog.count({ where: { resolvedAt: null, conversation: { isTest: false } } }),
    ])

    const KIND_RANK: Record<string, number> = { REPLY: 0, FOLLOW_UP: 1, PROMISE: 2 }
    const kindRank = (k: string) => KIND_RANK[k] ?? 3
    const open = rows
      .filter((r) => r.state === 'OPEN')
      .sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.anchorAt.getTime() - b.anchorAt.getTime())
      .map(toSummaryItemView)
    const scheduled = rows
      .filter((r) => r.state === 'SCHEDULED')
      .sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0))
      .map(toSummaryItemView)

    const body: SummaryItemsResponse = { open, scheduled, openGapTotal }
    return NextResponse.json(body)
  } catch (err) {
    console.error('GET /api/summary-items failed', err)
    return NextResponse.json({ error: 'Gagal memuat antrean' }, { status: 500 })
  }
}
