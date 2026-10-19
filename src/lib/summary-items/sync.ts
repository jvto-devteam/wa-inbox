import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  DORMANT_STAGES,
  LOOKBACK_MS,
  RETENTION_MS,
  TRANSCRIPT_MAX_MESSAGES,
  UNREPLIED_MIN_MS,
} from '@/lib/daily-summary/config'
import { messageSnippet, type TranscriptMessage } from '@/lib/daily-summary/collect'
import { isIndonesianNumber } from '@/lib/phone'
import {
  conversationReviewSchema,
  normalizePromise,
  unkeptPromises,
  type ConversationReview,
  type DailySummaryPayload,
} from '@/lib/daily-summary/payload-schema'
import { jakartaDayKey, jakartaDayRange } from '@/lib/daily-summary/time'
import { isNoiseMessage } from './noise'
import type { SummaryItemKind } from './status'

/**
 * Antrean tindakan Summary Harian: menjaga tabel `SummaryItem` tetap searah dengan payload
 * ringkasan (sync) dan dengan kenyataan di tabel Message/Reminder (reconcile).
 *
 * Kenapa dua langkah terpisah: payload hanya lahir sekali sehari (00:00 WIB), sedangkan item
 * harus tertutup begitu admin membalas. `syncSummaryItems` memasukkan kandidat dari payload;
 * `reconcileSummaryItems` murni membaca fakta (pesan keluar, pengingat) dan boleh dipanggil
 * kapan saja: tiap tick `POST /api/summary-items/tick` (crontab VPS 5 menit) dan saat daftar
 * dibaca. `/api/outbound-jobs/process` juga memanggilnya, tetapi endpoint itu TIDAK punya cron
 * di produksi -- jangan andalkan.
 *
 * Antrean live (`createLiveReplyItems`, tick yang sama): pesan pelanggan yang belum dibalas
 * ≥ UNREPLIED_MIN_MS (diukur dari pesan PERTAMA yang belum dibalas) langsung jadi REPLY tanpa
 * menunggu 00:00, tanpa LLM. Penutup murni
 * ("ok", "thanks", 👍) disaring `isNoiseMessage`; yang lolos ditutup `JUDGED_DONE` oleh sync
 * malam bila review terbaru menilainya "selesai" (`filteredOut.unrepliedIds` di payload).
 *
 * Jalan keluar otomatis (reconcile): REPLY tertutup oleh pesan keluar sesudah anchor; FOLLOW_UP
 * jadi REPLY bila pelanggan chat lagi, atau tertutup (REPLIED) bila admin sudah mengirim pesan
 * sesudah anchor, atau (STAGE_ADVANCED) bila tahap pipeline sudah keluar dari DORMANT_STAGES.
 * Pengingat dipantau selama `reminderId` terisi, baik SCHEDULED maupun OPEN (sudah jatuh tempo).
 *
 * PROMISE (janji tim yang belum ditepati, dari `janjiTim` di review) hanya lahir untuk percakapan
 * yang BUKAN kandidat REPLY/FOLLOW_UP hari itu -- keduanya selalu menang. Ia tertutup
 * (PROMISE_KEPT) hanya oleh review terbaru yang menandai setiap janji yang dilacaknya
 * `terpenuhi:true` (sync malam atau tombol "Perbarui sekarang"), dan berubah jadi REPLY bila ada
 * pesan pelanggan yang belum dibalas. Pesan keluar TIDAK menutupnya: membalas belum tentu menepati.
 *
 * Semua fungsi di sini tidak pernah melempar: antrean adalah pelengkap ringkasan, dan
 * kegagalannya tidak boleh mengubah status ringkasan atau menahan antrean outbound.
 */

export { SUMMARY_ITEM_KINDS } from './status'
export const SUMMARY_ITEM_STATES = ['OPEN', 'SCHEDULED', 'DONE', 'DROPPED'] as const

type Kind = SummaryItemKind

type Candidate = {
  conversationId: string
  kind: Kind
  anchorAt: Date
  anchorMessageId: string | null
  /** Anchor dari pesan pemicu yang diketahui; false hanya untuk PROMISE dengan anchor cadangan. */
  anchorKnown: boolean
  /**
   * PROMISE: janji terbuka yang pesannya benar ada di percakapan, urut review (kosong untuk
   * REPLY/FOLLOW_UP). Bahan memilih tautan + snippet di `upsertCandidate`.
   */
  promises: PromiseLink[]
  snippet: string
  review: ConversationReview | null
  handoff: boolean
  newLead: boolean
}

type PromiseLink = { messageId: string; teks: string; createdAt: Date }

const reviewValue = (review: ConversationReview | null) =>
  review === null ? Prisma.DbNull : (review as unknown as Prisma.InputJsonValue)

