import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { currentBookingId, inCurrentBooking } from '@/lib/booking-actions/scope'
import type { BookingQueueItem, BookingActionType } from '@/lib/booking-actions/view'

/**
 * Antrean /summary bagian "Booking": aksi OPEN lintas percakapan, 100 terbaru. Cakupan booking
 * sama dengan label Inbox (`scope.ts`): aksi booking lama tidak ikut. Terbuka untuk semua yang
 * login (keputusan owner 2026-10-19).
 */
const LIMIT = 100

export async function GET(req: Request) {
  try {
    const session = await getSession(req)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const state = new URL(req.url).searchParams.get('state') ?? 'OPEN'
    if (state !== 'OPEN') return NextResponse.json({ error: 'state tidak didukung' }, { status: 400 })

    const rows = await prisma.bookingAction.findMany({
      where: { state: 'OPEN', type: { in: ['CHANGE', 'TASK', 'MISMATCH'] } },
      orderBy: { createdAt: 'desc' },
      take: LIMIT,
      include: { conversation: { select: { bookingData: true, contact: { select: { name: true } } } } },
    })
    const items: BookingQueueItem[] = rows
      .filter((r) => inCurrentBooking(r, currentBookingId(r.conversation.bookingData)))
      .map((r) => ({
        id: r.id,
        conversationId: r.conversationId,
        contactName: r.conversation.contact.name,
        type: r.type as BookingActionType,
        field: r.field,
        proposedValue: r.proposedValue,
        createdAt: r.createdAt.toISOString(),
      }))
    return NextResponse.json({ items })
  } catch (error) {
    console.error('GET booking-actions gagal', error)
    return NextResponse.json({ error: 'Gagal memuat tindakan booking' }, { status: 500 })
  }
}
