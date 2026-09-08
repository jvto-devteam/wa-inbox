import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'
import { parseJsonBody } from '@/lib/parse-json'
import { writeBotAuditLog } from '@/lib/bot-control/audit'
import { SAFETY_BOUNDS } from '@/lib/outbound/safety-bounds'

// GET stays open to every authenticated user: the inbox and settings pages
// both read defaultChannel/working hours, and agents need them.
export async function GET() {
  const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
  return NextResponse.json(settings)
}

/**
 * A sentence the bot says, editable without a deploy.
 *
 * Blank is stored as NULL rather than rejected or kept as "": clearing the box is how an
 * operator REVERTS to the code's own wording, not a request for the bot to say nothing. See
 * src/lib/bot/runtime-integration.ts, which treats null, "" and whitespace identically.
 *
 * Capped so one paste cannot turn every fallback into an essay.
 */
const botSentence = z
  .string()
  .max(2000)
  .transform((value) => {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  })
  .optional()

/**
 * One end of the working-hours window, as an `<input type="time">` produces it.
 *
 * Validated rather than stored raw because this window now does something: it decides whether a
 * handoff outside office hours carries `offHoursAutoReply` (see offHoursHandoffNotice in
 * src/lib/bot/runtime-integration.ts). The runtime ignores anything it cannot parse, so junk
 * here would silently disable the feature — the exact "the box is filled in but nothing
 * happens" failure this column was fixed to stop.
 *
 * Blank is stored as NULL, the same revert-by-clearing convention as `botSentence` above.
 */
const timeOfDay = z
  .string()
  .regex(/^(([01]\d|2[0-3]):[0-5]\d)?$/, 'Jam kerja harus HH:MM')
  .transform((value) => (value.length > 0 ? value : null))
  .optional()

/**
 * One outbound safety threshold, bounded.
 *
 * The bounds are not decoration and they are not the form's job. These four numbers decide
 * whether the duplicate check, the campaign rate limit and the provider circuit breaker do
 * anything at all: zero on `campaignRatePerMinute` does not loosen the limit, it disables the
 * gate; a duplicate window of 0 ms disables duplicate detection. They used to sit behind a
 * draft/review/approve/publish cycle, and the floors were enforced there. That cycle is gone, so
 * this route is the only thing left between a typo and a WhatsApp number that gets blocked —
 * which makes the floors more load-bearing here than they were there, not less.
 *
 * See SAFETY_BOUNDS in safety-guard.ts for why each individual min and max is where it is.
 */
function bounded(field: keyof typeof SAFETY_BOUNDS) {
  return z.number().int().min(SAFETY_BOUNDS[field].min).max(SAFETY_BOUNDS[field].max).optional()
}

/**
 * Note what is NOT here: `pausedProviders`. Zod strips unknown keys, so a PATCH naming it is
 * accepted and the field is silently dropped rather than written — which is the intended
 * outcome. A provider pause is an emergency action set during an incident, and an operator
 * saving an unrelated setting must not be able to lift one. Its only writers are
 * /api/outbound-jobs/pause-provider and resume-provider.
 */
const patchSchema = z.object({
  defaultChannel: z.enum(['OFFICIAL', 'UNOFFICIAL']).optional(),
  workingHoursStart: timeOfDay,
  workingHoursEnd: timeOfDay,
  // Blank clears it, and clearing it turns the off-hours handoff note off entirely -- there is
  // no code default for this one, since only the operator knows when their team is back.
  offHoursAutoReply: botSentence,
  // The two operator-editable bot sentences (see the Settings.fallbackReply schema comment).
  fallbackReply: botSentence,
  handoffReply: botSentence,
  // Whether the LLM escalation layer runs on top of the explicit keyword gate (see the
  // Settings.handoffOnHumanRequest schema comment). A plain boolean, saved and live -- the same
  // pattern as every other bot switch on /chatbot, and the replacement for a rule that used to
  // need six API routes and an approval cycle to change.
  handoffOnHumanRequest: z.boolean().optional(),
  // Which Ollama model src/lib/bot/llm.ts asks for (see the Settings.ollamaModel schema comment).
  ollamaModel: z.string().min(1).optional(),
  // The outbound safety thresholds (see the Settings schema comment and SAFETY_BOUNDS).
  campaignRatePerMinute: bounded('campaignRatePerMinute'),
  duplicateWindowMs: bounded('duplicateWindowMs'),
  providerFailureThreshold: bounded('providerFailureThreshold'),
  providerFailureWindowMs: bounded('providerFailureWindowMs'),
})

// Writing settings is admin-only. The Settings page already disables the
// working-hours inputs for non-admins, but that is presentation, not
// authorization — anyone could PATCH this endpoint directly and change the
// default send channel or the off-hours auto-reply for the whole company.
export async function PATCH(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa mengubah pengaturan' }, { status: 403 })

  const parsed = await parseJsonBody(req, patchSchema, 'Data pengaturan tidak valid')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const settings = await prisma.settings.update({ where: { id: 1 }, data: parsed.data })

  // Everything this endpoint writes changes what a customer gets: the sentences the bot says,
  // the escalation switch, and the four outbound safety thresholds — where a mistyped
  // `duplicateWindowMs` does not loosen the duplicate check, it turns it off.
  //
  // Only the NAMES of the changed fields are recorded, never the values. The current value is
  // always on the page itself, and a value is where a pasted token would ride into the history
  // table. The names come from the Zod schema, so nothing free-form reaches this row.
  const changed = Object.keys(parsed.data).sort().join(', ')
  if (changed.length > 0) {
    const actor = await prisma.account.findUnique({ where: { id: admin.accountId }, select: { name: true } })
    await writeBotAuditLog({
      action: 'UPDATE',
      entityType: 'BOT_SETTING',
      entityKey: changed,
      actorId: admin.accountId,
      actorName: actor?.name ?? null,
    })
  }

  return NextResponse.json(settings)
}
