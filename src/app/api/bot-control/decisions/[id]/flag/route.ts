import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'

/**
 * POST /api/bot-control/decisions/[id]/flag — mark this decision as needing a fix, or clear the
 * mark. ONE endpoint for both, because the thing being written is one nullable timestamp: a
 * separate DELETE would just be a second way to say `flagged: false`.
 *
 * This replaced a triage table with eight issue types, four statuses, four severities, an
 * assignee and a resolver — a miniature Jira for a team of one or two, which held zero rows.
 * What is left is what anybody actually does: notice a bad answer, mark it, write down why, and
 * unmark it once it is fixed.
 *
 * Open to any signed-in user. The person who notices the bot answering wrongly is the agent
 * reading the conversation; requiring an admin to file it is how it never gets filed. Nothing
 * here changes what the bot does, so there is no privilege to protect — the fix itself still
 * goes through Knowledge.
 *
 * Nothing is written to BotControlAuditLog either, for the same reason: that table is the
 * history of changes a CUSTOMER could notice, and a flag changes nothing a customer sees. The
 * mark and its note live on the decision run itself, which is where anybody looking at the
 * decision will read them.
 */
const bodySchema = z
  .object({
    flagged: z.boolean(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const { id } = await params
  const parsed = await parseJsonBody(req, bodySchema, 'Data tanda tidak valid')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { flagged, note } = parsed.data

  try {
    const existing = await prisma.botDecisionRun.findUnique({
      where: { id },
      select: { id: true, flaggedAt: true, flagNote: true },
    })
    if (!existing) return NextResponse.json({ error: 'Keputusan tidak ditemukan.' }, { status: 404 })

    // Unflagging clears the note too. A row with no `flaggedAt` but a leftover "balasan salah"
    // note is a row nobody can read, and the flag has done its job once the fix has shipped.
    const data = flagged
      ? { flaggedAt: existing.flaggedAt ?? new Date(), flagNote: note ?? existing.flagNote ?? null }
      : { flaggedAt: null, flagNote: null }

    const saved = await prisma.botDecisionRun.update({
      where: { id },
      data,
      select: { id: true, flaggedAt: true, flagNote: true },
    })

    return NextResponse.json({
      id: saved.id,
      flaggedAt: saved.flaggedAt?.toISOString() ?? null,
      flagNote: saved.flagNote,
    })
  } catch (error) {
    console.error('POST /api/bot-control/decisions/[id]/flag gagal', error)
    return NextResponse.json({ error: 'Gagal menyimpan tanda' }, { status: 500 })
  }
}
