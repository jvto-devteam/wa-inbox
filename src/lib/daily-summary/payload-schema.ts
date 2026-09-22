import { z } from 'zod'

/**
 * Bentuk `DailySummary.payload`. Divalidasi saat DITULIS (generate.ts) dan saat DIBACA
 * (GET /api/daily-summary), supaya baris lama yang bentuknya sudah berubah tampil sebagai
 * error yang jelas, bukan halaman yang pecah di tengah.
 */

export const REVIEW_STATUSES = ['perlu_tindakan', 'selesai', 'tidak_jelas'] as const
export const CONTACT_KINDS = ['calon_tamu', 'tamu_existing', 'mitra', 'lainnya'] as const

/** Hasil satu panggilan LLM untuk satu percakapan (review.ts). */
export const conversationReviewSchema = z.object({
  status: z.enum(REVIEW_STATUSES),
  alasan: z.string(),
  jenisKontak: z.enum(CONTACT_KINDS),
  topik: z.string(),
  pertanyaan: z.array(z.string()),
  poinPenting: z.array(z.string()),
  statusAgen: z.string(),
  langkahBerikut: z.string(),
})
export type ConversationReview = z.infer<typeof conversationReviewSchema>

const conversationRef = {
  conversationId: z.string(),
  contactName: z.string().nullable(),
  pipelineStage: z.string(),
}

/** `review: null` = LLM gagal atau timeout; halaman menampilkannya sebagai "belum dicek". */
const reviewField = conversationReviewSchema.nullable()

/**
 * Id pesan terakhir, untuk tombol yang membuka Inbox dengan pesan itu tersorot. Opsional karena
 * baris yang dibuat sebelum kolom ini ada (21 September 2026) tidak memilikinya -- tombolnya
 * tetap membuka percakapan, hanya tanpa sorotan.
 */
const lastMessageId = z.string().optional()

const unrepliedItemSchema = z.object({
  ...conversationRef,
  lastMessageAt: z.string(),
  lastMessageId,
  waitingMs: z.number(),
  snippet: z.string(),
  review: reviewField,
})

const dormantItemSchema = z.object({
  ...conversationRef,
  lastMessageAt: z.string(),
  lastMessageId,
  silentMs: z.number(),
  snippet: z.string(),
  review: reviewField,
})

/** Bagian `Conversation.tripBrief` yang ditampilkan untuk lead baru (lihat TripBrief, src/lib/bot/types.ts). */
export const tripBriefSummarySchema = z.object({
  destination: z.string().optional(),
  dateRange: z.string().optional(),
  pax: z.number().optional(),
  origin: z.string().optional(),
  dayCount: z.number().optional(),
  finishCity: z.string().optional(),
})
export type TripBriefSummary = z.infer<typeof tripBriefSummarySchema>

const newLeadItemSchema = z.object({
  ...conversationRef,
  createdAt: z.string(),
  tripBrief: tripBriefSummarySchema.nullable(),
  review: reviewField,
})

const handoffItemSchema = z.object({
  runId: z.string(),
  conversationId: z.string(),
  contactName: z.string().nullable(),
  at: z.string(),
  inboundText: z.string(),
  /** Pesan terakhir percakapan itu, saat laporan dibuat, masih dari pelanggan. */
  stillWaiting: z.boolean(),
})

const countEntry = z.object({ key: z.string(), count: z.number() })

const gapItemSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  messageId: z.string().nullable(),
  contactName: z.string().nullable(),
  topic: z.string(),
  reason: z.string(),
  messageText: z.string(),
})

const conversationSummarySchema = z.object({
  ...conversationRef,
  inbound: z.number(),
  outbound: z.number(),
  review: reviewField,
})

export const dailySummaryPayloadSchema = z.object({
  version: z.literal(1),
  date: z.string(),
  windowStart: z.string(),
  windowEnd: z.string(),
  generatedAt: z.string(),
  /** Nomor Indonesia disaring (Settings.skipBotForIndonesianNumbers saat dibuat). Opsional: baris lama tidak punya. */
  excludedIndonesian: z.boolean().optional(),
  thresholds: z.object({ unrepliedMinMs: z.number(), dormantMinMs: z.number(), lookbackMs: z.number() }),
  counts: z.object({
    activeConversations: z.number(),
    inbound: z.number(),
    outbound: z.number(),
    newConversations: z.number(),
    reviewed: z.number(),
    reviewFailed: z.number(),
  }),
  /** Kandidat yang dinilai LLM sudah `selesai` -- tidak tampil, tapi dihitung agar bisa diaudit. */
  filteredOut: z.object({ unreplied: z.number(), dormant: z.number() }),
  unreplied: z.array(unrepliedItemSchema),
  dormant: z.array(dormantItemSchema),
  newLeads: z.array(newLeadItemSchema),
  handoffs: z.array(handoffItemSchema),
  gaps: z.object({
    newCount: z.number(),
    openTotal: z.number(),
    byReason: z.array(countEntry),
    byTopic: z.array(countEntry),
    items: z.array(gapItemSchema),
  }),
  conversations: z.array(conversationSummarySchema),
})

export type DailySummaryPayload = z.infer<typeof dailySummaryPayloadSchema>
export type UnrepliedItem = DailySummaryPayload['unreplied'][number]
export type DormantItem = DailySummaryPayload['dormant'][number]
export type NewLeadItem = DailySummaryPayload['newLeads'][number]
export type HandoffItem = DailySummaryPayload['handoffs'][number]
export type ConversationSummaryItem = DailySummaryPayload['conversations'][number]
