import { z } from 'zod'

/**
 * Bentuk `DailySummary.payload`. Divalidasi saat DITULIS (generate.ts) dan saat DIBACA
 * (GET /api/daily-summary), supaya baris lama yang bentuknya sudah berubah tampil sebagai
 * error yang jelas, bukan halaman yang pecah di tengah.
 */

export const REVIEW_STATUSES = ['perlu_tindakan', 'selesai', 'tidak_jelas'] as const
export const CONTACT_KINDS = ['calon_tamu', 'tamu_existing', 'mitra', 'lainnya'] as const

/**
 * Satu pertanyaan pelanggan. Ringkasan lama (sebelum 19 Oktober 2026) menyimpannya sebagai
 * string polos, jadi keduanya diterima; `normalizeQuestion` menyeragamkannya untuk tampilan.
 *
 * `messageId` = pesan sumber di transkrip (model menunjuk nomor `#N`, review.ts menerjemahkannya).
 * Opsional: model boleh tidak yakin, dan ringkasan sebelum 20 Oktober 2026 tidak memilikinya --
 * item tanpa `messageId` tampil sebagai teks biasa, bukan tautan.
 */
export const reviewQuestionSchema = z.union([
  z.string(),
  z.object({ teks: z.string(), terjawab: z.boolean(), messageId: z.string().optional() }),
])
export type ReviewQuestion = z.infer<typeof reviewQuestionSchema>

/** String lama → `terjawab: null` (tidak diketahui, tampil tanpa tanda). */
export function normalizeQuestion(q: ReviewQuestion): { teks: string; terjawab: boolean | null; messageId: string | null } {
  return typeof q === 'string'
    ? { teks: q, terjawab: null, messageId: null }
    : { teks: q.teks, terjawab: q.terjawab, messageId: q.messageId ?? null }
}

/**
 * Jenis poin penting, URUTAN = prioritas (owner 2026-10-22, dari pembacaan 507 chat): isi keluhan tamu (apa yang
 * dikeluhkan, apa yang diminta, status penanganan) paling atas -- label "Ada komplain" saja tidak menjelaskan isinya --
 * lalu keputusan yang ditunggu +
 * tenggat paling menentukan langkah tim, lalu status lokasi + alternatif, data trip, jemput/antar, pembayaran,
 * kebutuhan khusus. Satu jenis = satu poin (review.ts). Ringkasan lama tanpa jenis tetap sah.
 */
export const POINT_KINDS = ['komplain', 'keputusan', 'lokasi', 'trip', 'jemput', 'bayar', 'kebutuhan'] as const
export type PointKind = (typeof POINT_KINDS)[number]
export const POINT_KIND_LABEL: Record<PointKind, string> = {
  komplain: 'Komplain',
  keputusan: 'Keputusan',
  lokasi: 'Lokasi',
  trip: 'Trip',
  jemput: 'Jemput/antar',
  bayar: 'Harga & bayar',
  kebutuhan: 'Kebutuhan',
}

/** Satu poin penting: string polos (lama, atau tanpa pesan sumber) atau objek ber-`messageId` (+ `jenis` sejak 2026-10-22). */
export const reviewPointSchema = z.union([
  z.string(),
  z.object({ teks: z.string(), messageId: z.string().optional(), jenis: z.enum(POINT_KINDS).optional() }),
])
export type ReviewPoint = z.infer<typeof reviewPointSchema>

export function normalizePoint(p: ReviewPoint): { teks: string; messageId: string | null; jenis: PointKind | null } {
  return typeof p === 'string'
    ? { teks: p, messageId: null, jenis: null }
    : { teks: p.teks, messageId: p.messageId ?? null, jenis: p.jenis ?? null }
}

/**
 * Label profil tamu: kosakata TETAP (owner 2026-10-22, dari pembacaan 507 chat). Model hanya boleh memilih dari sini
 * dan wajib menunjuk pesan bukti; label lain atau tanpa bukti dibuang (review.ts). Rombongan paling banyak satu.
 */
