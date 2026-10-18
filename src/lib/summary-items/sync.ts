import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { DORMANT_STAGES, RETENTION_MS } from '@/lib/daily-summary/config'
import { messageSnippet, type TranscriptMessage } from '@/lib/daily-summary/collect'
import type { ConversationReview, DailySummaryPayload } from '@/lib/daily-summary/payload-schema'

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
 * Semua fungsi di sini tidak pernah melempar: antrean adalah pelengkap ringkasan, dan
 * kegagalannya tidak boleh mengubah status ringkasan atau menahan antrean outbound.
 */

export const SUMMARY_ITEM_KINDS = ['REPLY', 'FOLLOW_UP'] as const
export const SUMMARY_ITEM_STATES = ['OPEN', 'SCHEDULED', 'DONE', 'DROPPED'] as const

type Kind = (typeof SUMMARY_ITEM_KINDS)[number]

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

type ClosedRow = { state: string; closedReason: string | null; anchorAt: Date; closedAt: Date | null }

/**
 * Kartu REPLY yang dilepas (DROPPED) atau ditutup lewat pengingat selesai (REMINDER_DONE) bisa
 * menampilkan pesan lama, sebab anchor-nya tidak disegarkan selama terbawa. Pesan pelanggan yang
 * masuk sebelum penutupan tapi sesudah pesan yang tampil di kartu juga harus membukanya lagi,
 * jadi pembandingnya anchor baris, bukan closedAt. Selain itu berlaku aturan closedAt.
 */
function shouldReopen(row: ClosedRow, c: Candidate): boolean {
  const staleCardClose = row.state === 'DROPPED' || (row.state === 'DONE' && row.closedReason === 'REMINDER_DONE')
  if (c.kind === 'REPLY' && staleCardClose) return c.anchorAt > row.anchorAt
  return row.closedAt !== null && c.anchorAt > row.closedAt
}

/** Masukkan kandidat dari payload ringkasan `date` ke antrean. */
export async function syncSummaryItems(
  date: string,
  payload: DailySummaryPayload,
  _now: Date = new Date()
): Promise<{ created: number; updated: number; reopened: number }> {
  const result = { created: 0, updated: 0, reopened: 0 }
  try {
    for (const c of toCandidates(payload)) {
      const fields = {
        kind: c.kind,
        anchorAt: c.anchorAt,
        anchorMessageId: c.anchorMessageId,
        snippet: c.snippet,
        review: reviewValue(c.review),
        handoff: c.handoff,
        newLead: c.newLead,
      }
      const row = await prisma.summaryItem.findUnique({ where: { conversationId: c.conversationId } })
      if (!row) {
        await prisma.summaryItem.create({
          data: { conversationId: c.conversationId, ...fields, state: 'OPEN', openedOn: date, lastSeenOn: date },
        })
        result.created++
      } else if (row.state === 'OPEN' || row.state === 'SCHEDULED') {
        // Membuat ulang ringkasan tanggal lama tidak boleh memundurkan item yang sudah
        // diperbarui oleh ringkasan yang lebih baru.
        if (date < row.lastSeenOn) continue
        await prisma.summaryItem.update({
          where: { id: row.id },
          // "YYYY-MM-DD" terurut leksikografis sama dengan urutan tanggal.
          data: { ...fields, lastSeenOn: row.lastSeenOn > date ? row.lastSeenOn : date },
        })
        result.updated++
      } else if (shouldReopen(row, c)) {
        // Pesan baru sesudah ditutup: item lahir kembali. Pesan yang sama tidak membukanya lagi,
        // jadi keputusan operator tetap berlaku.
        await prisma.summaryItem.update({
          where: { id: row.id },
          data: {
            ...fields,
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
        result.reopened++
      }
    }
    return result
  } catch (error) {
    console.error('syncSummaryItems gagal', { date, error })
    return { created: 0, updated: 0, reopened: 0 }
  }
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

  // 1. Pelanggan bicara lagi sesudah kita: tindak lanjut berubah jadi menunggu balasan.
  if (kind === 'FOLLOW_UP') {
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
