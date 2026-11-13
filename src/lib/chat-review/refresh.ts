import { prisma } from '@/lib/db'
import { buildNumberedTranscript, lastRealMessage, markAutomated } from '@/lib/daily-summary/collect'
import { automatedMessageIds } from '@/lib/summary-items/automated'
import { TRANSCRIPT_MAX_MESSAGES } from '@/lib/daily-summary/config'
import { reviewConversation, type ReviewReason } from '@/lib/daily-summary/review'
import { applyReviewToItem } from '@/lib/summary-items/sync'
import { saveChatReview, crewNoteOf, scheduleNoteOf } from './store'
import { crewNoteEnabled, generateCrewNote, guestMessagesForCrew } from './crew-note'
import { crewNoteRefOf, scheduleCrewNotePush } from './crew-note-sync'
import { bookingContextForReview } from './booking-context'
import { generateScheduleNote } from './schedule-note'
import { bookingAutomationAllowed } from '@/lib/booking-actions/rollout'
import { scheduleScheduleNoteSync } from '@/lib/booking-note/sync'
import type { BookingData } from '@/lib/booking/client'

/**
 * Meringkas SATU percakapan lewat LLM, menyimpannya sebagai ringkasan terbaru, lalu menerapkannya
 * ke item "Janji tim". Satu-satunya tempat blok ini hidup: dipakai tombol "Perbarui sekarang"
 * (`POST /api/conversations/[id]/chat-review`) dan auto-refresh sesudah ekstraksi booking.
 *
 * `empty` = percakapan belum punya pesan; `failed` = LLM tidak memberi ringkasan yang sah (review
 * lama tidak disentuh). Galat tak terduga dilempar ke pemanggil, yang memutuskan cara
 * melaporkannya.
 */
export type RefreshChatReviewResult = { status: 'ok' } | { status: 'empty' } | { status: 'failed' }

export async function refreshChatReview(conversationId: string, asOf: Date): Promise<RefreshChatReviewResult> {
  const latest = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: TRANSCRIPT_MAX_MESSAGES,
    select: { id: true, direction: true, sentBy: true, type: true, content: true, createdAt: true },
  })
  if (latest.length === 0) return { status: 'empty' }
  // Kabar otomatis ("booking sudah diperbarui", permintaan data) berlabel sendiri di transkrip dan tidak menentukan
  // `reasons`: pertanyaan tamu yang hanya dijawab kabar otomatis tetap 'unreplied' (review Important A).
  const messages = markAutomated([...latest].reverse(), await automatedMessageIds([conversationId], latest[latest.length - 1].createdAt))
  const reasons: ReviewReason[] = lastRealMessage(messages)?.direction === 'INBOUND' ? ['unreplied'] : ['active']

  const settings = await prisma.settings.findUnique({ where: { id: 1 }, select: { ollamaModel: true } })
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { bookingData: true, chatReview: true, isTest: true, contact: { select: { name: true, phone: true } } },
  })
  const bookingContext = bookingContextForReview(conv?.bookingData as BookingData | null | undefined)
  const review = await reviewConversation(buildNumberedTranscript(messages), reasons, settings?.ollamaModel ?? undefined, bookingContext)
  if (!review) return { status: 'failed' }

  // Catatan untuk crew (Guest Brief): hanya percakapan ber-booking dengan tamu, dan hanya bila fitur menyala. Gagal =
  // catatan sebelumnya dipertahankan (saveChatReview juga mempertahankannya bila `catatanCrew` tidak ada).
  let toSave = review
  if (crewNoteEnabled() && bookingContext && review.jenisKontak !== 'mitra' && review.jenisKontak !== 'lainnya') {
    const previous = crewNoteOf(conv?.chatReview)
    const note = await generateCrewNote({
      review,
      bookingContext,
      previous,
      contactName: conv?.contact?.name ?? null,
      model: settings?.ollamaModel ?? undefined,
      now: asOf,
      guestMessages: guestMessagesForCrew(messages, conv?.contact?.name ?? null),
    })
    const catatanCrew = note ?? previous
    if (catatanCrew) toSave = { ...review, catatanCrew }
    // Catatan BARU (bukan yang dipertahankan karena LLM gagal) dikirim ke backoffice untuk crew-portal. Di belakang.
    if (note) scheduleCrewNotePush(crewNoteRefOf(conv?.bookingData), note)
  }

  // Note untuk Schedule: poin pendek dari chat yang belum ada di Schedule. Hanya percakapan ber-booking dengan tamu.
  // Gagal = note sebelumnya dipertahankan (saveChatReview juga mempertahankannya bila `catatanSchedule` tidak ada).
  if (bookingContext && review.jenisKontak !== 'mitra' && review.jenisKontak !== 'lainnya') {
    const note = await generateScheduleNote({
      review,
      booking: conv?.bookingData as BookingData | null | undefined,
      bookingContext,
      contactName: conv?.contact?.name ?? null,
      model: settings?.ollamaModel ?? undefined,
      at: asOf,
    })
    const catatanSchedule = note ?? scheduleNoteOf(conv?.chatReview)
    if (catatanSchedule) toSave = { ...toSave, catatanSchedule }
  }

  await saveChatReview(conversationId, toSave, asOf)

  // Note untuk Schedule ikut ke `bookings.note` (digabung dengan note admin, `booking-note/`). Dijalankan tiap ringkasan
  // dibuat, bukan hanya saat isinya berubah: penggabungannya idempoten (satu pembacaan bila tak ada yang berubah) dan
  // memulihkan blok yang tertimpa jalur lain. Sakelar `SCHEDULE_NOTE_SYNC_ENABLED` (bawaan mati) dan rollout uji berlaku.
  const scheduleNote = toSave.catatanSchedule
  if (scheduleNote && bookingAutomationAllowed({ isTest: conv?.isTest, phone: conv?.contact?.phone })) {
    scheduleScheduleNoteSync(conv?.bookingData, scheduleNote.baris, asOf)
  }
  // Janji tim yang kini sudah ditepati menutup item PROMISE-nya (PROMISE_KEPT). Tidak pernah melempar.
  await applyReviewToItem(conversationId, review, asOf)
  return { status: 'ok' }
}
