/**
 * Terapkan otomatis (Task 11b): kartu CHANGE yang baru dibuat langsung ditulis ke backoffice TANPA klik,
 * bila admin menyetel kelompoknya `ALWAYS` di Pengaturan -> Persetujuan perubahan booking. Ini menulis booking
 * produksi tanpa manusia, jadi semua keputusan di sini condong ke "serahkan ke orang":
 *
 *   tier AI   -> Settings.bookingLightApproval          tier BALI -> Settings.bookingBaliApproval
 *   tier HEAVY, tipe TASK/MISMATCH/DATA_REQUEST, field tanpa jalur tulis (note/*_arrival, R16) -> 'skipped'
 *   setelan bukan persis 'ALWAYS' (APPROVE, kosong, galat baca) -> 'skipped'
 *   rollout `test` (R25, `rollout.ts`) dan percakapan bukan percakapan uji -> 'skipped'
 *   kartu pendamping titik<->detail (R17) yang kelompoknya tidak ALWAYS -> 'skipped' (satu patch menulis keduanya)
 *   kartu titik tanpa detail yang bisa dipakai (booking sudah punya detail, tak ada kartu detail) -> 'skipped',
 *     tetap OPEN untuk manusia, TANPA push gagal (klien akan menolak "Isi detail titik baru dulu")
 *
 * Eksekusinya `executeBookingAction` yang SAMA dengan tombol Setujui (actor SYSTEM, tanpa akun, closedReason
 * AUTO_APPLIED): klaim, penulisan, event EXECUTED, kabar vendor Bali. Gagal = kartu kembali OPEN + event
 * EXECUTE_FAILED (ditulis inti) + push EXECUTE_FAILED. Sukses = SATU push AUTO_APPLIED dan SATU kabar tamu per
 * ekstraksi untuk semua kartu yang tertulis (`announceApplied`; review 2026-10-20 Important 2).
 *
 * Kabar ke admin hanya SESUDAH diterapkan (keputusan owner 2026-10-20: "tidak perlu approval admin, notif ke admin
 * saja jika sudah diupdate"): `applyExtraction` tidak mengirim push CHANGE saat kartu dibuat, `autoApplyCreated`
 * yang memutuskan -- sukses = AUTO_APPLIED saja; gagal = EXECUTE_FAILED; dilewati dan kartu masih OPEN (setelan
 * APPROVE, titik tanpa detail, jalur tulis mati, rollout uji) = push CHANGE yang tertunda, supaya manusia tahu.
 * Tidak pernah melempar.
 */
import { prisma } from '@/lib/db'
import type { BookingData } from '@/lib/booking/client'
import { notifyBookingAction, summarizeAction, type BookingPushEvent } from '@/lib/push/send'
import { ALREADY_APPLIED_ERROR, executeBookingAction } from './execute'
import { notifyGuestOfUpdate, type GuestNoticeItem } from './guest-notice'
import { readBookingField, type FieldKey } from './fields'
import { currentBookingId } from './scope'
import { bookingAutomationAllowed } from './rollout'
import { canExecuteField, companionFields } from './view'

export type AutoApplyOutcome = 'applied' | 'skipped' | 'failed'
export type ApprovalMode = 'APPROVE' | 'ALWAYS'

const NEEDS_DETAIL_ERROR = 'Isi detail titik baru dulu'

function asBooking(raw: unknown): BookingData | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as BookingData) : null
}

