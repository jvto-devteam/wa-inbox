import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { readBookingField, type FieldKey } from '@/lib/booking-actions/fields'
import { computeImpact, type Impact } from '@/lib/booking-actions/impact'
import { currentBookingId, inCurrentBooking } from '@/lib/booking-actions/scope'
import type { BookingData } from '@/lib/booking/client'
import { writeConfigured } from '@/lib/booking/backoffice-client'
import { releaseStaleExecuting } from '@/lib/booking-actions/execute'
import { EXECUTED_VISIBLE_MS, canRevertBatch } from '@/lib/booking-actions/view'

/**
 * Kartu tindakan booking di panel Inbox: aksi OPEN percakapan ini + 50 kejadian riwayat terbaru.
 * Terbuka untuk semua yang login (keputusan owner 2026-10-19), tanpa hasAdminPowers.
 * Nilai "lama" dibaca dari bookingData SAAT INI; dampak TASK dihitung saat ditampilkan.
 * Aksi EXECUTED (manual atau otomatis) dalam 24 jam terakhir ikut dikirim sebagai `executed` supaya bisa "Batalkan" (Task 11b).
 * Klaim eksekusi basi (EXECUTING > 2 menit, proses mati di tengah) dilepas ke OPEN di sini, sebelum
 * daftar dibaca, supaya kartunya muncul lagi saat admin membuka panel (Task 11, `execute.ts`).
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

    try {
      await releaseStaleExecuting(id)
    } catch (error) {
      // Panel tetap tampil; kartu yang macet menunggu pembukaan berikutnya.
      console.error('releaseStaleExecuting gagal', { conversationId: id, error: error instanceof Error ? error.name : 'unknown' })
    }

    const since = new Date(Date.now() - EXECUTED_VISIBLE_MS)
    const [rows, history, executedRows] = await Promise.all([
      prisma.bookingAction.findMany({
        where: { conversationId: id, state: 'OPEN', type: { in: ['CHANGE', 'TASK', 'MISMATCH', 'DATA_REQUEST'] } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.bookingActionEvent.findMany({
        where: { conversationId: id },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_LIMIT,
      }),
      prisma.bookingAction.findMany({
        where: { conversationId: id, state: 'EXECUTED', type: 'CHANGE', closedAt: { gte: since } },
        orderBy: { closedAt: 'desc' },
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

    const executedScoped = (executedRows ?? []).filter((r) => inCurrentBooking(r, bookingId))
    const executedEvents = executedScoped.length > 0
      ? ((await prisma.bookingActionEvent.findMany({
          where: { actionId: { in: executedScoped.map((r) => r.id) }, event: 'EXECUTED' },
          orderBy: { createdAt: 'desc' },
        })) ?? [])
      : []
    const executed = executedScoped.map((r) => {
      const ev = executedEvents.find((e) => e.actionId === r.id)
      // Sama dengan revertBookingAction: semua kartu satu batch + detail lama yang tertimpa harus bisa dibalik.
      const bo = typeof ev?.backoffice === 'object' && ev.backoffice !== null && !Array.isArray(ev.backoffice)
        ? (ev.backoffice as Record<string, unknown>)
        : {}
      const batch = Array.isArray(bo.batch) ? bo.batch.filter((x): x is string => typeof x === 'string') : [r.id]
      const members = (batch.includes(r.id) ? batch : [r.id, ...batch]).map((bid) => {
        const row = executedScoped.find((x) => x.id === bid)
        const m: { field: string; oldValue: unknown } | null = row
          ? { field: row.field, oldValue: executedEvents.find((e) => e.actionId === bid)?.oldValue }
          : null
        return m
      }).filter((m): m is { field: string; oldValue: unknown } => m !== null)
      return {
        revertable: canRevertBatch(members, bo.previousDetail),
        id: r.id,
        conversationId: r.conversationId,
        field: r.field,
        tier: r.tier,
        newValue: str(r.proposedValue),
        oldValue: str(ev?.oldValue),
        closedReason: r.closedReason,
        closedAt: r.closedAt ? r.closedAt.toISOString() : null,
      }
    })

    // Nama pelaku untuk riwayat. Satu kueri hanya bila ada kejadian oleh akun.
    const accountIds = [...new Set(history.map((h) => h.accountId).filter((v): v is string => v !== null))]
    const accounts = accountIds.length > 0
      ? await prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } })
      : []
    const names = new Map((accounts ?? []).map((a) => [a.id, a.name]))
    const historyView = history.map((h) => ({ ...h, accountName: h.accountId ? (names.get(h.accountId) ?? null) : null }))

    return NextResponse.json({ booking, actions, executed, history: historyView, writeEnabled: writeConfigured() })
  } catch (error) {
    console.error('GET booking-actions gagal', error)
    return NextResponse.json({ error: 'Gagal memuat tindakan booking' }, { status: 500 })
  }
}
