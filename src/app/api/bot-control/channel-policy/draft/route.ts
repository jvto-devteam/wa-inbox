import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { sessionCan } from '@/lib/bot-control/permissions'
import {
  saveChannelPolicyDraft,
  PolicyInvalidError,
  PolicyNotFoundError,
  PolicyTransitionError,
} from '@/lib/bot-control/channel-policy-workflow'

/**
 * PATCH /api/bot-control/channel-policy/draft — edit the pending policy.
 *
 * Writes only `draftConfig`. Nothing here changes the send path; that happens at publish, so a
 * change to which channel every reply uses goes through the same review a rule does.
 *
 * Gated on EDIT_FLOW_CONFIG rather than a channel-specific action: the matrix has no
 * channel-policy row, and this is the same class of change — configuration a BOT_MANAGER may
 * propose and only an ADMIN or OWNER may approve.
 */
const bodySchema = z.object({
  config: z.unknown(),
  reason: z.string().trim().min(10).max(2000),
})

export async function PATCH(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })
  if (!sessionCan(session, 'EDIT_FLOW_CONFIG')) {
    return NextResponse.json({ error: 'Peran Anda tidak boleh mengubah kebijakan channel' }, { status: 403 })
  }

  const parsed = await parseJsonBody(req, bodySchema, 'Data kebijakan tidak valid; alasan wajib minimal 10 karakter')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const actor = await prisma.account.findUnique({ where: { id: session.accountId }, select: { name: true } })
    const result = await saveChannelPolicyDraft(
      { config: parsed.data.config, reason: parsed.data.reason },
      { id: session.accountId, name: actor?.name ?? null },
      req
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof PolicyNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 })
    // 400: the values themselves are what is wrong, and the message names the offending field.
    if (error instanceof PolicyInvalidError) return NextResponse.json({ error: error.message }, { status: 400 })
    if (error instanceof PolicyTransitionError) return NextResponse.json({ error: error.message }, { status: 409 })
    console.error('PATCH /api/bot-control/channel-policy/draft gagal', error)
    return NextResponse.json({ error: 'Gagal menyimpan draft kebijakan' }, { status: 500 })
  }
}
