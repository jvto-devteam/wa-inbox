import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { jakartaDayKey, jakartaDayRange } from '@/lib/daily-summary/time'
import type { AiAgentKey } from '@/lib/ai-office/activity'

/** Kartu status satu asisten di Kantor AI: pekerjaan terakhir + jumlah pekerjaan hari ini (WIB). */
export type AiOfficeAgentStatus = {
  agent: AiAgentKey
  lastAt: string | null
  lastLabel: string | null
  lastConversationId: string | null
  todayCount: number
}
export type AiOfficeResponse = { agents: AiOfficeAgentStatus[] }

const BOT_MODE_LABEL: Record<string, string> = {
  booking_context: 'Menjawab dari data booking',
  faq: 'Menjawab dari knowledge base',
  clarify: 'Bertanya balik ke tamu',
  handoff: 'Menyerahkan ke admin',
}

const BOOKING_EVENT_LABEL: Record<string, string> = {
  CREATED: 'Mencatat permintaan perubahan',
  EXECUTED: 'Memperbarui backoffice',
  GUEST_NOTICE_SENT: 'Mengabari tamu',
  GUEST_ACK_SENT: 'Mengirim tanda terima ke tamu',
  VENDOR_NOTICE_SIMULATED: 'Kabar vendor (simulasi)',
  DRAFT_SENT: 'Meminta data ke tamu',
  RESOLVED: 'Menutup kartu yang sudah sesuai',
}

/**
 * Status awal Kantor AI (owner 2026-10-23). Halaman lalu hidup dari SSE (`pipeline.step` untuk bot, `ai.activity` untuk
 * yang lain); route ini hanya mengisi kartu "Terakhir" dan "hari ini" saat halaman dibuka. Hanya label, tanpa isi chat.
 */
export async function GET(req: Request) {
  try {
    const session = await getSession(req)
    if (!session) return NextResponse.json({ error: 'Belum masuk' }, { status: 401 })
    const { start } = jakartaDayRange(jakartaDayKey(new Date()))

    const [botLast, botToday, reviewLast, reviewToday, bookingLast, bookingToday, topicLast, topicToday] = await Promise.all([
      prisma.botDecisionRun.findFirst({ orderBy: { startedAt: 'desc' }, select: { startedAt: true, mode: true, conversationId: true } }),
      prisma.botDecisionRun.count({ where: { startedAt: { gte: start } } }),
      prisma.conversation.findFirst({ where: { chatReviewAt: { not: null } }, orderBy: { chatReviewAt: 'desc' }, select: { id: true, chatReviewAt: true } }),
      prisma.conversation.count({ where: { chatReviewAt: { gte: start } } }),
      prisma.bookingActionEvent.findFirst({
        where: { event: { not: 'PUSHED' } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, event: true, conversationId: true },
      }),
      prisma.bookingActionEvent.count({ where: { createdAt: { gte: start }, event: { in: ['CREATED', 'EXECUTED'] } } }),
      prisma.message.findFirst({
        where: { direction: 'INBOUND', topicLabels: { not: { equals: null } } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, conversationId: true },
      }),
      prisma.message.count({ where: { direction: 'INBOUND', createdAt: { gte: start }, topicLabels: { not: { equals: null } } } }),
    ])

    const agents: AiOfficeAgentStatus[] = [
      {
        agent: 'topik',
        lastAt: topicLast?.createdAt.toISOString() ?? null,
        lastLabel: topicLast ? 'Memberi label topik pesan' : null,
        lastConversationId: topicLast?.conversationId ?? null,
        todayCount: topicToday,
      },
      {
        agent: 'bot',
        lastAt: botLast?.startedAt.toISOString() ?? null,
        lastLabel: botLast ? BOT_MODE_LABEL[botLast.mode] ?? 'Membalas tamu' : null,
        lastConversationId: botLast?.conversationId ?? null,
        todayCount: botToday,
      },
      {
        agent: 'booking',
        lastAt: bookingLast?.createdAt.toISOString() ?? null,
        lastLabel: bookingLast ? BOOKING_EVENT_LABEL[bookingLast.event] ?? 'Mengurus perubahan booking' : null,
        lastConversationId: bookingLast?.conversationId ?? null,
        todayCount: bookingToday,
      },
      {
        agent: 'ringkasan',
        lastAt: reviewLast?.chatReviewAt?.toISOString() ?? null,
        lastLabel: reviewLast ? 'Meringkas chat & poin penting' : null,
        lastConversationId: reviewLast?.id ?? null,
        todayCount: reviewToday,
      },
    ]
    return NextResponse.json({ agents } satisfies AiOfficeResponse)
  } catch (error) {
    console.error('GET /api/ai-office gagal', { error: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ error: 'Gagal memuat Kantor AI' }, { status: 500 })
  }
}
