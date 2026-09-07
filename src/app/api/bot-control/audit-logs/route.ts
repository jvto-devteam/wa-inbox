import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'
import { readPaging } from '@/lib/bot-control/paging'
import { AUDIT_ACTIONS } from '@/lib/bot-control/audit'

/**
 * GET /api/bot-control/audit-logs — the Bot Control change timeline.
 *
 * Admin-only, per the permission matrix (SDD Manage Second §13: AGENT is "No" for audit logs).
 * The rows carry actor identity, IP and user-agent, and before/after values for every
 * configuration change in the account — that is a narrower audience than the rest of Bot
 * Control by design.
 *
 * READ-ONLY, and there is deliberately no POST, PATCH or DELETE anywhere under this path. An
 * audit log an operator can edit is not an audit log; §9.9 states the same. Rows are written
 * only by `writeBotAuditLog`, from the code path performing the action being recorded.
 *
 * `ipAddress` and `userAgent` are stored but NOT returned. They exist so a specific incident
 * can be investigated deliberately, not so every admin opening a page gets a running feed of
 * their colleagues' locations and devices.
 */
export async function GET(req: Request) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: 'Hanya admin yang bisa melihat audit log' }, { status: 403 })
  }

  const url = new URL(req.url)
  const { page, limit, skip } = readPaging(url)

  const where: Prisma.BotControlAuditLogWhereInput = {}
  const action = url.searchParams.get('action')?.trim()
  const entityType = url.searchParams.get('entityType')?.trim()
  const entityId = url.searchParams.get('entityId')?.trim()
  const actorId = url.searchParams.get('actorId')?.trim()
  const releaseId = url.searchParams.get('releaseId')?.trim()

  if (action && (AUDIT_ACTIONS as readonly string[]).includes(action)) where.action = action
  if (entityType) where.entityType = entityType
  if (entityId) where.entityId = entityId
  if (actorId) where.actorId = actorId
  if (releaseId) where.releaseId = releaseId

  // An unparseable date is ignored rather than 400'd, matching the decisions endpoint: a
  // half-typed value in a date picker should show unfiltered rows, and an `Invalid Date`
  // reaching Prisma would turn that into a 500.
  const range: Prisma.DateTimeFilter = {}
  const from = url.searchParams.get('dateFrom')?.trim()
  const to = url.searchParams.get('dateTo')?.trim()
  const parsedFrom = from ? new Date(from) : null
  const parsedTo = to ? new Date(to) : null
  if (parsedFrom && !Number.isNaN(parsedFrom.getTime())) range.gte = parsedFrom
  if (parsedTo && !Number.isNaN(parsedTo.getTime())) range.lte = parsedTo
  if (range.gte !== undefined || range.lte !== undefined) where.createdAt = range

  try {
    const [logs, total] = await Promise.all([
      prisma.botControlAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.botControlAuditLog.count({ where }),
    ])

    return NextResponse.json({
      items: logs.map((log) => ({
        id: log.id,
        actorId: log.actorId,
        // Denormalised at write time on purpose: an audit row must stay readable after the
        // account that produced it is deleted, and a join could not deliver that.
        actorName: log.actorName,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        entityKey: log.entityKey,
        // Already narrowed to changed fields and already sanitised at write time (audit.ts),
        // so they are served as stored rather than filtered again on the way out.
        before: log.before,
        after: log.after,
        reason: log.reason,
        releaseId: log.releaseId,
        createdAt: log.createdAt.toISOString(),
      })),
      page,
      limit,
      total,
    })
  } catch (error) {
    console.error('GET /api/bot-control/audit-logs gagal', error)
    return NextResponse.json({ error: 'Gagal memuat audit log' }, { status: 500 })
  }
}
