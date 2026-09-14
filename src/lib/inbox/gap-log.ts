import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { DEFERRED_KNOWLEDGE_REPLY_REASON, knowledgeGapsForDecision, UNSOURCED_REPLY_REASON } from './gap-signal'
import type { BotDecision } from '@/lib/bot/types'

/** Alasan gap untuk balasan FAQ: tidak bersumber, atau ada sub-pertanyaan yang ditunda. */
export { DEFERRED_KNOWLEDGE_REPLY_REASON, UNSOURCED_REPLY_REASON }

/**
 * Mencatat satu balasan yang perlu knowledge tambahan, lalu memberi tahu lonceng.
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
  const gaps = knowledgeGapsForDecision(decision, params.inboundText)
  if (gaps.length === 0 || decision.mode !== 'faq') return

  // Satu baris per gap, bukan satu baris per balasan: balasan yang menunda dua pertanyaan
  // pelanggan memberi operator DUA pekerjaan, dan satu baris gabungan membuat yang kedua tidak
  // pernah muncul di daftar perbaikan (dilaporkan 2026-09-14).
  //
  // Ditulis satu per satu di dalam try-nya masing-masing, bukan lewat createMany: satu baris
  // yang gagal tidak boleh ikut menelan baris lain, dan tidak satu pun boleh menggagalkan
  // giliran bot yang balasannya sudah terkirim.
  let written = 0
  for (const gap of gaps) {
    try {
      await prisma.knowledgeGapLog.create({
        data: {
          conversationId: params.conversationId,
          topic: decision.topic ?? decision.sourceTopic,
          reason: gap.reason,
          messageText: params.inboundText,
          missingQuestion: gap.missingQuestion,
          answerSnippet: gap.answerSnippet,
          answerParagraph: gap.answerParagraph,
          messageId: params.messageId ?? null,
          runId: params.runId,
        },
      })
      written += 1
    } catch (error) {
      console.error('recordUnsourcedReplyGap gagal', { conversationId: params.conversationId, error })
    }
  }

  // Sekali saja, berapa pun barisnya: lonceng memuat ulang daftarnya sendiri dari API, jadi satu
  // sinyal sudah cukup untuk memperlihatkan semuanya.
  if (written > 0) broadcast({ type: 'knowledge.gap', conversationId: params.conversationId })
}
