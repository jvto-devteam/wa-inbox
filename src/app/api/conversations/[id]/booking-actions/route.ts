import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { readBookingField, type FieldKey } from '@/lib/booking-actions/fields'
import { computeImpact, type Impact } from '@/lib/booking-actions/impact'
import { currentBookingId, inCurrentBooking } from '@/lib/booking-actions/scope'
import type { BookingData } from '@/lib/booking/client'

/**
 * Kartu tindakan booking di panel Inbox: aksi OPEN percakapan ini + 50 kejadian riwayat terbaru.
 * Terbuka untuk semua yang login (keputusan owner 2026-10-19), tanpa hasAdminPowers.
 * Nilai "lama" dibaca dari bookingData SAAT INI; dampak TASK dihitung saat ditampilkan.
 */
const HISTORY_LIMIT = 50

type Ctx = { params: Promise<{ id: string }> }

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

export async function GET(req: Request, { params }: Ctx) {
  try {
    const session = await getSession(req)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params

    const conv = await prisma.conversation.findUnique({ where: { id }, select: { bookingData: true } })
    if (!conv) return NextResponse.json({ error: 'Percakapan tidak ditemukan' }, { status: 404 })

    const raw = conv.bookingData
    const data: BookingData | null =
      typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as BookingData) : null
    const bookingId = currentBookingId(data)
    const date = data?.date as { start?: unknown; end?: unknown } | undefined
    const booking = data && bookingId !== null
      ? { id: bookingId, code: str(data.id), start: str(date?.start), end: str(date?.end) }
      : null

    const [rows, history] = await Promise.all([
      prisma.bookingAction.findMany({
        where: { conversationId: id, state: 'OPEN', type: { in: ['CHANGE', 'TASK', 'MISMATCH', 'DATA_REQUEST'] } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.bookingActionEvent.findMany({
        where: { conversationId: id },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_LIMIT,
      }),
    ])

    const scoped = rows.filter((r) => inCurrentBooking(r, bookingId))
    const actions = await Promise.all(
      scoped.map(async (r) => {
        const oldValue = data ? readBookingField(data, r.field as FieldKey) : null
        if (r.type !== 'TASK') return { ...r, oldValue }
        const target = r.bookingId ?? bookingId
        const impact: Impact = target === null
          ? { crewClashes: [], hotelNights: [], medicalCheckupDate: null, unavailable: true }
          : await computeImpact({ field: r.field as FieldKey, proposedValue: r.proposedValue, bookingId: target })
        return { ...r, oldValue, impact }
      }),
    )

    return NextResponse.json({ booking, actions, history })
  } catch (error) {
    console.error('GET booking-actions gagal', error)
    return NextResponse.json({ error: 'Gagal memuat tindakan booking' }, { status: 500 })
  }
}
