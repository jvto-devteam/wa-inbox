import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'

/**
 * GET /api/new/reminders — tab Reminder di Antrean /new: semua reminder kontak yang belum selesai, jatuh tempo
 * terdekat dulu. Termasuk reminder dari Ingatkan (item antrean SCHEDULED) dan dari "Ingatkan follow-up" di Laporan.
 * Reminder yang item antreannya sudah kembali OPEN (jatuh tempo) tidak dikirim: item itu sudah tampil di tab jenisnya.
 * Terbuka untuk semua yang login, seperti /api/summary-items.
 */
export type NewReminder = {
  id: string
  note: string
  dueAt: string
  contactId: string
  contactName: string | null
  /** Percakapan terbaru kontak itu; null = kontak tanpa percakapan. */
  conversationId: string | null
  /** Item antrean SCHEDULED yang memakai reminder ini (Tunda lewat /api/summary-items/[id]/schedule). */
  summaryItemId: string | null
}

const TAKE = 200

export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const rows = await prisma.reminder.findMany({
      where: { done: false },
      orderBy: { dueAt: 'asc' },
      take: TAKE,
      select: {
        id: true, note: true, dueAt: true, contactId: true,
        contact: { select: { name: true, conversations: { select: { id: true }, orderBy: { lastMessageAt: 'desc' }, take: 1 } } },
      },
    })
    const items = rows.length
      ? await prisma.summaryItem.findMany({
          where: { reminderId: { in: rows.map((r) => r.id) }, state: { in: ['OPEN', 'SCHEDULED'] } },
          select: { id: true, reminderId: true, state: true },
        })
      : []
    const byReminder = new Map(items.map((i) => [i.reminderId, i]))
    const reminders: NewReminder[] = rows
      .filter((r) => byReminder.get(r.id)?.state !== 'OPEN')
      .map((r) => ({
        id: r.id,
        note: r.note,
        dueAt: r.dueAt.toISOString(),
        contactId: r.contactId,
        contactName: r.contact.name,
        conversationId: r.contact.conversations[0]?.id ?? null,
        summaryItemId: byReminder.get(r.id)?.id ?? null,
      }))
    return NextResponse.json({ reminders })
  } catch (err) {
    console.error('GET /api/new/reminders failed', err)
    return NextResponse.json({ error: 'Gagal memuat reminder' }, { status: 500 })
  }
}
