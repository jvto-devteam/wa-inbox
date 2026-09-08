import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { hasAdminPowers } from '@/lib/bot-control/permissions'
import { createManagedKnowledge, KnowledgeNotEditableError } from '@/lib/bot-control/knowledge-workflow'

/**
 * POST /api/bot-control/decisions/[id]/create-knowledge-draft — turn a bad turn into knowledge.
 *
 * This is the shortest path in the whole system between "the bot answered wrongly" and "the bot
 * will answer that correctly next time". Without it, closing a knowledge gap means reading the
 * decision log, opening the knowledge page, and retyping the customer's question from memory —
 * three steps at which the intent gets lost, which is why gaps stay open.
 *
 * The question is prefilled from what the customer ACTUALLY wrote, not from a summary. The
 * answer is prefilled from the bot's reply only when the caller asks for it: the common case is
 * that the reply was the problem, and pre-filling a wrong answer into a draft is how a wrong
 * answer gets approved by somebody skimming.
 */
const bodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  answer: z.string().trim().min(1).max(5000).optional(),
  /** Seed the answer from the bot's own reply. Off by default — see above. */
  useBotReply: z.boolean().optional(),
  reason: z.string().trim().min(10).max(2000),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })
  if (!hasAdminPowers(session.role)) {
    return NextResponse.json({ error: 'Peran Anda tidak boleh membuat knowledge' }, { status: 403 })
  }

  const { id } = await params
  const parsed = await parseJsonBody(req, bodySchema, 'Data tidak valid; alasan wajib minimal 10 karakter')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const run = await prisma.botDecisionRun.findUnique({
      where: { id },
      select: { id: true, inboundText: true, replyText: true },
    })
    if (!run) return NextResponse.json({ error: 'Keputusan tidak ditemukan' }, { status: 404 })

    const question = run.inboundText.trim()
    if (question.length === 0) {
      return NextResponse.json(
        { error: 'Keputusan ini tidak punya teks masuk, jadi tidak ada pertanyaan yang bisa dipakai.' },
        { status: 400 }
      )
    }

    const answer = parsed.data.answer ?? (parsed.data.useBotReply ? run.replyText?.trim() : undefined)
    if (!answer) {
      // Refused rather than filled with a placeholder. A draft whose answer says "TODO" is one
      // approval away from the bot telling a customer "TODO".
      return NextResponse.json(
        { error: 'Jawaban wajib diisi — kirim `answer`, atau `useBotReply: true` bila balasan bot memang sudah benar.' },
        { status: 400 }
      )
    }

    const actor = await prisma.account.findUnique({ where: { id: session.accountId }, select: { name: true } })
    const result = await createManagedKnowledge(
      {
        title: parsed.data.title ?? question.slice(0, TITLE_MAX),
        summary: `Dibuat dari decision run ${run.id}`,
        body: { items: [{ question, answer }] },
        reason: parsed.data.reason,
      },
      { id: session.accountId, name: actor?.name ?? null }
    )

    return NextResponse.json({ ...result, fromDecisionRunId: run.id })
  } catch (error) {
    if (error instanceof KnowledgeNotEditableError) return NextResponse.json({ error: error.message }, { status: 400 })
    console.error('POST /api/bot-control/decisions/[id]/create-knowledge-draft gagal', error)
    return NextResponse.json({ error: 'Gagal membuat draft knowledge' }, { status: 500 })
  }
}

/** A title is a label, not the whole message; a 900-character one is unusable in a list. */
const TITLE_MAX = 120
