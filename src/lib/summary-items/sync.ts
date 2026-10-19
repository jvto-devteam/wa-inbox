import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { DORMANT_STAGES, RETENTION_MS } from '@/lib/daily-summary/config'
import { messageSnippet, type TranscriptMessage } from '@/lib/daily-summary/collect'
import { unkeptPromises, type ConversationReview, type DailySummaryPayload } from '@/lib/daily-summary/payload-schema'
import { jakartaDayKey, jakartaDayRange } from '@/lib/daily-summary/time'
import type { SummaryItemKind } from './status'

/**
 * Antrean tindakan Summary Harian: menjaga tabel `SummaryItem` tetap searah dengan payload
 * ringkasan (sync) dan dengan kenyataan di tabel Message/Reminder (reconcile).
 *
 * Kenapa dua langkah terpisah: payload hanya lahir sekali sehari (00:00 WIB), sedangkan item
 * harus tertutup begitu admin membalas. `syncSummaryItems` memasukkan kandidat dari payload;
 * `reconcileSummaryItems` murni membaca fakta (pesan keluar, pengingat) dan boleh dipanggil
 * kapan saja, termasuk tiap tick `/api/outbound-jobs/process`.
 *
 * Jalan keluar otomatis (reconcile): REPLY tertutup oleh pesan keluar sesudah anchor; FOLLOW_UP
 * jadi REPLY bila pelanggan chat lagi, atau tertutup (REPLIED) bila admin sudah mengirim pesan
 * sesudah anchor, atau (STAGE_ADVANCED) bila tahap pipeline sudah keluar dari DORMANT_STAGES.
 * Pengingat dipantau selama `reminderId` terisi, baik SCHEDULED maupun OPEN (sudah jatuh tempo).
 *
 * PROMISE (janji tim yang belum ditepati, dari `janjiTim` di review) hanya lahir untuk percakapan
 * yang BUKAN kandidat REPLY/FOLLOW_UP hari itu -- keduanya selalu menang. Ia tertutup
 * (PROMISE_KEPT) oleh review berikutnya yang tidak lagi memuat janji terbuka (`applyReviewToItem`,
 * dari sync malam atau tombol "Perbarui sekarang"), dan berubah jadi REPLY seperti FOLLOW_UP bila
 * pelanggan chat lagi. Pesan keluar sesudah janji TIDAK menutupnya: membalas belum tentu menepati.
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
  snippet: string
  review: ConversationReview | null
  handoff: boolean
  newLead: boolean
}

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
 * Kandidat PROMISE: anchor = waktu pesan janji terbuka yang PALING BARU (dicari lewat `messageId`
 * dan dibatasi ke percakapan itu), atau akhir hari ringkasan bila tak satu pun pesannya diketahui.
 */
async function promiseCandidate(
  conversationId: string,
  review: ConversationReview,
  dayEnd: Date,
  newLead: boolean
): Promise<Candidate | null> {
  const unkept = unkeptPromises(review)
  if (unkept.length === 0) return null
  const messageIds = unkept.flatMap((p) => (p.messageId ? [p.messageId] : []))
  const message =
    messageIds.length > 0
      ? await prisma.message.findFirst({
          where: { id: { in: messageIds }, conversationId },
          orderBy: { createdAt: 'desc' },
          select: { id: true, createdAt: true },
        })
      : null
  const anchored = message ? unkept.find((p) => p.messageId === message.id) : undefined
  return {
    conversationId,
    kind: 'PROMISE',
    anchorAt: message?.createdAt ?? dayEnd,
    anchorMessageId: message?.id ?? null,
    snippet: (anchored ?? unkept[0]).teks,
    review,
    handoff: false,
    newLead,
  }
}

type ClosedRow = { state: string; closedReason: string | null; anchorAt: Date; closedAt: Date | null; lastSeenOn: string }

const closedByReply = (row: ClosedRow) => row.state === 'DONE' && row.closedReason === 'REPLIED'

