/**
 * Sapuan push yang hilang (review 2026-10-20, minor): push CHANGE dikirim fire-and-forget di dalam proses ekstraksi;
 * proses yang mati/restart di tengah (atau `releaseStaleExecuting` yang mengembalikan kartu ke OPEN) meninggalkan
 * kartu OPEN yang tidak pernah dikabarkan ke admin. Tiap tick (`POST /api/summary-items/tick`, sesudah
 * `releaseStaleExecuting`) kartu CHANGE OPEN yang terakhir berubah 2 menit .. 1 jam lalu dan belum punya event
 * `PUSHED` (dicatat `notifyBookingAction` untuk setiap push, src/lib/push/send.ts) di-push CHANGE sekali.
 * Batas 1 jam supaya kartu lama dari sebelum penanda ini ada tidak dibanjirkan sekaligus. Tidak pernah melempar.
 */
import { prisma } from '@/lib/db'
import { notifyBookingAction, pushMarkFailedRecently, summarizeAction } from '@/lib/push/send'

export const PUSH_SWEEP_MIN_AGE_MS = 2 * 60 * 1000
export const PUSH_SWEEP_MAX_AGE_MS = 60 * 60 * 1000
const MAX_PER_TICK = 20

function code(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const id = (raw as Record<string, unknown>).id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

export async function pushUnnotifiedChanges(now: Date = new Date()): Promise<number> {
  try {
    const rows = (await prisma.bookingAction.findMany({
      where: {
        type: 'CHANGE',
        state: 'OPEN',
        updatedAt: { lt: new Date(now.getTime() - PUSH_SWEEP_MIN_AGE_MS), gte: new Date(now.getTime() - PUSH_SWEEP_MAX_AGE_MS) },
      },
      orderBy: { updatedAt: 'asc' },
      take: 100,
      select: { id: true, conversationId: true, field: true, proposedValue: true, sourceMessageId: true, createdAt: true, conversation: { select: { bookingData: true } } },
    })) ?? []
    if (rows.length === 0) return 0
    // Dibatasi waktu (tanpa indeks actionId): penanda tidak mungkin lebih tua dari kartunya.
    const oldest = new Date(Math.min(...rows.map((r) => r.createdAt.getTime())))
    const marked = (await prisma.bookingActionEvent.findMany({
      where: { actionId: { in: rows.map((r) => r.id) }, event: 'PUSHED', createdAt: { gte: oldest } },
      select: { actionId: true },
    })) ?? []
    const pushed = new Set(marked.map((m) => m.actionId))
    let sent = 0
    for (const r of rows) {
      // Penanda gagal ditulis baru-baru ini: jangan push ulang tiap tick (send.ts mengingatnya di memori).
      if (pushed.has(r.id) || pushMarkFailedRecently(r.id, now.getTime())) continue
      if (sent >= MAX_PER_TICK) break
      const value = typeof r.proposedValue === 'string' && r.proposedValue.trim() ? r.proposedValue : null
      await notifyBookingAction({
        kind: 'CHANGE',
        conversationId: r.conversationId,
        bookingCode: code(r.conversation?.bookingData),
        summary: summarizeAction(r.field, value),
        actionId: r.id,
        messageId: r.sourceMessageId,
      })
      sent++
    }
    return sent
  } catch (error) {
    console.error('pushUnnotifiedChanges gagal', { error: error instanceof Error ? error.name : 'unknown' })
    return 0
  }
}