function toCandidates(payload: DailySummaryPayload): Candidate[] {
  const handoffIds = new Set(payload.handoffs.map((h) => h.conversationId))
  const newLeadIds = new Set(payload.newLeads.map((l) => l.conversationId))
  const base = (
    item: { conversationId: string; lastMessageAt: string; lastMessageId?: string; snippet: string; review: ConversationReview | null },
    kind: Kind
  ): Candidate => ({
    conversationId: item.conversationId,
    kind,
    anchorAt: new Date(item.lastMessageAt),
    anchorMessageId: item.lastMessageId ?? null,
    anchorKnown: true,
    promises: [],
    snippet: item.snippet,
    review: item.review,
    // Serah-terima hanya bermakna untuk yang menunggu balasan.
    handoff: kind === 'REPLY' && handoffIds.has(item.conversationId),
    newLead: newLeadIds.has(item.conversationId),
  })
  return [...payload.unreplied.map((i) => base(i, 'REPLY')), ...payload.dormant.map((i) => base(i, 'FOLLOW_UP'))]
}

/**
 * Review per percakapan dari bagian mana pun payload (review yang sama ditulis ke setiap bagian
 * tempat percakapan itu muncul); yang diambil review non-null pertama.
 */
function reviewsByConversation(payload: DailySummaryPayload): Map<string, ConversationReview> {
  const reviews = new Map<string, ConversationReview>()
  for (const list of [payload.unreplied, payload.dormant, payload.newLeads, payload.conversations]) {
    for (const entry of list) {
      if (entry.review && !reviews.has(entry.conversationId)) reviews.set(entry.conversationId, entry.review)
    }
  }
  return reviews
}

/**
 * Kandidat PROMISE dari janji terbuka yang `messageId`-nya benar ada di percakapan ini (`anchorKnown`):
 * - anchor = waktu pesan janji terbuka TERBARU (max createdAt). Anchor inilah yang dibandingkan saat
 *   membuka ulang, jadi hasilnya tidak bergantung pada urutan janji di keluaran LLM: janji B yang
 *   lebih baru dari baris yang dilepas tetap membukanya walau janji lama A disebut lebih dulu.
 * - tautan + snippet bawaan = janji terbuka PERTAMA (urut review); `upsertCandidate` memilih yang
 *   lain untuk baris yang sudah ada.
 * Tanpa itu anchor cadangan = pesan OUTBOUND terakhir ≤ `asOf` (janji pasti diucapkan tim, jadi
 * tidak lebih baru dari pesan keluar terakhir), atau `asOf` bila belum ada pesan keluar sama sekali.
 * Anchor cadangan tidak pernah dipakai untuk memindahkan atau membuka ulang baris yang sudah ada --
 * lihat `upsertCandidate` dan `shouldReopen`.
 */
async function promiseCandidate(
  conversationId: string,
  review: ConversationReview,
  asOf: Date,
  newLead: boolean
): Promise<Candidate | null> {
  const unkept = unkeptPromises(review)
  if (unkept.length === 0) return null
  const ids = [...new Set(unkept.flatMap((p) => (p.messageId ? [p.messageId] : [])))]
  const found = ids.length
    ? await prisma.message.findMany({ where: { id: { in: ids }, conversationId }, select: { id: true, createdAt: true } })
    : []
  const createdAt = new Map(found.map((m) => [m.id, m.createdAt]))
  const promises: PromiseLink[] = []
  for (const p of unkept) {
    const at = p.messageId ? createdAt.get(p.messageId) : undefined
    if (p.messageId && at && !promises.some((l) => l.messageId === p.messageId)) promises.push({ messageId: p.messageId, teks: p.teks, createdAt: at })
  }
  const first = promises[0] ?? null
  const newest = newestPromise(promises)
  const fallback = newest
    ? null
    : await prisma.message.findFirst({
        where: { conversationId, direction: 'OUTBOUND', createdAt: { lte: asOf } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      })
  return {
    conversationId,
    kind: 'PROMISE',
    anchorAt: newest?.createdAt ?? fallback?.createdAt ?? asOf,
    anchorMessageId: first?.messageId ?? null,
    anchorKnown: newest !== null,
    promises,
    snippet: (first ?? unkept[0]).teks,
    review,
    handoff: false,
    newLead,
  }
}

/** Janji dengan pesan paling baru; seri → yang lebih dulu di review. */
function newestPromise(promises: PromiseLink[]): PromiseLink | null {
  return promises.reduce<PromiseLink | null>((best, p) => (best === null || p.createdAt > best.createdAt ? p : best), null)
}

/**
 * Sampai kapan review sebuah kandidat melihat percakapan (`asOf`, juga closedAt PROMISE_KEPT) dan
 * apakah review itu yang TERBARU untuk percakapannya. "Terbaru" = waktu review ≥
 * `Conversation.chatReviewAt` (ditulis `saveChatReview` dengan waktu yang sama, sebelum sync dan
 * sebelum Perbarui memanggil `applyReviewToItem`). "Buat ulang" tanggal lama tidak lolos, jadi tidak
 * bisa membuka ulang atau menimpa item yang sudah dinilai review lebih baru. Dicek malas, sekali.
 */
type ReviewClock = { asOf: Date; date: string; isLatest: () => Promise<boolean> }

function reviewClock(conversationId: string, asOf: Date, reviewedAt: Date, date: string): ReviewClock {
  let latest: Promise<boolean> | null = null
  return {
    asOf,
    date,
    isLatest: () =>
      (latest ??= (async () => {
        const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { chatReviewAt: true } })
        return !conv?.chatReviewAt || reviewedAt >= conv.chatReviewAt
      })()),
  }
}

