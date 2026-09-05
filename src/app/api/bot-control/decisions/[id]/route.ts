import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'

/**
 * GET /api/bot-control/decisions/[id] — one decision run in full.
 *
 * The stored `trace` was already sanitised at record time (decision-recorder.ts), so this
 * route serves it as-is rather than re-filtering on the way out — one sanitiser, at the point
 * where a secret would otherwise become permanent.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const { id } = await params

  try {
    const run = await prisma.botDecisionRun.findUnique({ where: { id } })
    if (!run) return NextResponse.json({ error: 'Keputusan tidak ditemukan' }, { status: 404 })

    // Fetched separately for the same reason the list route does it: no foreign key, by design.
    const conversation = await prisma.conversation.findUnique({
      where: { id: run.conversationId },
      select: { id: true, contact: { select: { name: true, phone: true } } },
    })

    return NextResponse.json({
      id: run.id,
      conversationId: run.conversationId,
      messageId: run.messageId,
      contactName: conversation?.contact?.name ?? null,
      contactPhone: conversation?.contact?.phone ?? null,
      mode: run.mode,
      status: run.status,
      inboundText: run.inboundText,
      replyText: run.replyText,
      flowKey: run.flowKey,
      flowVersion: run.flowVersion,
      latencyMs: run.latencyMs,
      trace: run.trace,
      knowledgeRefs: run.knowledgeRefs,
      verification: run.verification,
      error: run.error,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
    })
  } catch (error) {
    console.error('GET /api/bot-control/decisions/[id] gagal', error)
    return NextResponse.json({ error: 'Gagal memuat detail keputusan' }, { status: 500 })
  }
}
