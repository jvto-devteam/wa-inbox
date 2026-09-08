import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { hasAdminPowers } from '@/lib/bot-control/permissions'
import {
  publishKnowledgeRevision,
  KnowledgeNotEditableError,
  KnowledgeNotFoundError,
  KnowledgeTransitionError,
} from '@/lib/bot-control/knowledge-workflow'

/**
 * POST /api/bot-control/knowledge/sources/[id]/publish — "Aktifkan".
 *
 * One step from DRAFT to PUBLISHED. This replaces the old `approve` route, and with it the
 * `request-review` and `reject` routes that used to stand in front of it: the writer and the
 * approver are the same person here, so the extra hops only delayed knowledge reaching the bot.
 *
 * A route of its own rather than a POST on `[id]`: `[id]` is the read endpoint the editor
 * opens, and this deletes two routes for the one it keeps, so the surface still shrinks.
 *
 * The bot reads the change at the next turn — `publishKnowledgeRevision` drops the runtime
 * cache, so there is no release to run afterwards.
 */
const bodySchema = z.object({ reason: z.string().trim().max(2000).optional() })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })
  if (!hasAdminPowers(session.role)) {
    return NextResponse.json({ error: 'Peran Anda tidak boleh mengaktifkan knowledge' }, { status: 403 })
  }

  const { id } = await params
  const parsed = await parseJsonBody(req, bodySchema, 'Data permintaan tidak valid')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const actor = await prisma.account.findUnique({ where: { id: session.accountId }, select: { name: true } })
    const result = await publishKnowledgeRevision(
      id,
      { id: session.accountId, name: actor?.name ?? null },
      parsed.data.reason ?? null
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof KnowledgeNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 })
    // 403: a catalog mirror is not something this endpoint may ever activate.
    if (error instanceof KnowledgeNotEditableError) return NextResponse.json({ error: error.message }, { status: 403 })
    // 409: the request is well-formed, the revision simply is not in a state that allows it.
    if (error instanceof KnowledgeTransitionError) return NextResponse.json({ error: error.message }, { status: 409 })
    console.error('POST /api/bot-control/knowledge/sources/[id]/publish gagal', error)
    return NextResponse.json({ error: 'Gagal mengaktifkan knowledge' }, { status: 500 })
  }
}
