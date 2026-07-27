import { NextResponse } from 'next/server'
import { execSync } from 'child_process'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'

// `execSync` is SYNCHRONOUS: it blocks the Node event loop for its whole
// duration, so a hung child process freezes every other in-flight request for
// every other user until the process is killed. A hard ceiling is therefore
// mandatory, not a nicety.
//
// 60s: scripts/sync-agent-catalog.ts copies catalog JSON between two local
// checkouts (fast, no network) and shells out once to the agent-runtime's
// `python3 -m jvto_agent_runtime deployment-gate` CLI. That is a local
// process-startup-bound workload measured in seconds; a minute is generous
// headroom while still far below anything an operator would call "hung".
// On timeout execSync throws (ETIMEDOUT), which the catch below turns into the
// same clean 500 as any other failure.
const SYNC_TIMEOUT_MS = 60_000

// This endpoint shells out (`npm run sync:knowledge`) and rewrites the bot's
// knowledge base. Anything that spawns a server-side process must be
// admin-only, and the guard runs before execSync so a non-admin request never
// starts the child process at all.
export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa menyinkronkan katalog' }, { status: 403 })

  try {
    execSync('npm run sync:knowledge', { cwd: process.cwd(), timeout: SYNC_TIMEOUT_MS })
    await prisma.settings.update({ where: { id: 1 }, data: { catalogSyncedAt: new Date() } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    // The response deliberately stays generic (it is operator-facing UI copy and
    // must not leak child-process stderr to the browser) — but "cek log server"
    // is a lie unless something is actually written to the log.
    console.error('sync-catalog failed', error)
    return NextResponse.json({ error: 'Sinkronisasi gagal — cek log server' }, { status: 500 })
  }
}
