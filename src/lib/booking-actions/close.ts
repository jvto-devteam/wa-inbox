import { prisma } from '@/lib/db'
import { recordEvent } from '@/lib/booking-actions/history'
import { broadcast } from '@/lib/realtime'

/**
 * Menutup satu kartu booking oleh orang (Tolak / Abaikan / Selesai / Tidak perlu). Dipakai `PATCH
 * /api/booking-actions/[id]` dan obrolan Samsul di Kantor AI, supaya keduanya lewat jalur yang sama.
 * `closedById` WAJIB terisi: store.ts tidak membuat ulang aksi yang ditutup orang untuk field+nilai yang sama.
 */
export type CloseOp = 'reject' | 'dismiss' | 'done' | 'not_needed'

export const CLOSE_OUTCOME: Record<CloseOp, { state: string; closedReason: string; event: 'REJECTED' | 'RESOLVED'; types: readonly string[] }> = {
  reject: { state: 'REJECTED', closedReason: 'REJECTED', event: 'REJECTED', types: ['CHANGE', 'DATA_REQUEST'] },
  dismiss: { state: 'RESOLVED', closedReason: 'DISMISSED_CHAT_WRONG', event: 'RESOLVED', types: ['MISMATCH'] },
  done: { state: 'DONE', closedReason: 'MARKED_DONE', event: 'RESOLVED', types: ['CHANGE', 'TASK'] },
  not_needed: { state: 'DONE', closedReason: 'NOT_NEEDED', event: 'RESOLVED', types: ['CHANGE', 'TASK'] },
}

export type CloseResult =
  | { status: 200; body: { ok: true; state: string }; conversationId: string }
  | { status: 400 | 404 | 409; body: { error: string } }

export async function closeBookingAction(input: { actionId: string; op: CloseOp; accountId: string; text: string | null }): Promise<CloseResult> {
  const { actionId: id, op, accountId, text } = input
  const action = await prisma.bookingAction.findUnique({ where: { id } })
  if (!action) return { status: 404, body: { error: 'Tindakan tidak ditemukan' } }
  if (action.state !== 'OPEN') return { status: 409, body: { error: 'Tindakan sudah ditutup' } }

  const outcome = CLOSE_OUTCOME[op]
  if (!outcome.types.includes(action.type)) return { status: 400, body: { error: 'Operasi tidak cocok dengan jenis tindakan' } }

  const closed = await prisma.$transaction(async (tx) => {
    // Bersyarat pada state OPEN: dua klik bersamaan tidak sama-sama lolos.
    const res = await tx.bookingAction.updateMany({
      where: { id, state: 'OPEN' },
      data: { state: outcome.state, closedReason: outcome.closedReason, closedById: accountId, closedAt: new Date() },
    })
    if (res.count === 0) return false
    await recordEvent(tx, {
      conversationId: action.conversationId,
      bookingId: action.bookingId,
      actionId: action.id,
      event: outcome.event,
      actor: 'ACCOUNT',
      accountId,
      reason: text,
    })
    return true
  })
  if (!closed) return { status: 409, body: { error: 'Tindakan sudah ditutup' } }

  broadcast({ type: 'booking-actions.changed', conversationId: action.conversationId })
  return { status: 200, body: { ok: true, state: outcome.state }, conversationId: action.conversationId }
}
