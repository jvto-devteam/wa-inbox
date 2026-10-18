import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'

/** GET /api/summary-items/count — jumlah item OPEN untuk lencana menu. Tanpa rekonsiliasi (dipanggil berkala). */
export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const open = await prisma.summaryItem.count({ where: { state: 'OPEN' } })
    return NextResponse.json({ open })
  } catch (err) {
    console.error('GET /api/summary-items/count failed', err)
    return NextResponse.json({ error: 'Gagal menghitung antrean' }, { status: 500 })
  }
}
