import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { isUnsourcedFaqReply } from './gap-signal'
import type { BotDecision } from '@/lib/bot/types'

/** Alasan gap untuk balasan FAQ yang tidak bersandar pada satu pun fakta yang dikirim ke model. */
export const UNSOURCED_REPLY_REASON = 'reply_unsourced'

/**
 * Mencatat satu balasan yang tidak bersumber, lalu memberi tahu lonceng.
 *
 * Dipanggil dari `inbound.ts` SETELAH balasannya terkirim, bukan dari orchestrator: hanya di
 * titik itu id percakapan, id pesan, dan id run ada bersamaan, dan notifikasi membutuhkan
 * ketiganya untuk bisa melompat tepat ke gelembungnya. Dua sinyal gap lama tetap ditulis di
 * tempatnya masing-masing (orchestrator.ts) dan tidak disentuh.
 *
 * Tidak pernah melempar: giliran bot yang sudah berhasil tidak boleh gagal gara-gara
 * pembukuan.
 */
export async function recordUnsourcedReplyGap(params: {
  decision: BotDecision
  conversationId: string
  messageId?: string
  runId: string | null
  inboundText: string
}): Promise<void> {
  const { decision } = params
  // Pemeriksaan mode kedua kalinya ada demi penyempitan tipe, bukan demi logika: `topic` dan
  // `sourceTopic` hanya ada di varian faq.
  if (!isUnsourcedFaqReply(decision) || decision.mode !== 'faq') return

  try {
    await prisma.knowledgeGapLog.create({
      data: {
        conversationId: params.conversationId,
        topic: decision.topic ?? decision.sourceTopic,
        reason: UNSOURCED_REPLY_REASON,
        messageText: params.inboundText,
        messageId: params.messageId ?? null,
        runId: params.runId,
      },
    })
    broadcast({ type: 'knowledge.gap', conversationId: params.conversationId })
  } catch (error) {
    console.error('recordUnsourcedReplyGap gagal', { conversationId: params.conversationId, error })
  }
}
