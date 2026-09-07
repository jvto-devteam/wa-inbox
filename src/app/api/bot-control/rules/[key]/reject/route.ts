import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { sessionCan } from '@/lib/bot-control/permissions'
import {
  transitionRule,
  RuleNotFoundError,
  RuleTransitionError,
} from '@/lib/bot-control/rule-workflow'

/**
 * POST /api/bot-control/rules/[key]/reject — menolak draft.
 *
 * Changes status only. The draft values themselves are untouched, and nothing reaches the bot
 * until a release publishes them.
 */
const bodySchema = z.object({ reason: z.string().trim().max(2000).min(10) })

export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })
  if (!sessionCan(session, 'APPROVE')) {
    return NextResponse.json({ error: 'Peran Anda tidak boleh menolak draft' }, { status: 403 })
  }

  const { key } = await params
  const parsed = await parseJsonBody(req, bodySchema, 'Data permintaan tidak valid')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const actor = await prisma.account.findUnique({ where: { id: session.accountId }, select: { name: true } })
    const result = await transitionRule(
      key,
      'REJECT',
      { id: session.accountId, name: actor?.name ?? null },
      parsed.data.reason ?? null,
      req
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof RuleNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 })
    // 409: the request is well-formed, the rule is simply not in a state that allows it.
    if (error instanceof RuleTransitionError) return NextResponse.json({ error: error.message }, { status: 409 })
    console.error('POST /api/bot-control/rules/[key]/reject gagal', error)
    return NextResponse.json({ error: 'Gagal memproses permintaan' }, { status: 500 })
  }
}
