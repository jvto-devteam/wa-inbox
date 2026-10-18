import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { buildTranscript } from '@/lib/daily-summary/collect'
import { TRANSCRIPT_MAX_MESSAGES } from '@/lib/daily-summary/config'
import { conversationReviewSchema, type ConversationReview } from '@/lib/daily-summary/payload-schema'
import { reviewConversation, type ReviewReason } from '@/lib/daily-summary/review'
import { chatReviewHistory, type ChatReviewHistoryEntry } from '@/lib/chat-review/history'
import { saveChatReview } from '@/lib/chat-review/store'
import { reconcileSummaryItems } from '@/lib/summary-items/sync'
import { toSummaryItemStatus, type SummaryItemStatus } from '@/lib/summary-items/status'

/**
 * Tab "Ringkasan chat" di panel kanan Inbox.
 *
 * GET  membaca ringkasan terbaru (`Conversation.chatReview`), status tindak lanjut live
 *      (`SummaryItem`, setelah rekonsiliasi) dan riwayat per hari dari `DailySummary`.
 * POST meringkas SEKARANG lewat LLM untuk percakapan ini (tombol "Perbarui sekarang").
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
}

type Ctx = { params: Promise<{ id: string }> }

async function buildResponse(conversationId: string): Promise<ChatReviewResponse | null> {
  await reconcileSummaryItems()
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { chatReview: true, chatReviewAt: true, summaryItem: true },
  })
  if (!conv) return null
  const parsed = conversationReviewSchema.safeParse(conv.chatReview)
  const latest = parsed.success && conv.chatReviewAt ? { review: parsed.data, at: conv.chatReviewAt.toISOString() } : null
  const s = conv.summaryItem
  const item: ChatReviewItem | null = s ? { ...toSummaryItemStatus(s), anchorAt: s.anchorAt.toISOString() } : null
  return { latest, item, history: await chatReviewHistory(conversationId) }
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

    const latest = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'desc' },
      take: TRANSCRIPT_MAX_MESSAGES,
      select: { id: true, direction: true, sentBy: true, type: true, content: true, createdAt: true },
    })
    if (latest.length === 0) return NextResponse.json({ error: 'Percakapan belum punya pesan' }, { status: 400 })
    const messages = [...latest].reverse()
    const reasons: ReviewReason[] = messages[messages.length - 1].direction === 'INBOUND' ? ['unreplied'] : ['active']

    const settings = await prisma.settings.findUnique({ where: { id: 1 }, select: { ollamaModel: true } })
    const review = await reviewConversation(buildTranscript(messages), reasons, settings?.ollamaModel ?? undefined)
    if (!review) return NextResponse.json({ error: 'Gagal meringkas. Coba lagi.' }, { status: 502 })

    await saveChatReview(id, review, now)
    return NextResponse.json(await buildResponse(id))
  } catch (err) {
    console.error('POST /api/conversations/[id]/chat-review failed', err)
    return NextResponse.json({ error: 'Gagal meringkas. Coba lagi.' }, { status: 500 })
  }
}
