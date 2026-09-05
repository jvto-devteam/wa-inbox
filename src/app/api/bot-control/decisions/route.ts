import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { readPaging } from '@/lib/bot-control/paging'

const INBOUND_PREVIEW_LENGTH = 140

/**
 * GET /api/bot-control/decisions — the audit log of bot decision runs.
 *
 * Read-only for any signed-in user (guidebook §19). Filters are `where` clauses so the count
 * and the page describe the same set.
 *
 * NOTE on the contact name: BotDecisionRun deliberately has no foreign key to Conversation
 * (see the model's own comment — an audit row must outlive what it describes), so the contact
 * cannot be `include`d. It is fetched in ONE extra query keyed by the conversation ids on this
 * page, not one query per row: at 50 rows a per-row lookup would be 50 round-trips for a
 * column that only decorates the table.
 */
export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const url = new URL(req.url)
  const { page, limit, skip } = readPaging(url)

  const where: Prisma.BotDecisionRunWhereInput = {}
  const status = url.searchParams.get('status')?.trim()
  const mode = url.searchParams.get('mode')?.trim()
  const conversationId = url.searchParams.get('conversationId')?.trim()
  const messageId = url.searchParams.get('messageId')?.trim()
  const dateFrom = url.searchParams.get('dateFrom')?.trim()
  const dateTo = url.searchParams.get('dateTo')?.trim()

  if (status) where.status = status
  if (mode) where.mode = mode
  if (conversationId) where.conversationId = conversationId
  // Used by the inbox trace popover to find the run behind one bot bubble.
  if (messageId) where.messageId = messageId

  // An unparseable date is ignored rather than 400'd: a half-typed date in a date picker
  // should show unfiltered results, not an error banner. `Invalid Date` reaching Prisma would
  // otherwise become a 500.
  const from = dateFrom ? new Date(dateFrom) : null
  const to = dateTo ? new Date(dateTo) : null
  const range: Prisma.DateTimeFilter = {}
  if (from && !Number.isNaN(from.getTime())) range.gte = from
  if (to && !Number.isNaN(to.getTime())) range.lte = to
  if (range.gte !== undefined || range.lte !== undefined) where.startedAt = range

  try {
    const [runs, total] = await Promise.all([
      prisma.botDecisionRun.findMany({ where, orderBy: { startedAt: 'desc' }, skip, take: limit }),
      prisma.botDecisionRun.count({ where }),
    ])

    const conversationIds = [...new Set(runs.map((run) => run.conversationId))]
    const conversations =
      conversationIds.length === 0
        ? []
        : await prisma.conversation.findMany({
            where: { id: { in: conversationIds } },
            select: { id: true, contact: { select: { name: true, phone: true } } },
          })
    const contactByConversation = new Map(conversations.map((c) => [c.id, c.contact]))

    return NextResponse.json({
      items: runs.map((run) => {
        const contact = contactByConversation.get(run.conversationId)
        return {
          id: run.id,
          conversationId: run.conversationId,
          messageId: run.messageId,
          // Null when the conversation has since been deleted — the audit row survives it, and
          // saying so is more useful than an empty cell that looks like a bug.
          contactName: contact?.name ?? null,
          contactPhone: contact?.phone ?? null,
          mode: run.mode,
          status: run.status,
          inboundPreview: run.inboundText.slice(0, INBOUND_PREVIEW_LENGTH),
          latencyMs: run.latencyMs,
          knowledgeRefsCount: countKnowledgeRefs(run.knowledgeRefs),
          hasVerification: run.verification != null,
          error: run.error,
          startedAt: run.startedAt.toISOString(),
        }
      }),
      page,
      limit,
      total,
    })
  } catch (error) {
    console.error('GET /api/bot-control/decisions gagal', error)
    return NextResponse.json({ error: 'Gagal memuat log keputusan' }, { status: 500 })
  }
}

/** knowledgeRefs is a free-form Json column; only an object or array can be counted. */
function countKnowledgeRefs(value: Prisma.JsonValue): number {
  if (Array.isArray(value)) return value.length
  if (value !== null && typeof value === 'object') return Object.keys(value).length
  return 0
}
