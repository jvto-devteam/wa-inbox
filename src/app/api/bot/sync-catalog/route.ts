import { NextResponse } from 'next/server'
import { execSync } from 'child_process'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'

// This endpoint shells out (`npm run sync:knowledge`) and rewrites the bot's
// knowledge base. Anything that spawns a server-side process must be
// admin-only, and the guard runs before execSync so a non-admin request never
// starts the child process at all.
export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa menyinkronkan katalog' }, { status: 403 })

  try {
    execSync('npm run sync:knowledge', { cwd: process.cwd() })
    await prisma.settings.update({ where: { id: 1 }, data: { catalogSyncedAt: new Date() } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Sinkronisasi gagal — cek log server' }, { status: 500 })
  }
}
