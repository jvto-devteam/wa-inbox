import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function POST() {
  const current = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
  const updated = await prisma.settings.update({ where: { id: 1 }, data: { botKillSwitch: !current.botKillSwitch } })
  return NextResponse.json({ botKillSwitch: updated.botKillSwitch })
}
