import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'

/**
 * GET /api/summary-items/count — lencana menu Antrean. Tanpa rekonsiliasi (dipanggil berkala).
 * `total` = angka "N hal menunggu tim" di halaman Antrean (owner 2026-11-26: lencana dan halaman harus sama): item OPEN
 * (Balas, Follow Up, Janji Admin) + reminder yang belum selesai di tab Reminder. Reminder yang itemnya sudah kembali OPEN
 * tidak dihitung dua kali -- aturan yang sama dengan GET /api/new/reminders.
 */
export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const [open, reopened] = await Promise.all([
      prisma.summaryItem.count({ where: { state: 'OPEN' } }),
      prisma.summaryItem.findMany({ where: { state: 'OPEN', reminderId: { not: null } }, select: { reminderId: true } }),
    ])
    const skip = reopened.map((r) => r.reminderId).filter((id): id is string => id !== null)
    const reminders = await prisma.reminder.count({ where: { done: false, ...(skip.length ? { id: { notIn: skip } } : {}) } })
    return NextResponse.json({ open, reminders, total: open + reminders })
  } catch (err) {
    console.error('GET /api/summary-items/count failed', err)
    return NextResponse.json({ error: 'Gagal menghitung antrean' }, { status: 500 })
  }
}
