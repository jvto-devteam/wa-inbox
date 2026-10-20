import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { recordEvent } from '@/lib/booking-actions/history'
import { broadcast } from '@/lib/realtime'
import { executeBookingAction, revertBookingAction } from '@/lib/booking-actions/execute'

/**
 * Tutup/tolak/eksekusi satu tindakan booking dari Inbox. Terbuka untuk semua akun yang login (keputusan
 * owner 2026-10-19; pengecualian hasAdminPowers dicatat di CLAUDE.md §6 pada Task 13).
 * `closedById` WAJIB terisi: store.ts tidak membuat ulang aksi yang ditutup orang untuk field+nilai
 * yang sama.
 *
 * `revert` (Task 11b, "Batalkan") menulis balik nilai lama sebuah aksi EXECUTED; `lib/booking-actions/execute.ts`.
 * `execute` (Task 10/11) MENULIS ke backoffice produksi; seluruh alurnya di `lib/booking-actions/execute.ts`.
 */
const closeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('reject'), reason: z.string().max(500).optional() }),
  z.object({ op: z.literal('dismiss'), reason: z.string().max(500).optional() }),
  z.object({ op: z.literal('done'), note: z.string().max(500).optional() }),
  z.object({ op: z.literal('not_needed'), note: z.string().max(500).optional() }),
])
// `detail` (R19) hanya untuk kartu titik; diperiksa di execute.ts (butuh jenis field aksi).
const executeSchema = z.object({
  op: z.literal('execute'),
  value: z.string().max(300).optional(),
  detail: z.string().max(300).optional(),
})
// Task 11b: "Batalkan" hanya untuk aksi EXECUTED (diperiksa di revertBookingAction).
const revertSchema = z.object({ op: z.literal('revert') })
const bodySchema = z.union([closeSchema, executeSchema, revertSchema])

type Op = z.infer<typeof closeSchema>['op']

const OUTCOME: Record<Op, { state: string; closedReason: string; event: 'REJECTED' | 'RESOLVED'; types: readonly string[] }> = {
  reject: { state: 'REJECTED', closedReason: 'REJECTED', event: 'REJECTED', types: ['CHANGE', 'DATA_REQUEST'] },
  dismiss: { state: 'RESOLVED', closedReason: 'DISMISSED_CHAT_WRONG', event: 'RESOLVED', types: ['MISMATCH'] },
  done: { state: 'DONE', closedReason: 'MARKED_DONE', event: 'RESOLVED', types: ['CHANGE', 'TASK'] },
  not_needed: { state: 'DONE', closedReason: 'NOT_NEEDED', event: 'RESOLVED', types: ['CHANGE', 'TASK'] },
}

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const session = await getSession(req)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params

    let json: unknown
    try {
      json = await req.json()
    } catch {
      return NextResponse.json({ error: 'Body tidak valid' }, { status: 400 })
    }
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) return NextResponse.json({ error: 'Body tidak valid' }, { status: 400 })
    const body = parsed.data
    if (body.op === 'execute') {
      const result = await executeBookingAction({ actionId: id, accountId: session.accountId, value: body.value, detail: body.detail })
      return NextResponse.json(result.body, { status: result.status })
    }
    if (body.op === 'revert') {
      const result = await revertBookingAction({ actionId: id, accountId: session.accountId })
      return NextResponse.json(result.body, { status: result.status })
    }
    const text = body.op === 'reject' || body.op === 'dismiss' ? body.reason : body.note

    const action = await prisma.bookingAction.findUnique({ where: { id } })
    if (!action) return NextResponse.json({ error: 'Tindakan tidak ditemukan' }, { status: 404 })
    if (action.state !== 'OPEN') return NextResponse.json({ error: 'Tindakan sudah ditutup' }, { status: 409 })

    const outcome = OUTCOME[body.op]
    if (!outcome.types.includes(action.type)) {
      return NextResponse.json({ error: 'Operasi tidak cocok dengan jenis tindakan' }, { status: 400 })
    }

    const closed = await prisma.$transaction(async (tx) => {
      // Bersyarat pada state OPEN: dua klik bersamaan tidak sama-sama lolos.
      const res = await tx.bookingAction.updateMany({
        where: { id, state: 'OPEN' },
        data: { state: outcome.state, closedReason: outcome.closedReason, closedById: session.accountId, closedAt: new Date() },
      })
      if (res.count === 0) return false
      await recordEvent(tx, {
        conversationId: action.conversationId,
        bookingId: action.bookingId,
        actionId: action.id,
        event: outcome.event,
        actor: 'ACCOUNT',
        accountId: session.accountId,
        reason: text ?? null,
      })
      return true
    })
    if (!closed) return NextResponse.json({ error: 'Tindakan sudah ditutup' }, { status: 409 })

    broadcast({ type: 'booking-actions.changed', conversationId: action.conversationId })
    return NextResponse.json({ ok: true, state: outcome.state })
  } catch (error) {
    console.error('PATCH booking-action gagal', error)
    return NextResponse.json({ error: 'Gagal memperbarui tindakan booking' }, { status: 500 })
  }
}
