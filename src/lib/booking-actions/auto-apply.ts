/**
 * Terapkan otomatis (Task 11b): kartu CHANGE yang baru dibuat langsung ditulis ke backoffice TANPA klik,
 * bila admin menyetel kelompoknya `ALWAYS` di Pengaturan -> Persetujuan perubahan booking. Ini menulis booking
 * produksi tanpa manusia, jadi semua keputusan di sini condong ke "serahkan ke orang":
 *
 *   tier AI   -> Settings.bookingLightApproval          tier BALI -> Settings.bookingBaliApproval
 *   tier HEAVY, tipe TASK/MISMATCH/DATA_REQUEST, field tanpa jalur tulis (note/*_arrival, R16) -> 'skipped'
 *   setelan bukan persis 'ALWAYS' (APPROVE, kosong, galat baca) -> 'skipped'
 *   kartu pendamping titik<->detail (R17) yang kelompoknya tidak ALWAYS -> 'skipped' (satu patch menulis keduanya)
 *   kartu titik tanpa detail yang bisa dipakai (booking sudah punya detail, tak ada kartu detail) -> 'skipped',
 *     tetap OPEN untuk manusia, TANPA push gagal (klien akan menolak "Isi detail titik baru dulu")
 *
 * Eksekusinya `executeBookingAction` yang SAMA dengan tombol Setujui (actor SYSTEM, tanpa akun, closedReason
 * AUTO_APPLIED): klaim, penulisan, event EXECUTED, kabar vendor Bali. Gagal = kartu kembali OPEN + event
 * EXECUTE_FAILED (ditulis inti) + push EXECUTE_FAILED. Sukses = push AUTO_APPLIED dengan `tag` yang sama dengan push
 * CHANGE kartu itu (`booking-action:<id>`), sehingga menggantikan notifikasi "Permintaan perubahan" di perangkat.
 * Tidak pernah melempar.
 */
import { prisma } from '@/lib/db'
import type { BookingData } from '@/lib/booking/client'
import { notifyBookingAction, summarizeAction } from '@/lib/push/send'
import { executeBookingAction } from './execute'
import { readBookingField, type FieldKey } from './fields'
import { currentBookingId } from './scope'
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
  | { go: true; action: { field: string; proposedValue: unknown; sourceMessageId: string | null; conversationId: string }; code: string | null }
> {
  const action = await prisma.bookingAction.findUnique({ where: { id: actionId } })
  if (!action || action.type !== 'CHANGE' || action.state !== 'OPEN') return { go: false }
  if (action.tier === 'HEAVY' || !canExecuteField(action.field)) return { go: false }
  const modes = await loadModes()
  if (modeOf(modes, action.tier) !== 'ALWAYS') return { go: false }
  const value = nonBlank(action.proposedValue)
  if (value === null) return { go: false }

  const conv = await prisma.conversation.findUnique({ where: { id: action.conversationId }, select: { bookingData: true } })
  const booking = asBooking(conv?.bookingData)
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
  return { go: true, action, code: bookingCode(booking) }
}

export async function autoApplyIfAllowed(actionId: string): Promise<AutoApplyOutcome> {
  try {
    const d = await decide(actionId)
    if (!d.go) return 'skipped'
    const { action, code } = d
    const value = nonBlank(action.proposedValue)

    const res = await executeBookingAction({ actionId, accountId: null, actor: 'SYSTEM', closedReason: 'AUTO_APPLIED' })
    if (res.status === 200) {
      // Satu push per kartu yang ikut ditulis, bertag sama dengan push CHANGE-nya.
      const rows = (await prisma.bookingAction.findMany({
        where: { id: { in: res.body.executed } },
        select: { id: true, field: true, proposedValue: true, sourceMessageId: true },
      })) ?? []
      for (const r of rows) {
        void notifyBookingAction({
          kind: 'AUTO_APPLIED',
          conversationId: action.conversationId,
          bookingCode: code,
          summary: summarizeAction(r.field, nonBlank(r.proposedValue)),
          actionId: r.id,
          messageId: r.sourceMessageId,
        })
      }
      return 'applied'
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
    return 'failed'
  }
}

/** Satu per satu (tidak paralel): kartu yang berbagi booking tidak boleh menulis bersamaan. Tidak pernah melempar. */
export async function autoApplyCreated(actionIds: string[]): Promise<void> {
  for (const id of actionIds) {
    try {
      await autoApplyIfAllowed(id)
    } catch {
      // autoApplyIfAllowed sendiri tidak melempar; ini sabuk pengaman.
    }
  }
}
