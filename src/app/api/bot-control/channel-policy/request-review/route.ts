import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { sessionCan } from '@/lib/bot-control/permissions'
import {
  transitionChannelPolicy,
  PolicyNotFoundError,
  PolicyTransitionError,
} from '@/lib/bot-control/channel-policy-workflow'

/**
 * POST /api/bot-control/channel-policy/request-review — mengirim draft kebijakan ke review.
 *
 * Status only. The send path does not read the draft, and will not until a release publishes it.
 */
const bodySchema = z.object({ reason: z.string().trim().max(2000).optional() })

export async function POST(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })
  if (!sessionCan(session, 'EDIT_FLOW_CONFIG')) {
    return NextResponse.json({ error: 'Peran Anda tidak boleh mengirim draft kebijakan ke review' }, { status: 403 })
  }

  const parsed = await parseJsonBody(req, bodySchema, 'Data permintaan tidak valid')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const actor = await prisma.account.findUnique({ where: { id: session.accountId }, select: { name: true } })
    const result = await transitionChannelPolicy(
      'REVIEW',
      { id: session.accountId, name: actor?.name ?? null },
      parsed.data.reason ?? null,
      req
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof PolicyNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 })
    // 409: the request is well-formed, the policy simply is not in a state that allows it.
    if (error instanceof PolicyTransitionError) return NextResponse.json({ error: error.message }, { status: 409 })
    console.error('POST /api/bot-control/channel-policy/request-review gagal', error)
    return NextResponse.json({ error: 'Gagal memproses permintaan' }, { status: 500 })
  }
}
