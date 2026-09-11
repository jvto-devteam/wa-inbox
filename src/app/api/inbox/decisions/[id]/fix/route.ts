import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { knowledgeItemSchema } from '@/lib/bot-control/knowledge-body'
import {
  createManagedKnowledge,
  publishKnowledgeRevision,
  saveKnowledgeDraft,
  KnowledgeNotEditableError,
  KnowledgeNotFoundError,
  KnowledgeTransitionError,
  type Actor,
} from '@/lib/bot-control/knowledge-workflow'

const content = {
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(1000).optional(),
  items: z.array(knowledgeItemSchema).min(1).max(200),
  reason: z.string().trim().min(10).max(2000),
}

const bodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('edit'), sourceId: z.string().trim().min(1), ...content }).strict(),
  z.object({ kind: z.literal('new'), ...content }).strict(),
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** sourceId setiap baris knowledge terkelola yang dipakai run ini (knowledgeRefs.knowledge.managedLines). */
function usedSourceIds(knowledgeRefs: unknown): Set<string> {
  const ids = new Set<string>()
  if (!isRecord(knowledgeRefs) || !isRecord(knowledgeRefs.knowledge)) return ids
  const lines = knowledgeRefs.knowledge.managedLines
  if (!Array.isArray(lines)) return ids
  for (const line of lines) {
    if (isRecord(line) && typeof line.sourceId === 'string') ids.add(line.sourceId)
  }
  return ids
}

/**
 * Perbaikan jawaban bot dari Inbox: simpan lalu aktifkan, dalam satu permintaan. Terbuka untuk
 * semua yang login (CLAUDE.md §6, pengecualian tunggal) karena setiap simpan berversi, dapat
 * dikembalikan, dan tercatat di audit log oleh publishKnowledgeRevision.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const { id } = await params
  const parsed = await parseJsonBody(
    req,
    bodySchema,
    'Data perbaikan tidak valid; isi minimal satu item dan alasan minimal 10 karakter'
  )
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const input = parsed.data

  try {
    const run = await prisma.botDecisionRun.findUnique({ where: { id }, select: { id: true, knowledgeRefs: true } })
    if (!run) return NextResponse.json({ error: 'Keputusan tidak ditemukan.' }, { status: 404 })

    const account = await prisma.account.findUnique({ where: { id: session.accountId }, select: { name: true } })
    const actor: Actor = { id: session.accountId, name: account?.name ?? null }
    const fields = {
      title: input.title,
      summary: input.summary ? input.summary : null,
      body: { items: input.items },
      reason: input.reason,
    }

    let sourceId: string
    if (input.kind === 'edit') {
      if (!usedSourceIds(run.knowledgeRefs).has(input.sourceId)) {
        return NextResponse.json(
          { error: 'Entri ini tidak dipakai pada jawaban tersebut, jadi tidak diperbaiki dari sini.' },
          { status: 400 }
        )
      }
      // saveKnowledgeDraft MENIMPA draft yang ada, dan publish lalu mengaktifkannya -- tulisan
      // operator yang belum selesai tidak boleh hilang lewat jalan pintas ini.
      const latest = await prisma.knowledgeRevision.findFirst({
        where: { knowledgeSourceId: input.sourceId },
        orderBy: { version: 'desc' },
        select: { version: true, status: true },
      })
      if (latest?.status === 'DRAFT') {
        return NextResponse.json(
          {
            error: `Entri ini punya draft v${latest.version} yang belum diaktifkan. Selesaikan draft itu di halaman Knowledge dulu supaya tidak tertimpa.`,
          },
          { status: 409 }
        )
      }
      sourceId = (await saveKnowledgeDraft(input.sourceId, fields, actor)).sourceId
    } else {
      sourceId = (await createManagedKnowledge(fields, actor)).sourceId
    }

    const published = await publishKnowledgeRevision(sourceId, actor, input.reason)

    // Metadata triase saja: revisi di atas sudah aktif apa pun hasil penandaan ini.
    let flagged = true
    try {
      await prisma.botDecisionRun.update({ where: { id: run.id }, data: { flaggedAt: new Date(), flagNote: input.reason } })
    } catch (error) {
      console.error('POST /api/inbox/decisions/[id]/fix: penandaan run gagal', { runId: run.id, error })
      flagged = false
    }

    return NextResponse.json({ ...published, flagged })
  } catch (error) {
    if (error instanceof KnowledgeNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 })
    if (error instanceof KnowledgeNotEditableError) return NextResponse.json({ error: error.message }, { status: 400 })
    if (error instanceof KnowledgeTransitionError) return NextResponse.json({ error: error.message }, { status: 409 })
    console.error('POST /api/inbox/decisions/[id]/fix gagal', error)
    return NextResponse.json({ error: 'Gagal menyimpan perbaikan' }, { status: 500 })
  }
}
