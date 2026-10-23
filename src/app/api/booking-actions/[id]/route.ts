import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/get-session'
import { closeBookingAction } from '@/lib/booking-actions/close'
import { executeBookingAction, revertBookingAction } from '@/lib/booking-actions/execute'
import { sendDataRequest } from '@/lib/booking-actions/data-requests'

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
// Task 12: kirim draf permintaan data (DATA_REQUEST) ke tamu sekarang; diperiksa di sendDataRequest.
const sendSchema = z.object({ op: z.literal('send') })
const bodySchema = z.union([closeSchema, executeSchema, revertSchema, sendSchema])

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
    if (body.op === 'send') {
      const result = await sendDataRequest({ actionId: id, accountId: session.accountId })
      return result.ok
        ? NextResponse.json({ ok: true, state: 'DONE' })
        : NextResponse.json({ error: result.error }, { status: result.status })
    }
    if (body.op === 'revert') {
      const result = await revertBookingAction({ actionId: id, accountId: session.accountId })
      return NextResponse.json(result.body, { status: result.status })
    }
    const text = body.op === 'reject' || body.op === 'dismiss' ? body.reason : body.note

    const result = await closeBookingAction({ actionId: id, op: body.op, accountId: session.accountId, text: text ?? null })
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    // Nama/kode saja: pesan galat Prisma bisa memuat argumen (teks tamu, alasan admin).
    console.error('PATCH booking-action gagal', { error: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ error: 'Gagal memperbarui tindakan booking' }, { status: 500 })
  }
}