function bookingCode(b: BookingData): string | null {
  const id = (b as Record<string, unknown>).id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

function nonBlank(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

async function loadModes(): Promise<Record<'AI' | 'BALI', ApprovalMode>> {
  try {
    const row = await prisma.settings.findUnique({
      where: { id: 1 },
      select: { bookingLightApproval: true, bookingBaliApproval: true },
    })
    return {
      AI: row?.bookingLightApproval === 'ALWAYS' ? 'ALWAYS' : 'APPROVE',
      BALI: row?.bookingBaliApproval === 'ALWAYS' ? 'ALWAYS' : 'APPROVE',
    }
  } catch {
    return { AI: 'APPROVE', BALI: 'APPROVE' }
  }
}

function modeOf(modes: Record<'AI' | 'BALI', ApprovalMode>, tier: string): ApprovalMode {
  return tier === 'AI' ? modes.AI : tier === 'BALI' ? modes.BALI : 'APPROVE'
}

async function decide(actionId: string): Promise<
  | { go: false }
  | { go: true; action: { field: string; proposedValue: unknown; sourceMessageId: string | null; conversationId: string }; code: string | null; bookingId: string | null }
> {
  const action = await prisma.bookingAction.findUnique({ where: { id: actionId } })
  if (!action || action.type !== 'CHANGE' || action.state !== 'OPEN') return { go: false }
  if (action.tier === 'HEAVY' || !canExecuteField(action.field)) return { go: false }
  const modes = await loadModes()
  if (modeOf(modes, action.tier) !== 'ALWAYS') return { go: false }
  const value = nonBlank(action.proposedValue)
  if (value === null) return { go: false }

  const conv = await prisma.conversation.findUnique({
    where: { id: action.conversationId },
    select: { bookingData: true, isTest: true, contact: { select: { phone: true } } },
  })
  if (!conv || !bookingAutomationAllowed({ isTest: conv.isTest, phone: conv.contact?.phone ?? null })) return { go: false }
  const booking = asBooking(conv.bookingData)
  if (!booking || action.bookingId === null || currentBookingId(booking) !== action.bookingId) return { go: false }

  // Kartu pendamping di sisi yang sama ikut ditulis dalam satu patch (R17): semuanya harus boleh otomatis.
  const others = companionFields(action.field)
  const companions = others.length === 0
    ? []
    : ((await prisma.bookingAction.findMany({
        where: { conversationId: action.conversationId, bookingId: action.bookingId, type: 'CHANGE', state: 'OPEN', field: { in: others } },
        select: { field: true, tier: true, proposedValue: true },
      })) ?? [])
  if (companions.some((c) => modeOf(modes, c.tier) !== 'ALWAYS')) return { go: false }

  // Titik baru wajib membawa detail baru bila booking sudah punya detail (klien menolak sebaliknya).
  if (action.field === 'pickup_point' || action.field === 'drop_point') {
    const detailField: FieldKey = action.field === 'pickup_point' ? 'pickup_detail' : 'drop_detail'
    const hasDetailCard = companions.some((c) => c.field === detailField && nonBlank(c.proposedValue) !== null)
    if (readBookingField(booking, detailField) !== null && !hasDetailCard) return { go: false }
  }
  return { go: true, action, code: bookingCode(booking), bookingId: action.bookingId }
}

/** Kartu yang tertulis otomatis, dikumpulkan untuk SATU push AUTO_APPLIED + SATU kabar tamu (review Important 2). */
export type AppliedCard = { id: string; field: string; proposedValue: unknown; sourceMessageId: string | null }
export type AppliedBatch = {
  conversationId: string
  bookingId: string | null
  code: string | null
  cards: AppliedCard[]
  /** Kartu yang ternyata sudah sesuai di backoffice (MATCHED_IN_BACKOFFICE) setelah tanda terima terkirim: "sudah sesuai". */
  matchedCards?: AppliedCard[]
}

export async function autoApplyIfAllowed(
  actionId: string,
  onUnexpectedError?: BookingPushEvent,
  /** Penampung bersama `autoApplyCreated`; tanpa ini kartu ini dikabarkan sendiri sesudah berhasil. */
  collect?: AppliedBatch[]
): Promise<AutoApplyOutcome> {
  try {
    const d = await decide(actionId)
    if (!d.go) return 'skipped'
    const { action, code } = d
    const value = nonBlank(action.proposedValue)

    const res = await executeBookingAction({ actionId, accountId: null, actor: 'SYSTEM', closedReason: 'AUTO_APPLIED', deferGuestNotice: true })
    if (res.status === 200) {
      // Sudah tertulis: kegagalan sesudah ini (membaca kartu, push, kabar tamu) TIDAK boleh jadi EXECUTE_FAILED palsu.
      try {
        const rows = (await prisma.bookingAction.findMany({
          where: { id: { in: res.body.executed } },
          select: { id: true, field: true, proposedValue: true, sourceMessageId: true },
        })) ?? []
        // Urutan eksekusi (kartu utama dulu), bukan urutan kueri.
        const cards = res.body.executed.flatMap((id) => rows.filter((r) => r.id === id))
        const batch: AppliedBatch = { conversationId: action.conversationId, bookingId: d.bookingId, code, cards }
        if (collect) collect.push(batch)
        else await announceApplied([batch])
      } catch (error) {
        console.error('[booking-actions] autoApplyIfAllowed: kabar sesudah diterapkan gagal', { actionId, error: error instanceof Error ? error.name : 'unknown' })
      }
      return 'applied'
    }
    // Nilainya sudah ada di booking: kartu ditutup tanpa menulis, dan tamu dikabari "sudah sesuai" -- satu-satunya
    // jawaban untuk permintaan ini (owner 2026-10-21: satu permintaan = satu WhatsApp; tanda terima tidak dikirim untuk
    // kartu yang sudah tertutup, dan bot diam untuk pesan yang menjadi kartu).
    if (res.status === 409 && res.body.error === ALREADY_APPLIED_ERROR) {
      try {
        const card: AppliedCard = { id: actionId, field: action.field, proposedValue: action.proposedValue, sourceMessageId: action.sourceMessageId }
        const batch: AppliedBatch = { conversationId: action.conversationId, bookingId: d.bookingId, code, cards: [], matchedCards: [card] }
        if (collect) collect.push(batch)
        else await announceApplied([batch])
      } catch (error) {
        console.error('[booking-actions] autoApplyIfAllowed: kabar sudah-sesuai gagal', { actionId, error: error instanceof Error ? error.name : 'unknown' })
      }
      return 'skipped'
    }
    // Belum diklaim / bukan urusan otomatis (jalur tulis mati, kartu sudah ditutup, booking berganti): biarkan OPEN.
    if (res.status === 409 || res.status === 503 || res.status === 404) return 'skipped'
    if (res.body.error === NEEDS_DETAIL_ERROR) return 'skipped'
    // Gagal sesudah klaim: inti sudah mengembalikan OPEN + event EXECUTE_FAILED. Kabari admin.
    void notifyBookingAction({
      kind: 'EXECUTE_FAILED',
      conversationId: action.conversationId,
      bookingCode: code,
      summary: summarizeAction(action.field, value),
      actionId,
      messageId: action.sourceMessageId,
    })
    return 'failed'
  } catch (error) {
    console.error('[booking-actions] autoApplyIfAllowed gagal', { actionId, error: error instanceof Error ? error.name : 'unknown' })
    // Galat tak terduga sebelum/sesudah penulisan: admin tetap harus tahu kartu ini butuh orang.
    if (onUnexpectedError) void notifyBookingAction({ ...onUnexpectedError, kind: 'EXECUTE_FAILED' })
    return 'failed'
  }
}

/**
 * Per percakapan: SATU push AUTO_APPLIED yang menyebut semua perubahan (tag kartu pertama) dan SATU kabar tamu
 * gabungan (`notifyGuestOfUpdate`, kunci `guest_update:<kartu pertama>`). Booking untuk kabar = `bookingData`
 * tersimpan sesudah tulis (penyegaran pasca-tulis sudah menyimpannya). Tidak pernah melempar.
 */
async function announceApplied(batches: AppliedBatch[]): Promise<void> {
  const byConversation = new Map<string, AppliedBatch[]>()
  for (const b of batches) byConversation.set(b.conversationId, [...(byConversation.get(b.conversationId) ?? []), b])
  for (const [conversationId, list] of byConversation) {
    try {
      const cards: AppliedCard[] = []
      for (const c of list.flatMap((b) => b.cards)) if (!cards.some((x) => x.id === c.id)) cards.push(c)
      if (cards.length === 0) {
        const matched: AppliedCard[] = []
        for (const c of list.flatMap((b) => b.matchedCards ?? [])) if (!matched.some((x) => x.id === c.id)) matched.push(c)
        if (matched.length > 0) await announceMatched(conversationId, list[0].bookingId, matched)
        continue
      }
      const first = cards[0]
      const code = list.find((b) => b.code !== null)?.code ?? null
      void notifyBookingAction({
        kind: 'AUTO_APPLIED',
        conversationId,
        bookingCode: code,
        summary: cards.map((c) => summarizeAction(c.field, nonBlank(c.proposedValue))).join('; '),
        actionId: first.id,
        messageId: first.sourceMessageId,
      })
      const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { bookingData: true } })
      const booking = asBooking(conv?.bookingData)
      if (!booking) continue
      const items: GuestNoticeItem[] = cards.flatMap((c) => {
        const value = nonBlank(c.proposedValue)
        return value === null ? [] : [{ actionId: c.id, sourceMessageId: c.sourceMessageId, written: [{ field: c.field as FieldKey, value }] }]
      })
      await notifyGuestOfUpdate({ conversationId, bookingId: list[0].bookingId, accountId: null, booking, items })
    } catch (error) {
      console.error('[booking-actions] announceApplied gagal', { conversationId, error: error instanceof Error ? error.name : 'unknown' })
    }
  }
}