export const PROFILE_LABELS = [
  // Situasi yang perlu ditindak
  'komplain', 'keselamatan', 'refund_batal', 'penutupan', 'belum_pasti', 'mendesak', 'kendala_bayar',
  // Cara tamu memutuskan
  'sensitif_harga', 'banyak_revisi', 'itinerari_custom', 'open_trip',
  // Asal
  'klook_ota', 'bukan_tamu',
  // Rombongan (maks. satu)
  'solo', 'pasangan', 'grup_kecil', 'grup_besar', 'keluarga_anak',
  // Kebutuhan khusus
  'kesehatan', 'diet_alergi', 'bahasa_guide', 'cemas_keamanan',
] as const
export type ProfileLabel = (typeof PROFILE_LABELS)[number]
export const PROFILE_LABEL_TEXT: Record<ProfileLabel, string> = {
  komplain: 'Ada komplain',
  keselamatan: 'Insiden keselamatan',
  refund_batal: 'Minta refund/batal',
  penutupan: 'Terdampak penutupan',
  belum_pasti: 'Rencana belum pasti',
  mendesak: 'Mendesak',
  kendala_bayar: 'Kendala pembayaran',
  sensitif_harga: 'Sensitif harga',
  banyak_revisi: 'Banyak revisi',
  itinerari_custom: 'Minta itinerari custom',
  open_trip: 'Cari open trip',
  klook_ota: 'Lewat Klook/OTA',
  bukan_tamu: 'Bukan tamu',
  solo: 'Solo',
  pasangan: 'Pasangan',
  grup_kecil: 'Grup kecil (3-5)',
  grup_besar: 'Grup besar (6+)',
  keluarga_anak: 'Keluarga + anak',
  kesehatan: 'Kesehatan/mobilitas',
  diet_alergi: 'Diet/alergi',
  bahasa_guide: 'Bahasa guide',
  cemas_keamanan: 'Cemas keamanan',
}
export const PARTY_LABELS: readonly ProfileLabel[] = ['solo', 'pasangan', 'grup_kecil', 'grup_besar', 'keluarga_anak']

/** Satu label profil beserta pesan buktinya (wajib). */
export const reviewProfileSchema = z.object({ label: z.enum(PROFILE_LABELS), messageId: z.string() })
export type ReviewProfile = z.infer<typeof reviewProfileSchema>

/**
 * Satu janji TIM kepada pelanggan ("saya cek dulu", "invoice menyusul"). `terpenuhi` = transkrip
 * menunjukkan janji itu sudah dilakukan. String polos diterima seperti pertanyaan lama: tanpa
 * tanda, dan tidak pernah dianggap janji yang belum ditepati.
 */
export const reviewPromiseSchema = z.union([
  z.string(),
  z.object({ teks: z.string(), terpenuhi: z.boolean(), messageId: z.string().optional() }),
])
export type ReviewPromise = z.infer<typeof reviewPromiseSchema>

/** String → `terpenuhi: null` (tidak diketahui, tampil tanpa tanda). */
export function normalizePromise(p: ReviewPromise): { teks: string; terpenuhi: boolean | null; messageId: string | null } {
  return typeof p === 'string'
    ? { teks: p, terpenuhi: null, messageId: null }
    : { teks: p.teks, terpenuhi: p.terpenuhi, messageId: p.messageId ?? null }
}

/**
 * Janji yang secara eksplisit `terpenuhi: false` -- satu-satunya yang membuat item antrean
 * PROMISE (summary-items/sync.ts). Ringkasan lama tanpa `janjiTim` → kosong.
 */
export function unkeptPromises(review: Pick<ConversationReview, 'janjiTim'>): ReturnType<typeof normalizePromise>[] {
  return (review.janjiTim ?? []).map(normalizePromise).filter((p) => p.terpenuhi === false)
}

/** Hasil satu panggilan LLM untuk satu percakapan (review.ts). */
export const conversationReviewSchema = z.object({
  status: z.enum(REVIEW_STATUSES),
  alasan: z.string(),
  jenisKontak: z.enum(CONTACT_KINDS),
  topik: z.string(),
  pertanyaan: z.array(reviewQuestionSchema),
  poinPenting: z.array(reviewPointSchema),
  /** Opsional: ringkasan sebelum 19 Oktober 2026 tidak memilikinya, dan dibaca sebagai `[]`. */
  janjiTim: z.array(reviewPromiseSchema).default([]),
  /** Opsional: ringkasan sebelum 22 Oktober 2026 tidak memilikinya, dan dibaca sebagai `[]`. */
  profil: z.array(reviewProfileSchema).default([]),
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
  /**
   * Pesan PERTAMA rangkaian pesan pelanggan sesudah balasan terakhir kita: anchor item REPLY
   * (sejak kapan menunggu). Opsional karena payload sebelum 19 Oktober 2026 tidak memilikinya.
   */
  firstMessageAt: z.string().optional(),
  firstMessageId: z.string().optional(),
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
  filteredOut: z.object({
    unreplied: z.number(),
    dormant: z.number(),
    /**
     * Percakapan "belum dibalas" yang disaring karena review menilainya "selesai". Bahan penutupan
     * `JUDGED_DONE` di `syncSummaryItems`; opsional karena payload lama tidak memuatnya.
     */
    unrepliedIds: z.array(z.string()).optional(),
  }),
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
