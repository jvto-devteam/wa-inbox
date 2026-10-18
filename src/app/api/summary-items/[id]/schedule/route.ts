import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { SUMMARY_ITEM_INCLUDE, toSummaryItemView } from '@/lib/summary-items/view'

/**
 * POST /api/summary-items/[id]/schedule — jadwalkan tindak lanjut: buat (atau perbarui) Reminder
 * untuk kontaknya dan pindahkan item ke SCHEDULED. Tidak mengirim pesan apa pun ke pelanggan.
 */
const MAX_AHEAD_MS = 90 * 24 * 60 * 60 * 1000

const bodySchema = z.object({
  dueAt: z.iso.datetime({ offset: true }),
  note: z.string().trim().min(1).max(500),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { id } = await params
    const parsed = await parseJsonBody(req, bodySchema, 'Tanggal dan catatan wajib diisi (catatan 1-500 karakter)')
    if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const dueAt = new Date(parsed.data.dueAt)
    const now = Date.now()
    if (dueAt.getTime() <= now) {
      return NextResponse.json({ error: 'Waktu jadwal harus di masa depan' }, { status: 400 })
    }
    if (dueAt.getTime() > now + MAX_AHEAD_MS) {
      return NextResponse.json({ error: 'Waktu jadwal maksimal 90 hari ke depan' }, { status: 400 })
    }

    const item = await prisma.summaryItem.findUnique({ where: { id }, include: { conversation: { select: { contactId: true } } } })
    if (!item) return NextResponse.json({ error: 'Item tidak ditemukan' }, { status: 404 })
    if (item.state !== 'OPEN' && item.state !== 'SCHEDULED') {
      return NextResponse.json({ error: 'Item sudah selesai' }, { status: 409 })
    }

    const note = parsed.data.note
    const updated = await prisma.$transaction(async (tx) => {
      const existing = item.reminderId ? await tx.reminder.findUnique({ where: { id: item.reminderId } }) : null
      const reminder =
        existing && !existing.done
          ? await tx.reminder.update({ where: { id: existing.id }, data: { dueAt, note } })
          : await tx.reminder.create({ data: { contactId: item.conversation.contactId, dueAt, note } })

      return tx.summaryItem.update({
        where: { id },
        data: { state: 'SCHEDULED', reminderId: reminder.id, dueAt },
        include: SUMMARY_ITEM_INCLUDE,
      })
    })

    return NextResponse.json(toSummaryItemView(updated))
  } catch (err) {
    console.error('POST /api/summary-items/[id]/schedule failed', err)
    return NextResponse.json({ error: 'Gagal menjadwalkan item' }, { status: 500 })
  }
}
