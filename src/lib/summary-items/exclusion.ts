// Percakapan yang TIDAK masuk antrean tindakan (owner 2026-11-25, dari isi Antrean /new):
// - nomor Indonesia (gerbang yang sama dengan aksi booking: percakapan uji tetap lolos);
// - Belum dibalas yang rangkaian pesan pelanggannya hanya reaksi (👍 pada pesan kita bukan pertanyaan);
// - Follow Up / Janji tim untuk tamu yang TRIP-nya sudah selesai, kecuali review terbaru melihat potensi booking baru
//   (jenisKontak calon_tamu, atau ada `belumBooking`). Tamu yang trip-nya belum jalan tetap masuk.
// Satu tempat untuk ketiganya: dipakai `upsertCandidate` (tidak membuat/membuka item) dan `closeExcludedItems`
// (menutup item terbuka, closedReason NOT_QUEUED).
import { prisma } from '@/lib/db'
import { jakartaDay } from '@/lib/bot/eval/replay-pairs'
import { blockedByIndonesianGate } from '@/lib/booking-actions/rollout'
import { conversationReviewSchema } from '@/lib/daily-summary/payload-schema'
import { findOurReply } from './automated'

export type ExclusionReason = 'NOMOR_INDONESIA' | 'HANYA_REAKSI' | 'TRIP_SELESAI'

export const EXCLUSION_NOTE: Record<ExclusionReason, string> = {
  NOMOR_INDONESIA: 'Nomor Indonesia',
  HANYA_REAKSI: 'Hanya reaksi',
  TRIP_SELESAI: 'Trip sudah selesai',
}

/** Trip sudah lewat: tanggal selesai booking (WIB) sebelum hari ini. */
export function tripEnded(bookingData: unknown, today: string): boolean {
  const end = (bookingData as { date?: { end_ymd?: unknown } } | null)?.date?.end_ymd
  return typeof end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(end) && end < today
}

/** Review melihat calon booking baru (tamu lama yang menanyakan trip lain). */
export function potentialNewBooking(review: unknown): boolean {
  const r = conversationReviewSchema.pick({ jenisKontak: true }).safeParse(review)
  const blocker = (review as { belumBooking?: unknown } | null)?.belumBooking
  return (r.success && r.data.jenisKontak === 'calon_tamu') || Boolean(blocker)
}

/** Rangkaian pesan pelanggan sesudah balasan terakhir kita ada, dan semuanya reaksi. */
async function reactionOnlyRun(conversationId: string): Promise<boolean> {
  const lastOurs = await findOurReply(conversationId, {}, 'desc')
  const run = await prisma.message.findMany({
    where: { conversationId, direction: 'INBOUND', ...(lastOurs ? { createdAt: { gt: lastOurs.createdAt } } : {}) },
    select: { type: true },
  })
  return run.length > 0 && run.every((m) => m.type === 'reaction')
}

/**
 * Alasan item `kind` untuk percakapan ini tidak masuk antrean, atau null. `review` = review kandidat/item; review
 * terbaru percakapan (`chatReview`) dipakai bila ada, karena ia yang paling tahu soal potensi booking baru.
 */
export async function exclusionFor(conversationId: string, kind: string, review: unknown, now: Date = new Date()): Promise<ExclusionReason | null> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { isTest: true, bookingData: true, chatReview: true, contact: { select: { phone: true } } },
  })
  if (!conv) return null
  if (blockedByIndonesianGate({ isTest: conv.isTest, phone: conv.contact?.phone ?? null })) return 'NOMOR_INDONESIA'
  if (kind === 'REPLY') return (await reactionOnlyRun(conversationId)) ? 'HANYA_REAKSI' : null
  if ((kind === 'FOLLOW_UP' || kind === 'PROMISE') && tripEnded(conv.bookingData, jakartaDay(now))) {
    return potentialNewBooking(conv.chatReview ?? review) ? null : 'TRIP_SELESAI'
  }
  return null
}

/**
 * Menutup item OPEN yang kena aturan di atas (DONE, NOT_QUEUED, catatan = alasannya). Item SCHEDULED tidak disentuh:
 * pengingat adalah keputusan operator. Dipanggil di akhir `reconcileSummaryItems`, sesudah konversi jenis. Tidak
 * pernah melempar.
 */
export async function closeExcludedItems(now: Date = new Date()): Promise<number> {
  let closed = 0
  try {
    const items = await prisma.summaryItem.findMany({ where: { state: 'OPEN' }, select: { id: true, conversationId: true, kind: true, review: true } })
    for (const it of items) {
      const reason = await exclusionFor(it.conversationId, it.kind, it.review, now).catch(() => null)
      if (!reason) continue
      await prisma.summaryItem.updateMany({
        where: { id: it.id, state: 'OPEN' },
        data: { state: 'DONE', closedReason: 'NOT_QUEUED', note: EXCLUSION_NOTE[reason], closedAt: now },
      })
      closed++
    }
  } catch (error) {
    console.error('closeExcludedItems gagal', error instanceof Error ? error.name : 'unknown')
  }
  return closed
}
