import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { hasValidCronSecret } from '@/lib/outbound/cron-auth'
import { processDueOutboundJobs } from '@/lib/outbound/worker'
import { pruneBotAuditLogs } from '@/lib/bot-control/audit'
import { advancePipelineStagesFromBooking } from '@/lib/booking/client'

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
 *
 * --- Why the audit-log pruning rides along here ---
 *
 * This is the ONLY endpoint a scheduler already calls, so it is the only recurring beat the app
 * has. Giving the one-year audit retention its own cron entry would mean a second secret, a
 * second middleware path, and a job an operator has to remember to configure — for a DELETE
 * that is an indexed no-op on almost every tick. Attaching it here costs nothing and cannot be
 * forgotten. It runs OUTSIDE the try/catch below and swallows its own errors, so tidying the
 * history can never be the reason a queue stops draining.
 */
export async function POST(req: Request) {
  const authorized = hasValidCronSecret(req) || (await requireAdmin(req)) !== null
  if (!authorized) {
    return NextResponse.json({ error: 'Hanya admin atau scheduler yang bisa memproses antrean' }, { status: 403 })
  }

  // Housekeeping first and unguarded-by-the-tally: `pruneBotAuditLogs` never throws, and the
  // `.catch` is the belt to that braces — a future edit that makes it throw must still not be
  // able to take the queue down with it.
  await pruneBotAuditLogs().catch((error: unknown) => {
    console.error('POST /api/outbound-jobs/process: pruning audit log gagal', error)
  })

  // Menumpang tick yang sama, dan dengan alasan yang sama seperti pruning: ia butuh dijalankan
  // berkala, tapi tidak sepadan dengan cron entry sendiri (berarti secret kedua, path middleware
  // kedua, dan satu hal lagi yang bisa lupa dikonfigurasi).
  //
  // Kenapa berkala: tahap `selesai` datang dari tanggal trip yang lewat, bukan dari ada yang
  // mengetik. Tanpa penyapu ini tahap hanya naik saat percakapan dibuka atau bot membalas, dan
  // percakapan yang tripnya sudah selesai justru percakapan yang tidak ada lagi yang membukanya.
  await advancePipelineStagesFromBooking().catch((error: unknown) => {
    console.error('POST /api/outbound-jobs/process: menaikkan tahap pipeline gagal', error)
  })

  try {
    return NextResponse.json(await processDueOutboundJobs())
  } catch (error) {
    console.error('POST /api/outbound-jobs/process gagal', error)
    return NextResponse.json({ error: 'Gagal memproses antrean' }, { status: 500 })
  }
}
