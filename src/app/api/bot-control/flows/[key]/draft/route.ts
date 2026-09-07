import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { sessionCan } from '@/lib/bot-control/permissions'
import {
  saveFlowDraft,
  FlowNotEditableError,
  FlowNotFoundError,
  FlowTransitionError,
} from '@/lib/bot-control/flow-workflow'

/**
 * PATCH /api/bot-control/flows/[key]/draft — edit a flow's safe config.
 *
 * Only the seven fields in flow-config.ts, and only those the flow's `editableLevel` permits.
 * Branching stays read-only until Flow Builder V1 (SDD Manage Second §8.3): it is control flow
 * in the orchestrator, and editing it from a form would mean building an interpreter for it.
 *
 * Nothing here changes runtime. The draft reaches the bot when a release publishes it.
 */
const bodySchema = z.object({
  // Shape and per-field permission are both checked in the workflow against this flow's level
  // — a generic record here would let a TEXT_ONLY flow store a threshold it may not change.
  config: z.unknown(),
  reason: z.string().trim().min(10).max(2000),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })
  if (!sessionCan(session, 'EDIT_FLOW_CONFIG')) {
    return NextResponse.json({ error: 'Peran Anda tidak boleh mengubah konfigurasi flow' }, { status: 403 })
  }

  const { key } = await params
  const parsed = await parseJsonBody(req, bodySchema, 'Data draft tidak valid; alasan wajib minimal 10 karakter')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const actor = await prisma.account.findUnique({ where: { id: session.accountId }, select: { name: true } })
    const result = await saveFlowDraft(
      key,
      { config: parsed.data.config, reason: parsed.data.reason },
      { id: session.accountId, name: actor?.name ?? null },
      req
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof FlowNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 })
    // 403, not 400: the request is well-formed, the flow (or the field) is simply off limits.
    if (error instanceof FlowNotEditableError) return NextResponse.json({ error: error.message }, { status: 403 })
    if (error instanceof FlowTransitionError) return NextResponse.json({ error: error.message }, { status: 409 })
    console.error('PATCH /api/bot-control/flows/[key]/draft gagal', error)
    return NextResponse.json({ error: 'Gagal menyimpan draft flow' }, { status: 500 })
  }
}
