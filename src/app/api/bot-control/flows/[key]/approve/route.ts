import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { sessionCan } from '@/lib/bot-control/permissions'
import { transitionFlow, FlowNotFoundError, FlowTransitionError } from '@/lib/bot-control/flow-workflow'

/**
 * POST /api/bot-control/flows/[key]/approve — menyetujui draft flow.
 *
 * Status only. The config itself is untouched, and the bot does not read it until a release
 * publishes it.
 */
const bodySchema = z.object({ reason: z.string().trim().max(2000).optional() })

export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })
  if (!sessionCan(session, 'APPROVE')) {
    return NextResponse.json({ error: 'Peran Anda tidak boleh menyetujui draft flow' }, { status: 403 })
  }

  const { key } = await params
  const parsed = await parseJsonBody(req, bodySchema, 'Data permintaan tidak valid')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const actor = await prisma.account.findUnique({ where: { id: session.accountId }, select: { name: true } })
    const result = await transitionFlow(
      key,
      'APPROVE',
      { id: session.accountId, name: actor?.name ?? null },
      parsed.data.reason ?? null,
      req
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof FlowNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 })
    // 409: the request is well-formed, the version simply is not in a state that allows it.
    if (error instanceof FlowTransitionError) return NextResponse.json({ error: error.message }, { status: 409 })
    console.error('POST /api/bot-control/flows/[key]/approve gagal', error)
    return NextResponse.json({ error: 'Gagal memproses permintaan' }, { status: 500 })
  }
}
