import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { readPaging } from '@/lib/bot-control/paging'
import { sessionCan } from '@/lib/bot-control/permissions'
import { runTestCases, MAX_TEST_CASES_PER_RUN, TEST_RUN_SCOPES } from '@/lib/bot-control/test-runner'

/**
 * GET  /api/bot-control/test-runs — past runs.
 * POST /api/bot-control/test-runs — run a batch.
 *
 * Running is open to an AGENT (§13). Approving and publishing are not — so an agent can prove
 * the bot is wrong, and still cannot ship a change on the strength of it.
 */
export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const url = new URL(req.url)
  const { page, limit, skip } = readPaging(url)

  const where: Prisma.BotTestRunWhereInput = {}
  const scope = url.searchParams.get('scope')?.trim()
  const status = url.searchParams.get('status')?.trim()
  if (scope && (TEST_RUN_SCOPES as readonly string[]).includes(scope)) where.scope = scope
  if (status) where.status = status

  try {
    const [items, total] = await Promise.all([
      prisma.botTestRun.findMany({ where, orderBy: { startedAt: 'desc' }, skip, take: limit }),
      prisma.botTestRun.count({ where }),
    ])

    return NextResponse.json({
      items: items.map((run) => ({
        id: run.id,
        name: run.name,
        scope: run.scope,
        status: run.status,
        total: run.total,
        passed: run.passed,
        failed: run.failed,
        skipped: run.skipped,
        releaseId: run.releaseId,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
      })),
      page,
      limit,
      total,
    })
  } catch (error) {
    console.error('GET /api/bot-control/test-runs gagal', error)
    return NextResponse.json({ error: 'Gagal memuat riwayat test run' }, { status: 500 })
  }
}

const bodySchema = z.object({
  scope: z.enum(TEST_RUN_SCOPES as unknown as [string, ...string[]]).optional(),
  name: z.string().trim().max(200).optional(),
  // Capped here as well as in the runner: rejecting an over-large request outright is clearer
  // than silently running the first fifty and reporting a total the caller did not ask for.
  testCaseIds: z.array(z.string().min(1)).min(1).max(MAX_TEST_CASES_PER_RUN),
  // The draft versions to run AGAINST, instead of what is currently published. Without this
  // the suite verified configuration that was already live, so the gate in front of a publish
  // proved nothing about the thing being published. See candidate-context.ts.
  candidate: z
    .object({
      ruleDraftKeys: z.array(z.string()).optional(),
      knowledgeRevisionIds: z.array(z.string()).optional(),
      flowVersionIds: z.array(z.string()).optional(),
    })
    .optional(),
})

export async function POST(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })
  if (!sessionCan(session, 'RUN_TEST')) {
    return NextResponse.json({ error: 'Peran Anda tidak boleh menjalankan test' }, { status: 403 })
  }

  const parsed = await parseJsonBody(
    req,
    bodySchema,
    `Data test run tidak valid; maksimal ${MAX_TEST_CASES_PER_RUN} kasus per run`
  )
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const run = await runTestCases({
      scope: parsed.data.scope === 'PRE_RELEASE' ? 'PRE_RELEASE' : 'MANUAL',
      testCaseIds: parsed.data.testCaseIds,
      name: parsed.data.name ?? null,
      actorId: session.accountId,
      candidate: parsed.data.candidate ?? null,
    })

    return NextResponse.json({ testRunId: run.id, ...run })
  } catch (error) {
    console.error('POST /api/bot-control/test-runs gagal', error)
    return NextResponse.json({ error: 'Gagal menjalankan test run' }, { status: 500 })
  }
}
