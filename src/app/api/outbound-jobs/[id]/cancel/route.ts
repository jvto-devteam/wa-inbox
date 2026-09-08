import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { requireAdmin } from '@/lib/auth/require-admin'
import { parseJsonBody } from '@/lib/parse-json'
import { writeBotAuditLog } from '@/lib/bot-control/audit'
import { broadcast } from '@/lib/realtime'
import { withMediaUrl } from '@/lib/serialize-message'

/**
 * POST /api/outbound-jobs/[id]/cancel — stop a queued message from ever being sent.
 *
 * Admin-only, unlike retry. Retry is recovery — an agent re-sending their own failed message to
 * a customer they are talking to. Cancelling is the opposite: it decides that a message somebody
 * already composed will never arrive, and the customer is never told. That is a call about
 * someone else's conversation.
 *
 * A job already SENT is refused. Cancelling it would only mislead: the provider has the message
 * and the customer may already have read it, so flipping the row would make the queue describe a
 * send that did happen as one that did not.
 */
const CANCELLABLE = ['QUEUED', 'RETRYING', 'SENDING']

const bodySchema = z.object({ reason: z.string().trim().min(10).max(2000) })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req)
  if (!admin) {
    // getSession only to distinguish "not signed in" from "signed in without the role".
    const session = await getSession(req)
    return NextResponse.json(
      { error: session ? 'Hanya admin yang bisa membatalkan pengiriman' : 'Tidak terautentikasi' },
      { status: session ? 403 : 401 }
    )
  }

  const { id } = await params
  const parsed = await parseJsonBody(req, bodySchema, 'Alasan pembatalan wajib diisi, minimal 10 karakter')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const job = await prisma.outboundJob.findUnique({ where: { id } })
    if (!job) return NextResponse.json({ error: 'Job tidak ditemukan' }, { status: 404 })

    if (!CANCELLABLE.includes(job.status)) {
      return NextResponse.json(
        { error: `Job berstatus ${job.status} tidak bisa dibatalkan.` },
        { status: 409 }
      )
    }

    // Guarded, not a plain update: a worker may be finishing this very job. Cancelling a row it
    // has already flipped to SENT would describe a delivered message as cancelled.
    const cancelled = await prisma.outboundJob.updateMany({
      where: { id, status: { in: CANCELLABLE } },
      data: { status: 'CANCELLED', nextAttemptAt: null, lastError: `Dibatalkan admin: ${parsed.data.reason}` },
    })
    if (cancelled.count === 0) {
      return NextResponse.json({ error: 'Job sudah berubah status — muat ulang daftarnya.' }, { status: 409 })
    }

    // The bubble goes red, because from the customer's side nothing arrived. Leaving it PENDING
    // would leave an agent waiting for a delivery that is never coming.
    if (job.messageId) {
      const message = await prisma.message
        .update({ where: { id: job.messageId }, data: { deliveryStatus: 'FAILED' }, include: { replyTo: true } })
        .catch((error: unknown) => {
          console.error('cancel: gagal memperbarui status pesan', { messageId: job.messageId, error })
          return null
        })
      if (message) {
        broadcast({ type: 'message.updated', conversationId: job.conversationId, message: withMediaUrl(message) })
      }
    }

    // Kept even though it is one message rather than a setting: cancelling is irreversible and
    // the customer is never told, and the job row records the reason but not who decided.
    const actor = await prisma.account.findUnique({ where: { id: admin.accountId }, select: { name: true } })
    await writeBotAuditLog({
      action: 'DISABLE',
      entityType: 'OUTBOUND_JOB',
      entityId: job.id,
      entityKey: job.messageId ? `message:${job.messageId}` : `job:${job.id}`,
      actorId: admin.accountId,
      actorName: actor?.name ?? null,
      reason: parsed.data.reason,
    })

    return NextResponse.json({ id: job.id, status: 'CANCELLED' })
  } catch (error) {
    console.error('POST /api/outbound-jobs/[id]/cancel gagal', error)
    return NextResponse.json({ error: 'Gagal membatalkan pengiriman' }, { status: 500 })
  }
}
