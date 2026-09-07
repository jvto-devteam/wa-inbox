import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { recoverStuckOutboundJobs } from '@/lib/outbound/worker'

/**
 * POST /api/outbound-jobs/recover-stuck — hand abandoned SENDING jobs back to the retry ladder.
 *
 * The worker already runs this at the top of every queue drain, so on a healthy scheduler this
 * endpoint has nothing to do. It exists for the case the scheduler is the thing that broke:
 * a cron that stopped firing, a deploy that killed a batch of workers mid-claim, an incident
 * where an operator needs the queue moving NOW rather than at the next tick (SDD Manage Second
 * §8.7 and §9.6's "Recover stuck jobs" action).
 *
 * Admin-only, and deliberately NOT added to the cron paths in src/middleware.ts. The scheduled
 * path already covers recovery from inside processDueOutboundJobs; a second unauthenticated
 * entry point onto a mutation that moves job state would widen the attack surface for a
 * capability the scheduler does not need.
 */
export async function POST(req: Request) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: 'Hanya admin yang bisa memulihkan job yang menggantung' }, { status: 403 })
  }

  try {
    const result = await recoverStuckOutboundJobs()
    // Both numbers, always, including the all-zero case: "0 dipulihkan" is a real and useful
    // answer (nothing was stuck), and is different information from a failure.
    return NextResponse.json(result)
  } catch (error) {
    console.error('POST /api/outbound-jobs/recover-stuck gagal', error)
    return NextResponse.json({ error: 'Gagal memulihkan job yang menggantung' }, { status: 500 })
  }
}