/**
 * Kartu REPLY yang dilepas (DROPPED) atau ditutup lewat pengingat selesai (REMINDER_DONE) bisa
 * menampilkan pesan lama, sebab anchor-nya tidak disegarkan selama terbawa. Pesan pelanggan yang
 * masuk sebelum penutupan tapi sesudah pesan yang tampil di kartu juga harus membukanya lagi,
 * jadi pembandingnya anchor baris, bukan closedAt. Selain itu berlaku aturan closedAt.
 *
 * PROMISE: membalas tidak menepati janji. Baris DONE/REPLIED dibuka lagi oleh janji yang masih
 * terbuka berapa pun anchor-nya -- asal review itu (`asOf`) sudah melihat balasannya dan bukan
 * ringkasan tanggal lama. Tanpa ini janji hilang diam-diam sesudah "ok ditunggu" → REPLY → dibalas.
 * DROPPED/REMINDER_DONE tetap butuh janji lebih baru dari anchor baris (operator melepas dengan
 * sadar); PROMISE_KEPT dan selebihnya memakai aturan closedAt.
 */
function shouldReopen(row: ClosedRow, c: Candidate, date: string, asOf: Date): boolean {
  const staleCardClose = row.state === 'DROPPED' || (row.state === 'DONE' && row.closedReason === 'REMINDER_DONE')
  if (c.kind === 'PROMISE' && closedByReply(row)) {
    return date >= row.lastSeenOn && (row.closedAt === null || row.closedAt <= asOf)
  }
  if ((c.kind === 'REPLY' || c.kind === 'PROMISE') && staleCardClose) return c.anchorAt > row.anchorAt
  return row.closedAt !== null && c.anchorAt > row.closedAt
}

/**
 * Anchor PROMISE dipakai rekonsiliasi untuk "pelanggan chat lagi sesudahnya". Saat dibuka lagi
 * dari DONE/REPLIED, anchor naik ke waktu balasan itu: pesan pelanggan yang SUDAH dibalas tidak
 * boleh langsung mengubahnya jadi REPLY lagi. Dengan alasan yang sama anchor PROMISE yang masih
 * terbuka tidak pernah mundur.
 */
function promiseAnchor(row: ClosedRow & { kind: string }, c: Candidate): Date {
  let floor: Date | null = null
  if (row.state === 'OPEN' || row.state === 'SCHEDULED') floor = row.kind === 'PROMISE' ? row.anchorAt : null
  else if (closedByReply(row)) floor = row.closedAt
  return floor && floor > c.anchorAt ? floor : c.anchorAt
}

type UpsertOutcome = 'created' | 'updated' | 'reopened' | 'skipped'

/**
 * Satu kandidat ke antrean: buat, perbarui yang masih terbuka, atau buka lagi yang tertutup.
 * Dipakai sync malam dan `applyReviewToItem` (Perbarui) supaya aturannya hanya ada di sini.
 * `asOf` = sampai kapan review kandidat itu melihat percakapan.
 */
async function upsertCandidate(c: Candidate, row: ItemRow | null, date: string, asOf: Date): Promise<UpsertOutcome> {
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
    await prisma.summaryItem.update({
      where: { id: row.id },
      data: {
        ...fields,
        ...(c.kind === 'PROMISE' ? { anchorAt: promiseAnchor(row, c) } : {}),
        // "YYYY-MM-DD" terurut leksikografis sama dengan urutan tanggal.
        lastSeenOn: row.lastSeenOn > date ? row.lastSeenOn : date,
      },
    })
    return 'updated'
  }
  if (!shouldReopen(row, c, date, asOf)) return 'skipped'
  // Pesan baru sesudah ditutup: item lahir kembali. Pesan yang sama tidak membukanya lagi,
  // jadi keputusan operator tetap berlaku.
  await prisma.summaryItem.update({
    where: { id: row.id },
    data: {
      ...fields,
      ...(c.kind === 'PROMISE' ? { anchorAt: promiseAnchor(row, c) } : {}),
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
    // Sampai kapan review hari itu melihat percakapan: akhir hari, kecuali hari itu belum selesai
    // ("Buat ulang" untuk hari ini) -- anchor/closedAt di masa depan akan menahan item.
    const dayEnd = new Date(Math.min(jakartaDayRange(date).end.getTime(), now.getTime()))
    // Review tanpa janji terbuka untuk percakapan yang bukan kandidat REPLY/FOLLOW_UP: bahan
    // penutupan PROMISE_KEPT di bawah.
    const kept: Array<[string, ConversationReview]> = []
    for (const [conversationId, review] of reviewsByConversation(payload)) {
      if (taken.has(conversationId)) continue
      const c = await promiseCandidate(conversationId, review, dayEnd, newLeadIds.has(conversationId))
      if (c) candidates.push(c)
      else kept.push([conversationId, review])
    }

    for (const c of candidates) {
      const row = await prisma.summaryItem.findUnique({ where: { conversationId: c.conversationId } })
      const outcome = await upsertCandidate(c, row, date, dayEnd)
      if (outcome !== 'skipped') result[outcome]++
    }

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
      if ((await applyReviewToRow(row, review, dayEnd)) === 'closed') result.closed++
    }
    return result
  } catch (error) {
    console.error('syncSummaryItems gagal', { date, error })
    return { created: 0, updated: 0, reopened: 0, closed: 0 }
  }
}

