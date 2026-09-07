import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { readPaging } from '@/lib/bot-control/paging'
import { TRIAGE_ISSUE_TYPES, TRIAGE_SEVERITIES, TRIAGE_STATUSES } from '@/lib/bot-control/triage'

/**
 * GET /api/bot-control/decisions/triage — the follow-up queue.
 *
 * Open rows first, then newest. Sorting purely by date would bury an OPEN item from last week
 * under a dozen resolved ones from today, and a queue whose top row is already done is a queue
 * people stop opening.
 *
 * Each row carries the decision it is about — the inbound text and the contact — because a
 * triage list showing only issue types answers "how many problems" but never "which ones".
 * That lookup is ONE extra query for the page, not one per row: `BotDecisionRun` has no foreign
 * key from here (both are audit records that must outlive what they describe), so it cannot be
 * `include`d.
 */
const INBOUND_PREVIEW_LENGTH = 140

/** RESOLVED and IGNORED sort last; among the rest, newest first. */
const OPEN_STATUSES = ['OPEN', 'ASSIGNED']

export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const url = new URL(req.url)
  const { page, limit, skip } = readPaging(url)

  const where: Prisma.BotDecisionTriageWhereInput = {}
  const status = url.searchParams.get('status')?.trim()
  const issueType = url.searchParams.get('issueType')?.trim()
  const severity = url.searchParams.get('severity')?.trim()
  const assignedTo = url.searchParams.get('assignedTo')?.trim()
  const open = url.searchParams.get('open')

  // Validated against the known sets: an unknown value returning zero rows reads as "nothing to
  // do", which is the most misleading thing a follow-up queue can say.
  if (status && (TRIAGE_STATUSES as readonly string[]).includes(status)) where.status = status
  if (issueType && (TRIAGE_ISSUE_TYPES as readonly string[]).includes(issueType)) where.issueType = issueType
  if (severity && (TRIAGE_SEVERITIES as readonly string[]).includes(severity)) where.severity = severity
  if (assignedTo) where.assignedTo = assignedTo
  if (open === 'true') where.status = { in: OPEN_STATUSES }

  try {
    const [rows, total] = await Promise.all([
      prisma.botDecisionTriage.findMany({
        where,
        // Postgres orders NULLs and strings, not "openness", so the split is expressed as two
        // keys: status ascending happens to put ASSIGNED and OPEN before RESOLVED/IGNORED
        // alphabetically, and updatedAt breaks the tie the way an operator expects.
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        skip,
        take: limit,
      }),
      prisma.botDecisionTriage.count({ where }),
    ])

    const runIds = [...new Set(rows.map((row) => row.decisionRunId))]
    const runs =
      runIds.length === 0
        ? []
        : await prisma.botDecisionRun.findMany({
            where: { id: { in: runIds } },
            select: { id: true, conversationId: true, inboundText: true, status: true, mode: true, startedAt: true },
          })
    const runById = new Map(runs.map((run) => [run.id, run]))

    const actorIds = [
      ...new Set(rows.flatMap((row) => [row.assignedTo, row.resolvedBy]).filter((v): v is string => v !== null)),
    ]
    const accounts =
      actorIds.length === 0
        ? []
        : await prisma.account.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    const nameById = new Map(accounts.map((a) => [a.id, a.name]))

    return NextResponse.json({
      items: rows.map((row) => {
        const run = runById.get(row.decisionRunId)
        return {
          id: row.id,
          decisionRunId: row.decisionRunId,
          status: row.status,
          issueType: row.issueType,
          severity: row.severity,
          assignedTo: row.assignedTo,
          assignedToName: row.assignedTo ? nameById.get(row.assignedTo) ?? null : null,
          note: row.note,
          linkedEntityType: row.linkedEntityType,
          linkedEntityId: row.linkedEntityId,
          resolvedBy: row.resolvedBy,
          resolvedByName: row.resolvedBy ? nameById.get(row.resolvedBy) ?? null : null,
          resolvedAt: row.resolvedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          // Null when the decision has been cleared. The triage survives it by design, and an
          // empty preview is more honest than dropping the row.
          decision: run
            ? {
                conversationId: run.conversationId,
                inboundPreview: run.inboundText.slice(0, INBOUND_PREVIEW_LENGTH),
                status: run.status,
                mode: run.mode,
                startedAt: run.startedAt.toISOString(),
              }
            : null,
        }
      }),
      page,
      limit,
      total,
    })
  } catch (error) {
    console.error('GET /api/bot-control/decisions/triage gagal', error)
    return NextResponse.json({ error: 'Gagal memuat daftar tindak lanjut' }, { status: 500 })
  }
}
