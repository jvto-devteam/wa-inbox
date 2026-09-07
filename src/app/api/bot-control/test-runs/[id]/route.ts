import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'

/**
 * GET /api/bot-control/test-runs/[id] — one run with every result.
 *
 * Results carry their own `inputText`, copied at run time rather than joined from the case, so
 * this stays readable after somebody edits or deletes the case. The case's CURRENT name is
 * fetched alongside as a convenience and may legitimately be null.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const { id } = await params

  try {
    const run = await prisma.botTestRun.findUnique({
      where: { id },
      include: { results: { orderBy: { createdAt: 'asc' } } },
    })
    if (!run) return NextResponse.json({ error: 'Test run tidak ditemukan' }, { status: 404 })

    const caseIds = [...new Set(run.results.map((result) => result.testCaseId))]
    const cases =
      caseIds.length === 0
        ? []
        : await prisma.botTestCase.findMany({ where: { id: { in: caseIds } }, select: { id: true, name: true } })
    const nameById = new Map(cases.map((row) => [row.id, row.name]))

    return NextResponse.json({
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
      summary: run.summary,
      results: run.results.map((result) => ({
        id: result.id,
        testCaseId: result.testCaseId,
        // Null once the case is gone. The result outlives it on purpose.
        testCaseName: nameById.get(result.testCaseId) ?? null,
        status: result.status,
        inputText: result.inputText,
        actualStatus: result.actualStatus,
        actualFlowKey: result.actualFlowKey,
        actualReply: result.actualReply,
        failureReason: result.failureReason,
        latencyMs: result.latencyMs,
      })),
    })
  } catch (error) {
    console.error('GET /api/bot-control/test-runs/[id] gagal', error)
    return NextResponse.json({ error: 'Gagal memuat detail test run' }, { status: 500 })
  }
}