export type ApplyReviewOutcome = 'closed' | 'updated' | 'created' | 'reopened' | 'unchanged'

/**
 * Menerapkan review terbaru satu percakapan ke item "Janji tim"-nya:
 * - PROMISE OPEN/SCHEDULED: tidak ada lagi janji terbuka → DONE/PROMISE_KEPT (pengingatnya ikut
 *   ditandai selesai); masih ada → review di item disegarkan.
 * - REPLY/FOLLOW_UP OPEN/SCHEDULED: tidak disentuh -- keduanya menang atas janji.
 * - Tanpa item terbuka dan review memuat janji terbuka: PROMISE dibuat atau dibuka lagi lewat
 *   `upsertCandidate`, aturan yang sama dengan sync malam (tanggal = hari WIB `asOf`).
 *
 * `asOf` = sampai kapan review itu melihat percakapan. Review yang lebih tua dari janjinya
 * (anchor) tidak bisa tahu janji itu, jadi diabaikan. Dipakai sync malam (asOf = akhir hari) dan
 * POST /api/conversations/[id]/chat-review (asOf = sekarang). Tidak pernah melempar.
 */
export async function applyReviewToItem(conversationId: string, review: ConversationReview, asOf: Date): Promise<ApplyReviewOutcome> {
  try {
    const row = await prisma.summaryItem.findUnique({ where: { conversationId } })
    if (row && (row.state === 'OPEN' || row.state === 'SCHEDULED')) return await applyReviewToRow(row, review, asOf)
    const c = await promiseCandidate(conversationId, review, asOf, row?.newLead ?? false)
    if (!c) return 'unchanged'
    const outcome = await upsertCandidate(c, row, jakartaDayKey(asOf), asOf)
    return outcome === 'created' || outcome === 'reopened' ? outcome : 'unchanged'
  } catch (error) {
    console.error('applyReviewToItem gagal', { conversationId, error: error instanceof Error ? error.message : 'unknown' })
    return 'unchanged'
  }
}

type PromiseRow = { id: string; kind: string; state: string; anchorAt: Date; reminderId: string | null }

async function applyReviewToRow(row: PromiseRow, review: ConversationReview, asOf: Date): Promise<ApplyReviewOutcome> {
  if (row.kind !== 'PROMISE' || (row.state !== 'OPEN' && row.state !== 'SCHEDULED')) return 'unchanged'
  if (asOf < row.anchorAt) return 'unchanged'
  if (unkeptPromises(review).length > 0) {
    await prisma.summaryItem.update({ where: { id: row.id }, data: { review: reviewValue(review) } })
    return 'updated'
  }
  await write(
    row.id,
    { state: 'DONE', closedReason: 'PROMISE_KEPT', closedAt: asOf, review: reviewValue(review) },
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

  // 1. Pelanggan bicara lagi sesudah kita (atau sesudah janji kita): berubah jadi menunggu balasan.
  if (kind === 'FOLLOW_UP' || kind === 'PROMISE') {
    const inbound = await prisma.message.findFirst({
      where: { conversationId: item.conversationId, direction: 'INBOUND', createdAt: { gt: anchorAt } },
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