type ClosedRow = { state: string; closedReason: string | null; anchorAt: Date; closedAt: Date | null }

const closedByReply = (row: ClosedRow) => row.state === 'DONE' && row.closedReason === 'REPLIED'

/**
 * Kartu REPLY yang dilepas (DROPPED) atau ditutup lewat pengingat selesai (REMINDER_DONE) bisa
 * menampilkan pesan lama, sebab anchor-nya tidak disegarkan selama terbawa. Pesan pelanggan yang
 * masuk sebelum penutupan tapi sesudah pesan yang tampil di kartu juga harus membukanya lagi,
 * jadi pembandingnya anchor baris, bukan closedAt. Selain itu berlaku aturan closedAt.
 *
 * PROMISE (janji yang masih terbuka):
 * - DONE/REPLIED dibuka lagi berapa pun anchor-nya -- membalas tidak menepati janji -- asal review
 *   ini sudah melihat balasannya dan merupakan review terbaru percakapan itu.
 * - Tanpa pesan janji yang diketahui (`anchorKnown` false) tidak membuka baris lain apa pun:
 *   anchor cadangan bergeser, dan keputusan operator (Lepas, pengingat selesai) atau penilaian
 *   "ditepati" tidak boleh terbalik hanya karena LLM lupa menyebut nomor pesannya.
 * - DROPPED/REMINDER_DONE: hanya janji lebih baru dari anchor baris; PROMISE_KEPT dan selebihnya:
 *   hanya janji sesudah closedAt. Pembandingnya `c.anchorAt` = janji terbuka TERBARU, bukan yang
 *   pertama disebut, supaya janji baru tidak tertutup janji lama yang kebetulan disebut lebih dulu.
 */
async function shouldReopen(row: ClosedRow, c: Candidate, clock: ReviewClock): Promise<boolean> {
  const staleCardClose = row.state === 'DROPPED' || (row.state === 'DONE' && row.closedReason === 'REMINDER_DONE')
  if (c.kind === 'PROMISE') {
    if (closedByReply(row)) return (row.closedAt === null || row.closedAt <= clock.asOf) && (await clock.isLatest())
    if (!c.anchorKnown) return false
  }
  if ((c.kind === 'REPLY' || c.kind === 'PROMISE') && staleCardClose) return c.anchorAt > row.anchorAt
  return row.closedAt !== null && c.anchorAt > row.closedAt
}

const promiseLink = (p: PromiseLink) => ({ anchorMessageId: p.messageId, snippet: p.teks })

type UpsertOutcome = 'created' | 'updated' | 'reopened' | 'skipped'

/**
 * Satu kandidat ke antrean: buat, perbarui yang masih terbuka, atau buka lagi yang tertutup.
 * Dipakai sync malam dan `applyReviewToItem` (Perbarui) supaya aturannya hanya ada di sini.
 */
async function upsertCandidate(c: Candidate, row: ItemRow | null, clock: ReviewClock): Promise<UpsertOutcome> {
  const { date } = clock
  const fields = {
    kind: c.kind,
    anchorAt: c.anchorAt,
    anchorMessageId: c.anchorMessageId,
    snippet: c.snippet,
    review: reviewValue(c.review),
    handoff: c.handoff,
    newLead: c.newLead,
  }
  if (!row) {
    // "Buat ulang" tanggal lama atau job malam yang kalah balapan dengan Perbarui tidak boleh
    // melahirkan janji dari review yang sudah usang.
    if (c.kind === 'PROMISE' && !(await clock.isLatest())) return 'skipped'
    await prisma.summaryItem.create({
      data: { conversationId: c.conversationId, ...fields, state: 'OPEN', openedOn: date, lastSeenOn: date },
    })
    return 'created'
  }
  if (row.state === 'OPEN' || row.state === 'SCHEDULED') {
    // Membuat ulang ringkasan tanggal lama tidak boleh memundurkan item yang sudah
    // diperbarui oleh ringkasan yang lebih baru.
    if (date < row.lastSeenOn) return 'skipped'
    // REPLY/FOLLOW_UP yang masih terbuka menang atas janji: jangan menurunkannya jadi PROMISE.
    if (c.kind === 'PROMISE' && row.kind !== 'PROMISE') return 'skipped'
    if (c.kind === 'PROMISE' && !(await clock.isLatest())) return 'skipped'
    // Pesan janji tidak diketahui malam ini: anchor dan tautan baris tetap (anchor cadangan bergeser).
    // Diketahui: tautan tetap selama janjinya masih terbuka, supaya kartu tidak berpindah-pindah
    // janji antar-malam hanya karena urutan keluaran LLM berubah. Anchor tidak pernah mundur: bila
    // janji terbaru B ditepati lalu operator Lepas, B yang dibalik LLM jadi "belum" lagi tidak boleh
    // terlihat "lebih baru dari anchor" dan membuka item yang sudah dilepas.
    const data =
      c.kind !== 'PROMISE'
        ? fields
        : !c.anchorKnown
          ? { ...fields, anchorAt: row.anchorAt, anchorMessageId: row.anchorMessageId }
          : {
              ...fields,
              anchorAt: c.anchorAt > row.anchorAt ? c.anchorAt : row.anchorAt,
              ...promiseLink(c.promises.find((p) => p.messageId === row.anchorMessageId) ?? c.promises[0]),
            }
    await prisma.summaryItem.update({
      where: { id: row.id },
      // "YYYY-MM-DD" terurut leksikografis sama dengan urutan tanggal.
      data: { ...data, lastSeenOn: row.lastSeenOn > date ? row.lastSeenOn : date },
    })
    return 'updated'
  }
  if (!(await shouldReopen(row, c, clock))) return 'skipped'
  // Pesan baru sesudah ditutup: item lahir kembali. Pesan yang sama tidak membukanya lagi,
  // jadi keputusan operator tetap berlaku. PROMISE yang dibuka karena janji lebih baru menautkan
  // janji pemicunya (yang terbaru), bukan janji lama yang mungkin justru baru dilepas operator.
  const reopenedBy = c.kind === 'PROMISE' && !closedByReply(row) ? newestPromise(c.promises) : null
  await prisma.summaryItem.update({
    where: { id: row.id },
    data: {
      ...fields,
      ...(reopenedBy ? promiseLink(reopenedBy) : {}),
      state: 'OPEN',
      openedOn: date,
      lastSeenOn: date,
      closedReason: null,
      note: null,
      closedById: null,
      closedAt: null,
      reminderId: null,
      dueAt: null,
    },
  })
  return 'reopened'
}

