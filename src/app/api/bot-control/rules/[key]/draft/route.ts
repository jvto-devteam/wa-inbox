import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { sessionCan } from '@/lib/bot-control/permissions'
import {
  saveRuleDraft,
  RuleNotEditableError,
  RuleNotFoundError,
  RuleTransitionError,
} from '@/lib/bot-control/rule-workflow'

/**
 * PATCH /api/bot-control/rules/[key]/draft — create or change a rule's draft.
 *
 * Writes ONLY the draft columns. Nothing here changes what the bot does; that happens at
 * publish, through the release API, so rules ship as a reviewed set rather than one at a time
 * from whoever last had the page open (SDD Manage Second §11).
 *
 * `reason` is required. A rule change is read back months later by somebody working out why
 * the bot's behaviour shifted, and "enabled: false" with no explanation answers nothing.
 */
const bodySchema = z.object({
  enabled: z.boolean(),
  // Shape is validated per rule against its own spec in rule-config.ts — a generic record here
  // would let an unknown key be stored and silently ignored, which from the UI is
  // indistinguishable from a key that works.
  config: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().trim().min(10).max(2000),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })
  if (!sessionCan(session, 'EDIT_RULE_DRAFT')) {
    return NextResponse.json({ error: 'Peran Anda tidak boleh mengubah draft rule' }, { status: 403 })
  }

  const { key } = await params
  const parsed = await parseJsonBody(req, bodySchema, 'Data draft tidak valid; alasan wajib diisi minimal 10 karakter')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const actor = await prisma.account.findUnique({ where: { id: session.accountId }, select: { name: true } })
    const result = await saveRuleDraft(
      key,
      { enabled: parsed.data.enabled, config: parsed.data.config, reason: parsed.data.reason },
      { id: session.accountId, name: actor?.name ?? null },
      req
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof RuleNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 })
    // 403, not 400: the request is well-formed, the rule is simply off limits.
    if (error instanceof RuleNotEditableError) return NextResponse.json({ error: error.message }, { status: 403 })
    if (error instanceof RuleTransitionError) return NextResponse.json({ error: error.message }, { status: 409 })
    console.error('PATCH /api/bot-control/rules/[key]/draft gagal', error)
    return NextResponse.json({ error: 'Gagal menyimpan draft rule' }, { status: 500 })
  }
}
