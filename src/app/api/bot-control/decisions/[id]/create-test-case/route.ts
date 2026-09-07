import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { sessionCan } from '@/lib/bot-control/permissions'
import { SIMULATION_STATUSES } from '@/lib/bot-control/test-runner'

/**
 * POST /api/bot-control/decisions/[id]/create-test-case — turn a real turn into a regression test.
 *
 * The input is copied from what the customer ACTUALLY wrote. The expectation is not copied from
 * what the bot actually did: this endpoint exists mainly for turns that went WRONG, and
 * pre-filling the wrong outcome as the expected one would freeze the defect into the suite —
 * the test would then pass forever while the bot stays broken.
 *
 * So `expectedStatus` must be stated by the caller. The UI seeds the field from the decision and
 * lets the operator change it before saving, which is a different thing from the server assuming
 * it.
 */
const bodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().max(60).optional(),
  expectedStatus: z.enum(SIMULATION_STATUSES as unknown as [string, ...string[]]),
  expectedContains: z.string().trim().max(500).optional(),
  expectedNotContains: z.string().trim().max(500).optional(),
  expectedHandoff: z.boolean().optional(),
})

/** A name is a label in a list, not the whole message. */
const TITLE_MAX = 120

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })
  if (!sessionCan(session, 'CREATE_TEST_CASE')) {
    return NextResponse.json({ error: 'Peran Anda tidak boleh membuat kasus uji' }, { status: 403 })
  }

  const { id } = await params
  const parsed = await parseJsonBody(req, bodySchema, 'Data kasus uji tidak valid; status yang diharapkan wajib diisi')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const run = await prisma.botDecisionRun.findUnique({
      where: { id },
      select: { id: true, inboundText: true, conversationId: true },
    })
    if (!run) return NextResponse.json({ error: 'Keputusan tidak ditemukan' }, { status: 404 })

    const inputText = run.inboundText.trim()
    if (inputText.length === 0) {
      return NextResponse.json(
        { error: 'Keputusan ini tidak punya teks masuk, jadi tidak ada yang bisa diuji.' },
        { status: 400 }
      )
    }

    const created = await prisma.botTestCase.create({
      data: {
        name: parsed.data.name?.trim() || inputText.slice(0, TITLE_MAX),
        description: `Dibuat dari decision run ${run.id}`,
        category: parsed.data.category ?? null,
        inputText,
        // The conversation is NOT seeded: the simulator runs every case against the sandbox and
        // copying a real customer's context into a suite that runs before every publish would
        // put their data in front of everyone who reads a test failure.
        conversationSeed: undefined as Prisma.InputJsonValue | undefined,
        expectedStatus: parsed.data.expectedStatus,
        expectedContains: parsed.data.expectedContains ?? null,
        expectedNotContains: parsed.data.expectedNotContains ?? null,
        expectedHandoff: parsed.data.expectedHandoff ?? null,
        createdBy: session.accountId,
      },
      select: { id: true, name: true, inputText: true, expectedStatus: true, enabled: true },
    })

    return NextResponse.json({ ...created, fromDecisionRunId: run.id })
  } catch (error) {
    console.error('POST /api/bot-control/decisions/[id]/create-test-case gagal', error)
    return NextResponse.json({ error: 'Gagal membuat kasus uji' }, { status: 500 })
  }
}