/** Masukkan kandidat dari payload ringkasan `date` ke antrean. */
export async function syncSummaryItems(
  date: string,
  payload: DailySummaryPayload,
  now: Date = new Date()
): Promise<{ created: number; updated: number; reopened: number; closed: number }> {
  const result = { created: 0, updated: 0, reopened: 0, closed: 0 }
  try {
    const candidates = toCandidates(payload)
    const taken = new Set(candidates.map((c) => c.conversationId))
    const newLeadIds = new Set(payload.newLeads.map((l) => l.conversationId))
    // Waktu review hari itu = akhir hari (sama dengan yang disimpan generate lewat saveChatReview);
    // `asOf` dijepit ke `now` untuk "Buat ulang" hari ini, supaya closedAt tidak di masa depan.
    const reviewedAt = jakartaDayRange(date).end
    const asOf = new Date(Math.min(reviewedAt.getTime(), now.getTime()))
    const clockFor = (conversationId: string) => reviewClock(conversationId, asOf, reviewedAt, date)
    // Review tanpa janji terbuka untuk percakapan yang bukan kandidat REPLY/FOLLOW_UP: bahan
    // penutupan PROMISE_KEPT di bawah.
    const kept: Array<[string, ConversationReview]> = []
    for (const [conversationId, review] of reviewsByConversation(payload)) {
      if (taken.has(conversationId)) continue
      const c = await promiseCandidate(conversationId, review, asOf, newLeadIds.has(conversationId))
      if (c) candidates.push(c)
      else kept.push([conversationId, review])
    }

    for (const c of candidates) {
      const row = await prisma.summaryItem.findUnique({ where: { conversationId: c.conversationId } })
      const outcome = await upsertCandidate(c, row, clockFor(c.conversationId))
      if (outcome !== 'skipped') result[outcome]++
    }

    result.closed += await closeJudgedDone(payload, new Set(candidates.map((c) => c.conversationId)), date, clockFor)

    // Satu kueri untuk semua PROMISE terbuka yang review-nya hari ini tanpa janji terbuka.
    const keptReviews = new Map(kept)
    const promiseRows =
      keptReviews.size > 0
        ? await prisma.summaryItem.findMany({
            where: { conversationId: { in: [...keptReviews.keys()] }, kind: 'PROMISE', state: { in: ['OPEN', 'SCHEDULED'] } },
          })
        : []
    for (const row of promiseRows) {
      const review = keptReviews.get(row.conversationId)
      if (!review || date < row.lastSeenOn) continue
      if ((await closeKeptPromise(row, review, clockFor(row.conversationId))) === 'closed') result.closed++
    }
    return result
  } catch (error) {
    console.error('syncSummaryItems gagal', { date, error })
    return { created: 0, updated: 0, reopened: 0, closed: 0 }
  }
}

/**
 * REPLY OPEN yang percakapannya dinilai "selesai" oleh review malam ini -- karena itu tidak masuk
 * `payload.unreplied` (`filteredOut.unrepliedIds`, generate.ts) -- ditutup `JUDGED_DONE`. Tanpa ini
 * kartu live untuk penutup yang lolos `isNoiseMessage` ("Great, see you then!") tidak pernah
 * tertutup: tidak ada pesan keluar yang menyusul.
 *
 * Syarat, semuanya wajib: review melihat anchor (anchorAt ≤ asOf), ringkasan ini tidak lebih tua
 * dari `lastSeenOn`, review ini yang terbaru (`isLatest`, pola `chatReviewAt` yang sama dengan
 * PROMISE), dan percakapannya bukan kandidat lain malam ini. Item dengan pengingat (jatuh tempo)
 * tidak disentuh: pengingat itu keputusan operator, bukan penilaian LLM. Satu kueri untuk semua.
 */
