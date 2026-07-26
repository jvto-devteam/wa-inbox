import { NextResponse } from 'next/server'
import { execSync } from 'child_process'
import { prisma } from '@/lib/db'

export async function POST() {
  try {
    execSync('npm run sync:knowledge', { cwd: process.cwd() })
    await prisma.settings.update({ where: { id: 1 }, data: { catalogSyncedAt: new Date() } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Sinkronisasi gagal — cek log server' }, { status: 500 })
  }
}
