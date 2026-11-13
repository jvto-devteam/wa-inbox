import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { RETENTION_MS } from '@/lib/daily-summary/config'
import { crewNoteSchema, scheduleNoteSchema, type ConversationReview, type CrewNote, type ScheduleNote } from '@/lib/daily-summary/payload-schema'

/** Catatan crew yang tersimpan di `chatReview` sebuah percakapan, atau null (belum ada / bentuk lama). */
export function crewNoteOf(chatReview: unknown): CrewNote | null {
  if (!chatReview || typeof chatReview !== 'object') return null
  const parsed = crewNoteSchema.safeParse((chatReview as { catatanCrew?: unknown }).catatanCrew)
  return parsed.success ? parsed.data : null
}

/** Note untuk Schedule yang tersimpan di `chatReview` sebuah percakapan, atau null. */
export function scheduleNoteOf(chatReview: unknown): ScheduleNote | null {
  if (!chatReview || typeof chatReview !== 'object') return null
  const parsed = scheduleNoteSchema.safeParse((chatReview as { catatanSchedule?: unknown }).catatanSchedule)
  return parsed.success ? parsed.data : null
}

/**
 * Menyimpan ringkasan TERBARU satu percakapan untuk tab "Ringkasan chat" di Inbox.
 *
 * Penulisan bersyarat (`chatReviewAt` null, lebih lama dari, atau sama dengan `asOf`): ringkasan tanggal lama
 * yang dibuat ulang lewat /summary tidak boleh menimpa hasil yang lebih baru, termasuk hasil
 * tombol "Perbarui". `lte` (bukan `lt`): "Buat ulang" untuk tanggal terbaru menghasilkan `asOf` yang sama,
 * dan hasil barunya harus tetap sampai ke panel. Tidak pernah melempar; kegagalan simpan tidak boleh menggagalkan pemanggil.
 */
export async function saveChatReview(conversationId: string, review: ConversationReview, asOf: Date): Promise<boolean> {
  try {
    // Ringkasan dari jalur lain (job harian) tidak membawa `catatanCrew` maupun `catatanSchedule`; tanpa ini keduanya
    // terhapus tiap tengah malam.
    let toSave = review
    if (!review.catatanCrew || !review.catatanSchedule) {
      const existing = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { chatReview: true } })
      const keptCrew = review.catatanCrew ? null : crewNoteOf(existing?.chatReview)
      const keptSchedule = review.catatanSchedule ? null : scheduleNoteOf(existing?.chatReview)
      if (keptCrew) toSave = { ...toSave, catatanCrew: keptCrew }
      if (keptSchedule) toSave = { ...toSave, catatanSchedule: keptSchedule }
    }
    const { count } = await prisma.conversation.updateMany({
      where: { id: conversationId, OR: [{ chatReviewAt: null }, { chatReviewAt: { lte: asOf } }] },
      data: { chatReview: toSave, chatReviewAt: asOf },
    })
    return count > 0
  } catch (error) {
    console.error('saveChatReview gagal', { conversationId, error: error instanceof Error ? error.message : 'unknown' })
    return false
  }
}

/**
 * Mengosongkan ringkasan terbaru yang `chatReviewAt`-nya lebih tua dari masa simpan (30 hari,
 * sama dengan DailySummary dan SummaryItem): isinya memuat poin penting chat pelanggan. Hanya
 * kolomnya yang dikosongkan, barisnya tetap. Tidak pernah melempar.
 */
export async function pruneChatReviews(now: Date = new Date()): Promise<{ cleared: number }> {
  try {
    const { count } = await prisma.conversation.updateMany({
      where: { chatReviewAt: { lt: new Date(now.getTime() - RETENTION_MS) } },
      data: { chatReview: Prisma.DbNull, chatReviewAt: null },
    })
    return { cleared: count }
  } catch (error) {
    console.error('pruneChatReviews gagal', { error: error instanceof Error ? error.message : 'unknown' })
    return { cleared: 0 }
  }
}
