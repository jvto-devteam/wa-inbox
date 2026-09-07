import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { sessionCan } from '@/lib/bot-control/permissions'
import {
  saveKnowledgeDraft,
  KnowledgeNotEditableError,
  KnowledgeNotFoundError,
  KnowledgeTransitionError,
} from '@/lib/bot-control/knowledge-workflow'

/**
 * PATCH /api/bot-control/knowledge/sources/[id]/draft — write the source's editable revision.
 *
 * Creates a NEW revision when the latest one is already published: a published revision is
 * history, and editing it would make a release snapshot naming that version describe content
 * the bot never actually used.
 */
const bodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  summary: z.string().trim().max(1000).nullable().optional(),
  body: z.unknown(),
  reason: z.string().trim().min(10).max(2000),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })
  if (!sessionCan(session, 'EDIT_KNOWLEDGE_DRAFT')) {
    return NextResponse.json({ error: 'Peran Anda tidak boleh mengubah knowledge' }, { status: 403 })
  }

  const { id } = await params
  const parsed = await parseJsonBody(req, bodySchema, 'Data revisi tidak valid; alasan wajib minimal 10 karakter')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const actor = await prisma.account.findUnique({ where: { id: session.accountId }, select: { name: true } })
    const result = await saveKnowledgeDraft(
      id,
      {
        title: parsed.data.title,
        summary: parsed.data.summary,
        body: parsed.data.body,
        reason: parsed.data.reason,
      },
      { id: session.accountId, name: actor?.name ?? null },
      req
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof KnowledgeNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 })
    if (error instanceof KnowledgeNotEditableError) return NextResponse.json({ error: error.message }, { status: 400 })
    if (error instanceof KnowledgeTransitionError) return NextResponse.json({ error: error.message }, { status: 409 })
    console.error('PATCH /api/bot-control/knowledge/sources/[id]/draft gagal', error)
    return NextResponse.json({ error: 'Gagal menyimpan revisi knowledge' }, { status: 500 })
  }
}