async function closeJudgedDone(
  payload: DailySummaryPayload,
  candidateIds: Set<string>,
  date: string,
  clockFor: (conversationId: string) => ReviewClock
): Promise<number> {
  const ids = [...new Set(payload.filteredOut?.unrepliedIds ?? [])].filter((id) => !candidateIds.has(id))
  if (ids.length === 0) return 0
  const rows = await prisma.summaryItem.findMany({
    where: { conversationId: { in: ids }, kind: 'REPLY', state: 'OPEN', reminderId: null },
  })
  let closed = 0
  for (const row of rows) {
    const clock = clockFor(row.conversationId)
    if (date < row.lastSeenOn || row.anchorAt > clock.asOf) continue
    if (!(await clock.isLatest())) continue
    await write(row.id, { state: 'DONE', closedReason: 'JUDGED_DONE', closedAt: clock.asOf, lastSeenOn: date }, null)
    closed++
  }
  return closed
}

export type ApplyReviewOutcome = 'closed' | 'updated' | 'created' | 'reopened' | 'unchanged'

/**
 * Menerapkan review terbaru satu percakapan (tombol "Perbarui sekarang") ke item "Janji tim"-nya,
 * dengan aturan yang sama dengan sync malam:
 * - REPLY/FOLLOW_UP OPEN/SCHEDULED: tidak disentuh -- keduanya menang atas janji.
 * - Review memuat janji terbuka: PROMISE dibuat, disegarkan, atau dibuka lagi (`upsertCandidate`).
 * - Tanpa janji terbuka: PROMISE terbuka ditutup PROMISE_KEPT hanya bila setiap janji yang
 *   dilacaknya kini eksplisit `terpenuhi:true` (`closeKeptPromise`).
 *
 * `asOf` = waktu review itu (juga waktu `saveChatReview`). Tidak pernah melempar.
 */
export async function applyReviewToItem(conversationId: string, review: ConversationReview, asOf: Date): Promise<ApplyReviewOutcome> {
  try {
    const row = await prisma.summaryItem.findUnique({ where: { conversationId } })
    const open = row !== null && (row.state === 'OPEN' || row.state === 'SCHEDULED')
    if (open && row.kind !== 'PROMISE') return 'unchanged'
    const clock = reviewClock(conversationId, asOf, asOf, jakartaDayKey(asOf))
    const c = await promiseCandidate(conversationId, review, asOf, row?.newLead ?? false)
    if (c) {
      const outcome = await upsertCandidate(c, row, clock)
      return outcome === 'skipped' ? 'unchanged' : outcome
    }
    return open ? await closeKeptPromise(row, review, clock) : 'unchanged'
  } catch (error) {
    console.error('applyReviewToItem gagal', { conversationId, error: error instanceof Error ? error.message : 'unknown' })
    return 'unchanged'
  }
}

const promiseText = (teks: string) => teks.trim().toLowerCase().replace(/\s+/g, ' ')

/** Janji yang sama: `messageId` sama bila keduanya punya, selain itu teks yang sama (abaikan besar-kecil/spasi). */
function samePromise(a: { teks: string; messageId: string | null }, b: { teks: string; messageId: string | null }): boolean {
  if (a.messageId && b.messageId) return a.messageId === b.messageId
  return promiseText(a.teks) === promiseText(b.teks)
}

type PromiseRow = {
  id: string
  conversationId: string
  kind: string
  state: string
  anchorAt: Date
  lastSeenOn: string
  reminderId: string | null
  review: unknown
}

/**
 * Review tanpa janji terbuka → PROMISE_KEPT, HANYA bila setiap janji terbuka yang dilacak item
 * (review di baris) kini disebut eksplisit `terpenuhi:true`. Review yang tidak lagi menyebut
 * janjinya -- LLM lupa, atau pesannya sudah keluar dari jendela transkrip -- membiarkan item OPEN
 * dan tidak menimpa review-nya; operator bisa melepasnya.
 */
async function closeKeptPromise(row: PromiseRow, review: ConversationReview, clock: ReviewClock): Promise<ApplyReviewOutcome> {
  if (row.kind !== 'PROMISE' || (row.state !== 'OPEN' && row.state !== 'SCHEDULED')) return 'unchanged'
  if (clock.asOf < row.anchorAt) return 'unchanged'
  const stored = conversationReviewSchema.safeParse(row.review)
  const tracked = stored.success ? unkeptPromises(stored.data) : []
  if (tracked.length === 0) return 'unchanged'
  const mentioned = (review.janjiTim ?? []).map(normalizePromise)
  if (!tracked.every((t) => mentioned.some((m) => m.terpenuhi === true && samePromise(t, m)))) return 'unchanged'
  if (!(await clock.isLatest())) return 'unchanged'
  const today = clock.date
  await write(
    row.id,
    {
      state: 'DONE',
      closedReason: 'PROMISE_KEPT',
      closedAt: clock.asOf,
      review: reviewValue(review),
      lastSeenOn: row.lastSeenOn > today ? row.lastSeenOn : today,
    },
    row.reminderId
  )
  return 'closed'
}

