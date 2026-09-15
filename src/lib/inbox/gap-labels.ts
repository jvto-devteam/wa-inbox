// Label knowledge-gap yang dibagi antara MessageBubble (bubble balasan bot), FixAnswerPanel,
// dan MessageDraftCard (Task 5). Dipindah ke sini supaya ketiganya memakai kalimat yang SAMA
// PERSIS -- sebelumnya MessageBubble dan FixAnswerPanel masing-masing menyimpan salinannya
// sendiri, dan MessageDraftCard butuh salinan ketiga tanpa file ini akan jadi salinan keempat.
// Tanpa dependensi lain: aman diimpor dari komponen client mana pun.

export const KNOWLEDGE_GAP_LABEL: Record<string, string> = {
  no_facts_resolved: 'Tidak ada fakta knowledge untuk pertanyaan ini',
  verification_failed: 'Jawaban gagal diverifikasi terhadap knowledge',
  reply_unsourced: 'Ada jawaban yang tidak punya knowledge',
  reply_deferred_knowledge: 'Ada bagian jawaban yang belum punya knowledge',
}

export function knowledgeGapLabel(reason: string): string {
  return KNOWLEDGE_GAP_LABEL[reason] ?? 'Ada gap knowledge pada jawaban ini'
}
