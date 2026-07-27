import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'

// Flipping the kill switch halts (or resumes) every bot reply company-wide.
// That is an emergency lever, not something any agent should be able to pull.
export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa mengubah kill switch bot' }, { status: 403 })

  const current = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
  const updated = await prisma.settings.update({ where: { id: 1 }, data: { botKillSwitch: !current.botKillSwitch } })
  return NextResponse.json({ botKillSwitch: updated.botKillSwitch })
}