const messageSelect = { id: true, direction: true, sentBy: true, type: true, content: true, createdAt: true } as const

/**
 * Menyelaraskan item OPEN/SCHEDULED dengan kenyataan: dibalas, pelanggan bicara lagi, atau
 * pengingat berubah. Idempoten.
 */
export async function reconcileSummaryItems(
  now: Date = new Date()
): Promise<{ closed: number; converted: number; reopened: number }> {
  const result = { closed: 0, converted: 0, reopened: 0 }
  try {
    const items = await prisma.summaryItem.findMany({ where: { state: { in: ['OPEN', 'SCHEDULED'] } } })
    for (const item of items) {
      try {
        await reconcileOne(item, now, result)
      } catch (error) {
        console.error('reconcileSummaryItems: satu item gagal', { itemId: item.id, error })
      }
    }
    return result
  } catch (error) {
    console.error('reconcileSummaryItems gagal', { error })
    return { closed: 0, converted: 0, reopened: 0 }
  }
}

type ItemRow = Awaited<ReturnType<typeof prisma.summaryItem.findMany>>[number]

async function reconcileOne(
  item: ItemRow,
  now: Date,
  result: { closed: number; converted: number; reopened: number }
): Promise<void> {
  let kind = item.kind
  let state = item.state
  let anchorAt = item.anchorAt
  let reminderId = item.reminderId
  const data: Prisma.SummaryItemUncheckedUpdateInput = {}
  // Reminder yang perlu ditandai selesai bersama tulisan item (satu transaksi).
  let completeReminderId: string | null = null
  let touched = false

  // 1. Pelanggan bicara lagi sesudah kita: berubah jadi menunggu balasan. Untuk PROMISE hanya
  // pesan pelanggan yang BELUM dibalas (sesudah pesan keluar terakhir) -- "ok ditunggu" yang
  // sudah dijawab tim tidak menyangkut janjinya, jadi item tetap PROMISE.
  if (kind === 'FOLLOW_UP' || kind === 'PROMISE') {
    let since = anchorAt
    if (kind === 'PROMISE') {
      const lastOutbound = await prisma.message.findFirst({
        where: { conversationId: item.conversationId, direction: 'OUTBOUND' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      })
      if (lastOutbound && lastOutbound.createdAt > since) since = lastOutbound.createdAt
    }
    const inbound = await prisma.message.findFirst({
      where: { conversationId: item.conversationId, direction: 'INBOUND', createdAt: { gt: since } },
      orderBy: { createdAt: 'asc' },
      select: messageSelect,
    })
    if (inbound) {
      kind = 'REPLY'
      state = 'OPEN'
      anchorAt = inbound.createdAt
      if (reminderId) completeReminderId = reminderId
      reminderId = null
      Object.assign(data, {
        kind,
        state,
        anchorAt,
        anchorMessageId: inbound.id,
        snippet: messageSnippet(inbound as TranscriptMessage),
        reminderId: null,
        dueAt: null,
      })
      touched = true
      result.converted++
    }
  }

  // 1b. FOLLOW_UP yang tidak berubah jadi REPLY harus punya jalan keluar sendiri: admin sudah
  // mengirim pesan sesudah anchor, atau lead sudah maju dari tahap yang perlu dikejar.
  if (kind === 'FOLLOW_UP') {
    const outbound = await prisma.message.findFirst({
      where: { conversationId: item.conversationId, direction: 'OUTBOUND', createdAt: { gt: anchorAt } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true },
    })
    if (outbound) {
      if (reminderId) completeReminderId = reminderId
      Object.assign(data, { state: 'DONE', closedReason: 'REPLIED', closedAt: outbound.createdAt })
      result.closed++
      await write(item.id, data, completeReminderId)
      return
    }
    const conversation = await prisma.conversation.findUnique({
      where: { id: item.conversationId },
      select: { pipelineStage: true },
    })
    if (conversation && !DORMANT_STAGES.includes(conversation.pipelineStage)) {
      if (reminderId) completeReminderId = reminderId
      Object.assign(data, { state: 'DONE', closedReason: 'STAGE_ADVANCED', closedAt: now })
      result.closed++
      await write(item.id, data, completeReminderId)
      return
    }
  }

  // 2. Sudah ada balasan kita sesudah anchor: selesai.
  if (kind === 'REPLY') {
    const outbound = await prisma.message.findFirst({
      where: { conversationId: item.conversationId, direction: 'OUTBOUND', createdAt: { gt: anchorAt } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true },
    })
    if (outbound) {
      if (reminderId) completeReminderId = reminderId
      // closedAt = waktu balasan, bukan waktu rekonsiliasi: pesan pelanggan yang datang di antara
      // balasan dan tick berikutnya harus tetap terlihat "lebih baru dari closedAt" oleh sync,
      // supaya item dibuka ulang dan pesannya tidak hilang dari antrean.
      Object.assign(data, { state: 'DONE', closedReason: 'REPLIED', closedAt: outbound.createdAt })
      result.closed++
      await write(item.id, data, completeReminderId)
      return
    }
  }

  // 3. Ada pengingat terkait (SCHEDULED, atau OPEN karena sudah jatuh tempo): ikuti nasibnya.
  // Pengingat yang ditandai selesai setelah jatuh tempo tetap harus menutup item.
  if (reminderId) {
    const reminder = await prisma.reminder.findUnique({ where: { id: reminderId } })
    if (!reminder) {
      Object.assign(data, { state: 'OPEN', reminderId: null, dueAt: null })
      touched = true
      if (state === 'SCHEDULED') result.reopened++
    } else if (reminder.done) {
      // Tabel Reminder tidak punya waktu selesai, jadi satu-satunya penanda yang ada adalah `now`.
      Object.assign(data, { state: 'DONE', closedReason: 'REMINDER_DONE', closedAt: now })
      touched = true
      result.closed++
    } else if (state === 'SCHEDULED' && reminder.dueAt <= now) {
      // reminderId/dueAt dipertahankan supaya UI bisa menulis "pengingat jatuh tempo".
      Object.assign(data, { state: 'OPEN' })
      touched = true
      result.reopened++
    }
  }

  if (touched) await write(item.id, data, completeReminderId)
}

async function write(itemId: string, data: Prisma.SummaryItemUncheckedUpdateInput, completeReminderId: string | null): Promise<void> {
  const ops: Prisma.PrismaPromise<unknown>[] = [prisma.summaryItem.update({ where: { id: itemId }, data })]
  if (completeReminderId) {
    ops.push(prisma.reminder.updateMany({ where: { id: completeReminderId, done: false }, data: { done: true } }))
  }
  await prisma.$transaction(ops)
}

export type LiveResult = { created: number; reopened: number; skipped: number }

/**
 * Kandidat antrean live: percakapan nyata (bukan test, bukan email otomatis) yang punya pesan
 * pelanggan di [now − LOOKBACK_MS, now − UNREPLIED_MIN_MS] tanpa pesan keluar sesudah
 * now − UNREPLIED_MIN_MS. Ini saringan kasar yang mencakup semua kandidat sebenarnya; syarat
 * persisnya (pesan terakhir INBOUND, pesan PERTAMA rangkaian belum dibalas ≥ 1 jam) dicek
 * `liveOne` dari pesan yang ikut terbawa. Satu kueri: baris `SummaryItem`, review terbaru, dan
 * pesan 14 hari terakhir (maks. TRANSCRIPT_MAX_MESSAGES) ikut terbawa, jadi tidak ada kueri per
 * percakapan selain tulisan untuk item yang benar berubah.
 */
async function findLiveConversations(now: Date) {
  const cutoff = new Date(now.getTime() - UNREPLIED_MIN_MS)
  const lookbackStart = new Date(now.getTime() - LOOKBACK_MS)
  return prisma.conversation.findMany({
    where: {
      isTest: false,
      mailAutomated: false,
      messages: {
        some: { direction: 'INBOUND', createdAt: { gte: lookbackStart, lte: cutoff } },
        none: { direction: 'OUTBOUND', createdAt: { gt: cutoff } },
      },
    },
    select: {
      id: true,
      createdAt: true,
      chatReview: true,
      chatReviewAt: true,
      contact: { select: { phone: true } },
      summaryItem: true,
      messages: {
        where: { createdAt: { gte: lookbackStart } },
        orderBy: { createdAt: 'desc' },
        take: TRANSCRIPT_MAX_MESSAGES,
        select: messageSelect,
      },
    },
  })
}

type LiveConversation = Awaited<ReturnType<typeof findLiveConversations>>[number]

/**
 * Antrean live: pesan pelanggan yang belum dibalas ≥ UNREPLIED_MIN_MS -- diukur dari pesan
 * PERTAMA rangkaian yang belum dibalas -- jadi item REPLY tanpa menunggu job 00:00. Murni DB,
 * tanpa LLM; dipanggil tick `POST /api/summary-items/tick` sesudah `reconcileSummaryItems`.
 * Tidak pernah melempar.
 *
 * - Nomor Indonesia dikecualikan bila `Settings.skipBotForIndonesianNumbers`, aturan yang sama
 *   dengan `collectDay` (`isIndonesianNumber`).
 * - "Rangkaian belum dibalas" = pesan INBOUND sesudah pesan OUTBOUND terakhir. Anchor = pesan
 *   PERTAMA rangkaian itu (sejak kapan pelanggan menunggu); snippet = pesan pertama yang bukan
 *   penutup, supaya kartu menampilkan yang perlu dijawab.
 * - Rangkaian yang isinya hanya reaksi/penutup (`isNoiseMessage`) dilewati. Penutup di akhir tidak
 *   menyembunyikan pertanyaan sebelumnya: "harganya berapa?" lalu "ok" tetap jadi item.
 * - Review terbaru (`Conversation.chatReview`) yang sudah melihat pesan terakhir dan menilainya
 *   "selesai" juga dilewati -- penilaian yang sama yang membuat job malam menyaringnya.
 * - Baris OPEN/SCHEDULED tidak disentuh: itu urusan reconcile (FOLLOW_UP/PROMISE jadi REPLY oleh
 *   pesan masuk yang belum dibalas). Baris tertutup mengikuti `shouldReopen` + `upsertCandidate`
 *   persis seperti sync malam; hanya pesan yang menurut aturan itu sanggup membuka baris yang
 *   dihitung, jadi penutup yang sudah dilepas operator tidak membukanya lagi.
 */
export async function createLiveReplyItems(now: Date = new Date()): Promise<LiveResult> {
  const result: LiveResult = { created: 0, reopened: 0, skipped: 0 }
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 1 }, select: { skipBotForIndonesianNumbers: true } })
    const excludeIndonesian = settings?.skipBotForIndonesianNumbers ?? false
    const date = jakartaDayKey(now)
    const todayStart = jakartaDayRange(date).start
    for (const conversation of await findLiveConversations(now)) {
      if (excludeIndonesian && isIndonesianNumber(conversation.contact.phone)) continue
      try {
        const outcome = await liveOne(conversation, now, date, todayStart)
        if (outcome) result[outcome]++
      } catch (error) {
        console.error('createLiveReplyItems: satu percakapan gagal', {
          conversationId: conversation.id,
          error: error instanceof Error ? error.message : 'unknown',
        })
      }
    }
    return result
  } catch (error) {
    console.error('createLiveReplyItems gagal', { error: error instanceof Error ? error.message : 'unknown' })
    return { created: 0, reopened: 0, skipped: 0 }
  }
}