/**
 * Satu per satu (tidak paralel): kartu yang berbagi booking tidak boleh menulis bersamaan. Tidak pernah melempar.
 * `events` = push CHANGE tertunda dari `applyExtraction`. Kartu yang dilewati dikabari sebagai CHANGE hanya bila
 * masih OPEN (kartu pendamping yang ikut tertulis oleh kartu lain sudah ditutup). Kartu yang tertulis dikabarkan
 * SEKALI di akhir: satu push AUTO_APPLIED + satu kabar tamu untuk semuanya (satu pesan tamu = satu "Noted").
 */
export async function autoApplyCreated(events: BookingPushEvent[]): Promise<void> {
  const applied: AppliedBatch[] = []
  for (const event of events) {
    try {
      const outcome = await autoApplyIfAllowed(event.actionId, event, applied)
      if (outcome !== 'skipped') continue
      const row = await prisma.bookingAction.findUnique({ where: { id: event.actionId }, select: { state: true } })
      if (row?.state === 'OPEN') void notifyBookingAction(event)
    } catch {
      // Sabuk pengaman; kabar yang gagal dibaca tidak boleh menghentikan kartu lain.
    }
  }
  if (applied.length > 0) await announceApplied(applied)
}

/** "Sudah sesuai" ke tamu untuk kartu yang nilainya sudah ada di booking (tanpa push admin; tidak ada yang ditulis). */
async function announceMatched(conversationId: string, bookingId: string | null, matched: AppliedCard[]): Promise<void> {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { bookingData: true } })
  const booking = asBooking(conv?.bookingData)
  if (!booking) return
  const items: GuestNoticeItem[] = matched.flatMap((c) => {
    const value = nonBlank(c.proposedValue)
    return value === null ? [] : [{ actionId: c.id, sourceMessageId: c.sourceMessageId, written: [{ field: c.field as FieldKey, value }] }]
  })
  await notifyGuestOfUpdate({ conversationId, bookingId, accountId: null, booking, items, variant: 'matched' })
}
