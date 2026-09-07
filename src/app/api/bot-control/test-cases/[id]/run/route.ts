import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { sessionCan } from '@/lib/bot-control/permissions'
import { runTestCases } from '@/lib/bot-control/test-runner'

/**
 * POST /api/bot-control/test-cases/[id]/run — run one case on its own.
 *
 * Always scope MANUAL: a single case is somebody checking their own work, not the suite that
 * gates a release. Letting it record PRE_RELEASE would let a one-case run whose only case
 * passes stand in for the whole suite at publish time.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })
  if (!sessionCan(session, 'RUN_TEST')) {
    return NextResponse.json({ error: 'Peran Anda tidak boleh menjalankan kasus uji' }, { status: 403 })
  }

  const { id } = await params

  try {
    const testCase = await prisma.botTestCase.findUnique({ where: { id }, select: { id: true, name: true } })
    if (!testCase) return NextResponse.json({ error: 'Kasus uji tidak ditemukan' }, { status: 404 })

    const run = await runTestCases({
      scope: 'MANUAL',
      testCaseIds: [id],
      name: `Uji satu kasus: ${testCase.name}`,
      actorId: session.accountId,
    })

    const results = await prisma.botTestResult.findMany({ where: { testRunId: run.id } })
    return NextResponse.json({ ...run, results })
  } catch (error) {
    console.error('POST /api/bot-control/test-cases/[id]/run gagal', error)
    return NextResponse.json({ error: 'Gagal menjalankan kasus uji' }, { status: 500 })
  }
}
