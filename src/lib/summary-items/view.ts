import { conversationReviewSchema, type ConversationReview } from '@/lib/daily-summary/payload-schema'

/** Bentuk item antrean yang dikirim ke halaman /summary. */
export type SummaryItemView = {
  id: string
  conversationId: string
  contactName: string | null
  pipelineStage: string
  kind: 'REPLY' | 'FOLLOW_UP'
  state: 'OPEN' | 'SCHEDULED'
  anchorAt: string
  anchorMessageId: string | null
  snippet: string
  review: ConversationReview | null
  handoff: boolean
  newLead: boolean
  openedOn: string
  dueAt: string | null
}

export type SummaryItemRow = {
  id: string
  conversationId: string
  kind: string
  state: string
  anchorAt: Date
  anchorMessageId: string | null
  snippet: string
  review: unknown
  handoff: boolean
  newLead: boolean
  openedOn: string
  dueAt: Date | null
  conversation: { pipelineStage: string; contact: { name: string | null } | null }
}

export function toSummaryItemView(row: SummaryItemRow): SummaryItemView {
  // Review dari LLM bisa usang/rusak; gagal parse = tampil tanpa review, bukan pecah.
  const parsed = conversationReviewSchema.safeParse(row.review)
  return {
    id: row.id,
    conversationId: row.conversationId,
    contactName: row.conversation.contact?.name ?? null,
    pipelineStage: row.conversation.pipelineStage,
    kind: row.kind as SummaryItemView['kind'],
    state: row.state as SummaryItemView['state'],
    anchorAt: row.anchorAt.toISOString(),
    anchorMessageId: row.anchorMessageId,
    snippet: row.snippet,
    review: parsed.success ? parsed.data : null,
    handoff: row.handoff,
    newLead: row.newLead,
    openedOn: row.openedOn,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
  }
}

export const SUMMARY_ITEM_INCLUDE = {
  conversation: { select: { pipelineStage: true, contact: { select: { name: true } } } },
} as const
