import { prisma } from '@/lib/db'
import type { ConversationReview } from '@/lib/daily-summary/payload-schema'

/**
 * Menyimpan ringkasan TERBARU satu percakapan untuk tab "Ringkasan chat" di Inbox.
 *
 * Penulisan bersyarat (`chatReviewAt` null atau lebih lama dari `asOf`): ringkasan tanggal lama
 * yang dibuat ulang lewat /summary tidak boleh menimpa hasil yang lebih baru, termasuk hasil
 * tombol "Perbarui". Tidak pernah melempar; kegagalan simpan tidak boleh menggagalkan pemanggil.
 */
export async function saveChatReview(conversationId: string, review: ConversationReview, asOf: Date): Promise<boolean> {
  try {
    const { count } = await prisma.conversation.updateMany({
      where: { id: conversationId, OR: [{ chatReviewAt: null }, { chatReviewAt: { lt: asOf } }] },
      data: { chatReview: review, chatReviewAt: asOf },
    })
    return count > 0
  } catch (error) {
    console.error('saveChatReview gagal', { conversationId, error: error instanceof Error ? error.message : 'unknown' })
    return false
  }
}
