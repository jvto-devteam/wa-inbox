import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'

/** POST /api/summary-items/[id]/drop — lepaskan item dari antrean (tidak perlu ditindaklanjuti). */
const bodySchema = z.object({
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : null)),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { id } = await params
    const parsed = await parseJsonBody(req, bodySchema, 'Catatan maksimal 500 karakter')
    if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const item = await prisma.summaryItem.findUnique({ where: { id } })
    if (!item) return NextResponse.json({ error: 'Item tidak ditemukan' }, { status: 404 })
    if (item.state !== 'OPEN' && item.state !== 'SCHEDULED') {
      return NextResponse.json({ error: 'Item sudah selesai' }, { status: 409 })
    }

    await prisma.$transaction(async (tx) => {
      await tx.summaryItem.update({
        where: { id },
        data: {
          state: 'DROPPED',
          closedReason: 'DROPPED',
          note: parsed.data.note,
          closedById: session.accountId,
          closedAt: new Date(),
        },
      })
      if (item.reminderId) {
        await tx.reminder.updateMany({ where: { id: item.reminderId, done: false }, data: { done: true } })
      }
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('POST /api/summary-items/[id]/drop failed', err)
    return NextResponse.json({ error: 'Gagal melepaskan item' }, { status: 500 })
  }
}
