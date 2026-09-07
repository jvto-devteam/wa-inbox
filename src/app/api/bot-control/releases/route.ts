import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { requireAdmin } from '@/lib/auth/require-admin'
import { parseJsonBody } from '@/lib/parse-json'
import { readPaging } from '@/lib/bot-control/paging'
import {
  publishRelease,
  readReleaseSnapshot,
  ReleaseBlockedError,
  ReleaseTestGateError,
  ReleaseVersionConflictError,
  RELEASE_STATUSES,
} from '@/lib/bot-control/release'
import { roleFromAccount } from '@/lib/bot-control/permissions'

/**
 * GET /api/bot-control/releases — the publish history.
 * POST /api/bot-control/releases — publish a new release.
 *
 * Reading is open to any signed-in user, because "what is live right now, and when did it
 * change" is the question every agent asks the moment the bot behaves unexpectedly, and making
 * them ask an admin turns a five-second lookup into a support thread. Publishing is admin-only,
 * per the permission matrix in SDD Manage Second §13.
 *
 * The row deliberately does NOT include the snapshot body. A snapshot grows with every phase
 * (rules, then knowledge, then flows, then channel policy), and shipping all of them in a list
 * response would make the page slower for every release the account has ever had. It is
 * summarised to counts here; the detail endpoint is where the whole thing belongs.
 */
export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const url = new URL(req.url)
  const { page, limit, skip } = readPaging(url)

  const where: Prisma.BotReleaseWhereInput = {}
  const status = url.searchParams.get('status')?.trim()
  // Validated, not passed through: an unknown status returns zero rows, which reads as "nothing
  // has ever been published" — the most alarming thing this page could say untruthfully.
  if (status && (RELEASE_STATUSES as readonly string[]).includes(status)) where.status = status

  try {
    const [releases, total] = await Promise.all([
      prisma.botRelease.findMany({ where, orderBy: { version: 'desc' }, skip, take: limit }),
      prisma.botRelease.count({ where }),
    ])

    const actorIds = [...new Set(releases.map((r) => r.publishedBy).filter((id): id is string => id !== null))]
    const actors =
      actorIds.length === 0
        ? []
        : await prisma.account.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    const nameById = new Map(actors.map((a) => [a.id, a.name]))

    return NextResponse.json({
      items: releases.map((release) => {
        const snapshot = readReleaseSnapshot(release.snapshot)
        return {
          id: release.id,
          version: release.version,
          title: release.title,
          description: release.description,
          status: release.status,
          publishedById: release.publishedBy,
          // Null when the account is gone. The release outlives whoever published it, and an
          // empty cell is more honest than inventing a name for it.
          publishedByName: release.publishedBy ? nameById.get(release.publishedBy) ?? null : null,
          publishedAt: release.publishedAt.toISOString(),
          rollbackOfId: release.rollbackOfId,
          testRunId: release.testRunId,
          notes: release.notes,
          // Null means the snapshot is in a shape this build cannot read — worth showing as
          // such, because it is exactly the release rollback would refuse.
          changes: snapshot
            ? {
                rules: snapshot.rules.length,
                knowledge: snapshot.knowledge.length,
                flows: snapshot.flows.length,
                channelPolicy: snapshot.channelPolicy ? 1 : 0,
              }
            : null,
          testSummary: snapshot?.testSummary ?? null,
        }
      }),
      page,
      limit,
      total,
    })
  } catch (error) {
    console.error('GET /api/bot-control/releases gagal', error)
    return NextResponse.json({ error: 'Gagal memuat daftar release' }, { status: 500 })
  }
}

const publishSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  // Accepted and recorded, but not yet acted on: the entities it would name arrive in Phases
  // C-E. Taking it now means the client contract does not change when they do.
  approvedEntityIds: z.array(z.string()).optional(),
  testRunId: z.string().optional(),
  notes: z.string().trim().max(2000).optional(),
  /** Ship despite a failing or missing test run. OWNER only — see assertTestGate. */
  overrideFailedTest: z.boolean().optional(),
  reason: z.string().trim().max(2000).optional(),
})

export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa mempublish release' }, { status: 403 })

  const parsed = await parseJsonBody(req, publishSchema, 'Data release tidak valid')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const actor = await prisma.account.findUnique({ where: { id: admin.accountId }, select: { name: true } })
    const release = await publishRelease({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      notes: parsed.data.notes ?? null,
      testRunId: parsed.data.testRunId ?? null,
      actorId: admin.accountId,
      actorName: actor?.name ?? null,
      actorRole: roleFromAccount(admin.role),
      overrideFailedTest: parsed.data.overrideFailedTest,
      reason: parsed.data.reason ?? null,
      req,
    })

    return NextResponse.json({
      id: release.id,
      version: release.version,
      title: release.title,
      status: release.status,
      publishedAt: release.publishedAt.toISOString(),
    })
  } catch (error) {
    if (error instanceof ReleaseVersionConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    // 409, not 400: the request was well-formed, but something in the pending set may not
    // ship. The issues are returned so the operator sees WHICH ones without re-running preview.
    if (error instanceof ReleaseBlockedError) {
      return NextResponse.json({ error: error.message, blockingIssues: error.issues }, { status: 409 })
    }
    // 409, not 403: the operator is permitted to publish, the SUITE is what is refusing.
    if (error instanceof ReleaseTestGateError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('POST /api/bot-control/releases gagal', error)
    return NextResponse.json({ error: 'Gagal mempublish release' }, { status: 500 })
  }
}
