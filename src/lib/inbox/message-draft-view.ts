// Tipe murni untuk klien (Task 5, halaman Inbox). Tidak ada impor selain `import type`: file
// ini dipakai LANGSUNG dari komponen client, dan sebuah impor runtime di sini akan menyeret
// Prisma/server-only code ke dalam bundle browser.

export type DraftKnowledgeGap = { reason: string; missingQuestion: string | null }

export type MessageDraftView = {
  id: string
  sourceMessageId: string
  text: string | null
  generatedText: string | null
  mode: 'faq' | 'booking_context' | 'clarify' | 'handoff'
  handoffReason: string | null
  /** BotDecision yang sudah disanitasi, untuk BotTracePopover. */
  decision: unknown
  knowledgeGaps: DraftKnowledgeGap[]
  generatedAt: string
  generatedByName: string | null
  editedAt: string | null
  editedByName: string | null
  sentAt: string | null
  sentByName: string | null
  sentMessageId: string | null
}