/** null = bukan kandidat (pesan terakhir bukan pesan pelanggan di jendela waktu). */
async function liveOne(
  conversation: LiveConversation,
  now: Date,
  date: string,
  todayStart: Date
): Promise<keyof LiveResult | null> {
  const cutoff = now.getTime() - UNREPLIED_MIN_MS
  const lookbackStart = now.getTime() - LOOKBACK_MS
  // Pesan urut baru → lama, semuanya dalam LOOKBACK_MS (kueri); dicek lagi di sini supaya batas
  // waktu tidak hanya bergantung pada kueri.
  const last = conversation.messages[0]
  if (!last || last.direction !== 'INBOUND') return null
  if (last.createdAt.getTime() < lookbackStart) return null

  const run: TranscriptMessage[] = []
  for (const m of conversation.messages) {
    if (m.direction !== 'INBOUND') break
    run.unshift(m)
  }
  // Lama menunggu dihitung dari pesan PERTAMA yang belum dibalas, bukan yang terakhir: pelanggan
  // yang menulis lagi tiap 30 menit selama 3 jam sudah menunggu 3 jam.
  if (run[0].createdAt.getTime() > cutoff || run[0].createdAt.getTime() < lookbackStart) return null
  if (judgedDoneByLatestReview(conversation, last.createdAt)) return 'skipped'

  const row = conversation.summaryItem
  if (row && (row.state === 'OPEN' || row.state === 'SCHEDULED')) return 'skipped'

  const clock = reviewClock(conversation.id, now, now, date)
  const candidateAt = (m: TranscriptMessage): Candidate => ({
    conversationId: conversation.id,
    kind: 'REPLY',
    anchorAt: m.createdAt,
    anchorMessageId: m.id,
    anchorKnown: true,
    promises: [],
    snippet: messageSnippet(m),
    review: null,
    handoff: false,
    newLead: conversation.createdAt >= todayStart,
  })
  // Tanpa baris: seluruh rangkaian. Baris tertutup: hanya pesan yang membukanya menurut aturan
  // malam (untuk REPLY aturan itu monoton terhadap anchor, jadi hasilnya ekor rangkaian).
  const eligible: TranscriptMessage[] = []
  for (const m of run) {
    if (!row || (await shouldReopen(row, candidateAt(m), clock))) eligible.push(m)
  }
  const substantive = eligible.find((m) => !isNoiseMessage(m))
  if (!substantive) return 'skipped'
  // Baris tertutup yang hanya dibuka pesan baru: pesan itu juga mendapat tenggang 1 jam.
  if (eligible[0].createdAt.getTime() > cutoff) return 'skipped'
  const outcome = await upsertCandidate({ ...candidateAt(eligible[0]), snippet: messageSnippet(substantive) }, row, clock)
  return outcome === 'created' || outcome === 'reopened' ? outcome : 'skipped'
}

function judgedDoneByLatestReview(conversation: LiveConversation, lastMessageAt: Date): boolean {
  if (!conversation.chatReviewAt || conversation.chatReviewAt < lastMessageAt) return false
  // Hanya `status` yang dibutuhkan; bentuk sisa ringkasan lama tidak boleh membuat penilaian hilang.
  const review = conversationReviewSchema.pick({ status: true }).safeParse(conversation.chatReview)
  return review.success && review.data.status === 'selesai'
}

/** Menghapus item DONE/DROPPED yang ditutup lebih dari 30 hari lalu. Tidak pernah melempar. */
export async function pruneSummaryItems(now: Date = new Date()): Promise<{ deleted: number }> {
  try {
    const { count } = await prisma.summaryItem.deleteMany({
      where: { state: { in: ['DONE', 'DROPPED'] }, closedAt: { lt: new Date(now.getTime() - RETENTION_MS) } },
    })
    return { deleted: count }
  } catch (error) {
    console.error('pruneSummaryItems gagal', { error })
    return { deleted: 0 }
  }
}
