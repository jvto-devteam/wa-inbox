import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { conversationReviewSchema, type ConversationReview } from '@/lib/daily-summary/payload-schema'
import { chatReviewHistory, type ChatReviewHistoryEntry } from '@/lib/chat-review/history'
import { noteManualChatReviewRefresh } from '@/lib/chat-review/auto-refresh'
import { refreshChatReview } from '@/lib/chat-review/refresh'
import { currentBookingId, inCurrentBooking } from '@/lib/booking-actions/scope'
import type { BookingActionEventView, PinnedBookingAction } from '@/lib/booking-actions/view'
import { reconcileSummaryItems } from '@/lib/summary-items/sync'
import { toSummaryItemStatus, type SummaryItemStatus } from '@/lib/summary-items/status'

/**
 * Tab "Ringkasan chat" di panel kanan Inbox.
 *
 * GET  membaca ringkasan terbaru (`Conversation.chatReview`), status tindak lanjut live
 *      (`SummaryItem`, setelah rekonsiliasi) dan riwayat per hari dari `DailySummary`.
 * POST meringkas SEKARANG lewat LLM untuk percakapan ini (tombol "Perbarui sekarang"), lalu
 *      menerapkan hasilnya ke item "Janji tim" percakapan ini (`applyReviewToItem`).
 *
 * Terbuka untuk semua yang login, sama seperti /api/summary-items: hanya baca dan ringkas, tidak
 * mengubah apa yang bot lakukan, jadi tanpa hasAdminPowers dan tanpa audit log.
 */

/** Jeda minimal antar panggilan LLM per percakapan; klik beruntun mengembalikan hasil yang ada. */
export const REFRESH_COOLDOWN_MS = 30_000

/** Status item antrean + anchor-nya; bentuk dasarnya dipakai bersama GET /api/daily-summary. */
export type ChatReviewItem = SummaryItemStatus & { anchorAt: string }

export type ChatReviewResponse = {
  latest: { review: ConversationReview; at: string } | null
  item: ChatReviewItem | null
  history: ChatReviewHistoryEntry[]
  /**
   * Waktu pesan terakhir percakapan ini (ISO), apa pun arahnya -- untuk tanda "Ada pesan baru
   * sejak ringkasan ini". Dibaca dari tabel pesan, bukan `Conversation.lastMessageAt`: kolom itu
   * tidak diperbarui di setiap jalur kirim (balasan bot, misalnya). null = belum ada pesan.
   */
  lastMessageAt: string | null
  /** Aksi booking OPEN (CHANGE/TASK/MISMATCH) dalam booking saat ini, dibaca live; terlama dulu. */
  pinned: PinnedBookingAction[]
  /** 20 kejadian aksi booking terbaru percakapan ini, terbaru di atas. */
  changeHistory: BookingActionEventView[]
}

const CHANGE_HISTORY_LIMIT = 20

type Ctx = { params: Promise<{ id: string }> }

async function loadPinned(conversationId: string, bookingData: unknown): Promise<PinnedBookingAction[]> {
  const bookingId = currentBookingId(bookingData)
  const rows = await prisma.bookingAction.findMany({
    where: { conversationId, state: 'OPEN', type: { in: ['CHANGE', 'TASK', 'MISMATCH'] } },
    orderBy: { createdAt: 'asc' },
  })
  return (rows ?? [])
    .filter((r) => inCurrentBooking(r, bookingId))
    .map((r) => ({
      id: r.id,
      type: r.type as PinnedBookingAction['type'],
      field: r.field,
      proposedValue: r.proposedValue,
      sourceMessageId: r.sourceMessageId,
      createdAt: r.createdAt.toISOString(),
    }))
}

async function loadChangeHistory(conversationId: string): Promise<BookingActionEventView[]> {
  const events = (await prisma.bookingActionEvent.findMany({
    where: { conversationId, event: { not: 'PUSHED' } },
    orderBy: { createdAt: 'desc' },
    take: CHANGE_HISTORY_LIMIT,
  })) ?? []
  const accountIds = [...new Set(events.map((e) => e.accountId).filter((v): v is string => v !== null))]
  const accounts = accountIds.length > 0
    ? ((await prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } })) ?? [])
    : []
  const names = new Map(accounts.map((a) => [a.id, a.name]))
  return events.map((e) => ({
    id: e.id,
    event: e.event,
    actor: e.actor as BookingActionEventView['actor'],
    accountName: e.accountId ? (names.get(e.accountId) ?? null) : null,
    reason: e.reason,
    sourceMessageId: e.sourceMessageId,
    oldValue: e.oldValue,
    newValue: e.newValue,
    createdAt: e.createdAt.toISOString(),
  }))
}

async function buildResponse(conversationId: string): Promise<ChatReviewResponse | null> {
  await reconcileSummaryItems()
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { chatReview: true, chatReviewAt: true, summaryItem: true, bookingData: true },
  })
  if (!conv) return null
  const parsed = conversationReviewSchema.safeParse(conv.chatReview)
  const latest = parsed.success && conv.chatReviewAt ? { review: parsed.data, at: conv.chatReviewAt.toISOString() } : null
  const s = conv.summaryItem
  const item: ChatReviewItem | null = s ? { ...toSummaryItemStatus(s), anchorAt: s.anchorAt.toISOString() } : null
  const lastMessage = await prisma.message.findFirst({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  return {
    latest,
    item,
    history: await chatReviewHistory(conversationId),
    lastMessageAt: lastMessage?.createdAt.toISOString() ?? null,
    pinned: await loadPinned(conversationId, conv.bookingData),
    changeHistory: await loadChangeHistory(conversationId),
  }
}

export async function GET(req: Request, { params }: Ctx) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  try {
    const body = await buildResponse(id)
    if (!body) return NextResponse.json({ error: 'Percakapan tidak ditemukan' }, { status: 404 })
    return NextResponse.json(body)
  } catch (err) {
    console.error('GET /api/conversations/[id]/chat-review failed', err)
    return NextResponse.json({ error: 'Gagal memuat ringkasan' }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: Ctx) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  try {
    const conv = await prisma.conversation.findUnique({ where: { id }, select: { chatReviewAt: true } })
    if (!conv) return NextResponse.json({ error: 'Percakapan tidak ditemukan' }, { status: 404 })

    // Penjaga klik beruntun: hasil yang baru dibuat dikembalikan tanpa memanggil LLM lagi.
    const now = new Date()
    if (conv.chatReviewAt && now.getTime() - conv.chatReviewAt.getTime() < REFRESH_COOLDOWN_MS) {
      const existing = await buildResponse(id)
      return NextResponse.json(existing)
    }

    const result = await refreshChatReview(id, now)
    // Tidak ada run otomatis tambahan dalam 5 menit sesudah tombol ini.
    noteManualChatReviewRefresh(id)
    if (result.status === 'empty') return NextResponse.json({ error: 'Percakapan belum punya pesan' }, { status: 400 })
    if (result.status === 'failed') return NextResponse.json({ error: 'Gagal meringkas. Coba lagi.' }, { status: 502 })
    return NextResponse.json(await buildResponse(id))
  } catch (err) {
    console.error('POST /api/conversations/[id]/chat-review failed', err)
    return NextResponse.json({ error: 'Gagal meringkas. Coba lagi.' }, { status: 500 })
  }
}
