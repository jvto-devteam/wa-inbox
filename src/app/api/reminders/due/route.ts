import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET() {
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)

  // "Jatuh tempo" means due today OR earlier (overdue reminders must still surface), so this
  // uses `lte: endOfToday` rather than a same-day range — a reminder due yesterday should still
  // show up on the Beranda widget until it's marked done.
  const reminders = await prisma.reminder.findMany({
    where: { done: false, dueAt: { lte: endOfToday } },
    include: { contact: true },
    orderBy: { dueAt: 'asc' },
  })

  return NextResponse.json(
    reminders.map((r) => ({
      id: r.id,
      note: r.note,
      dueAt: r.dueAt,
      contactId: r.contact.id,
      contactName: r.contact.name,
    }))
  )
}
