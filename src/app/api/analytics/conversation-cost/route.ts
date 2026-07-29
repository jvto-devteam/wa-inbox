import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getConversationCosts, type ConversationCategory } from '@/lib/meta/analytics'

const DAY_SECONDS = 86400
const DEFAULT_DAYS = 30
// Meta's conversation_analytics edge only accepts ranges up to 90 days per request.
const MAX_DAYS = 90

function clampDays(raw: string | null): number {
  const parsed = raw ? Number(raw) : DEFAULT_DAYS
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_DAYS
  return Math.min(parsed, MAX_DAYS)
}

// Backs the admin-only "Histori Biaya Percakapan" panel on Settings. There is no Graph API
// endpoint for the WABA's payment-method wallet/threshold balance itself -- Meta never exposes
// that outside Business Manager's own billing UI -- so this deliberately surfaces only what
// IS queryable: the conversation-based cost breakdown Meta actually bills against.
export async function GET(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa melihat histori biaya' }, { status: 403 })

  const days = clampDays(new URL(req.url).searchParams.get('days'))
  const endUnix = Math.floor(Date.now() / 1000)
  const startUnix = endUnix - days * DAY_SECONDS

  const waNumber = await prisma.waNumber.findFirstOrThrow()

  try {
    const { currency, dataPoints } = await getConversationCosts(waNumber, { startUnix, endUnix })

    const byCategory = new Map<string, { category: string; cost: number; conversationCount: number }>()
    const byDay = new Map<string, number>()
    let totalCost = 0

    for (const point of dataPoints) {
      const category: ConversationCategory | 'UNKNOWN' = point.conversationCategory ?? 'UNKNOWN'
      const existing = byCategory.get(category) ?? { category, cost: 0, conversationCount: 0 }
      existing.cost += point.cost
      existing.conversationCount += point.conversationCount
      byCategory.set(category, existing)

      const date = new Date(point.start * 1000).toISOString().slice(0, 10)
      byDay.set(date, (byDay.get(date) ?? 0) + point.cost)

      totalCost += point.cost
    }

    return NextResponse.json({
      currency,
      totalCost,
      byCategory: [...byCategory.values()].sort((a, b) => b.cost - a.cost),
      daily: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, cost]) => ({ date, cost })),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal mengambil histori biaya dari Meta'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
