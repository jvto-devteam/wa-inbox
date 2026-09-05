import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { hasValidCronSecret } from '@/lib/outbound/cron-auth'
import { processDueOutboundJobs } from '@/lib/outbound/worker'

/**
 * POST /api/outbound-jobs/process — run every outbound job that is currently due.
 *
 * This app has no background job runner: Next.js route handlers only execute when something
 * calls them. `sendMessage` fires attempt 1 inline, so a healthy send needs nothing here — but
 * attempts 2, 3 and 4 of the retry ladder are scheduled for 30s / 2m / 10m later, and NOTHING
 * would ever come back for them without a scheduler hitting this endpoint. It follows the same
 * pattern GET /api/reminders/due already established for time-based work.
 *
 * Two callers are accepted: an ADMIN session (a human pressing something in the UI) and a
 * scheduler presenting the `x-cron-secret` header. The secret is re-checked HERE as well as in
 * src/middleware.ts — the middleware decides whether the request may reach a handler at all,
 * this decides whether it may act. Relying on the middleware alone would mean a future edit to
 * its matcher config silently unauthenticating this endpoint.
 *
 * Safe to call concurrently: the worker claims each job atomically, so two overlapping runs
 * cannot dispatch the same message twice.
 */
export async function POST(req: Request) {
  const authorized = hasValidCronSecret(req) || (await requireAdmin(req)) !== null
  if (!authorized) {
    return NextResponse.json({ error: 'Hanya admin atau scheduler yang bisa memproses antrean' }, { status: 403 })
  }

  try {
    return NextResponse.json(await processDueOutboundJobs())
  } catch (error) {
    console.error('POST /api/outbound-jobs/process gagal', error)
    return NextResponse.json({ error: 'Gagal memproses antrean' }, { status: 500 })
  }
}
