import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { hasAdminPowers } from '@/lib/bot-control/permissions'
import {
  archiveKnowledgeSource,
  KnowledgeNotEditableError,
  KnowledgeNotFoundError,
  KnowledgeTransitionError,
} from '@/lib/bot-control/knowledge-workflow'

/**
 * POST /api/bot-control/knowledge/sources/[id]/archive — stop the bot using a source.
 *
 * Deletes nothing (SDD Manage Second §8.2). Every revision stays exactly where it is, including
 * the published one, so a release snapshot naming a version still resolves. What changes is
 * that the runtime loader stops reading it.
 *
 * Requires APPROVE rather than EDIT: archiving takes knowledge AWAY from the bot immediately at
 * the next cache expiry, without going through a release — that is closer to publishing than
 * to drafting.
 */
const bodySchema = z.object({ reason: z.string().trim().min(10).max(2000) })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })
  if (!hasAdminPowers(session.role)) {
    return NextResponse.json({ error: 'Peran Anda tidak boleh mengarsipkan knowledge' }, { status: 403 })
  }

  const { id } = await params
  const parsed = await parseJsonBody(req, bodySchema, 'Alasan arsip wajib diisi, minimal 10 karakter')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const actor = await prisma.account.findUnique({ where: { id: session.accountId }, select: { name: true } })
    const result = await archiveKnowledgeSource(
      id,
      parsed.data.reason,
      { id: session.accountId, name: actor?.name ?? null }
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof KnowledgeNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 })
    if (error instanceof KnowledgeNotEditableError) return NextResponse.json({ error: error.message }, { status: 403 })
    if (error instanceof KnowledgeTransitionError) return NextResponse.json({ error: error.message }, { status: 409 })
    console.error('POST /api/bot-control/knowledge/sources/[id]/archive gagal', error)
    return NextResponse.json({ error: 'Gagal mengarsipkan knowledge' }, { status: 500 })
  }
}
