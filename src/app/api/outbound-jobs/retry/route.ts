import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { requeueJob } from '@/lib/outbound/queue'
import { processOutboundJob } from '@/lib/outbound/worker'

/**
 * POST /api/outbound-jobs/retry — re-send a message whose delivery failed.
 *
 * Open to any signed-in user, not admin-only: retrying is how an AGENT recovers their own
 * failed message to a customer they are actively talking to, and routing that through an admin
 * would make a transient provider blip a support ticket.
 *
 * Takes a `messageId` rather than a job id, because that is what the inbox bubble actually
 * has. It never creates a second Message — guidebook §16.2 is explicit that a retry must not
 * duplicate the bubble unless the operator deliberately chooses to send a new message.
 */
const bodySchema = z.object({ messageId: z.string().min(1) })

export async function POST(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const parsed = await parseJsonBody(req, bodySchema, 'Data retry tidak valid')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    // Newest job for this message: a message retried before has more than one.
    const job = await prisma.outboundJob.findFirst({
      where: { messageId: parsed.data.messageId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    })

    if (!job) {
      // A message sent down the direct Official path has no job at all. Saying so is better
      // than a generic failure that leaves an agent pressing the button again.
      return NextResponse.json(
        { error: 'Pesan ini tidak punya antrean pengiriman — kirim ulang sebagai pesan baru.' },
        { status: 404 }
      )
    }

    if (!(await requeueJob(job.id))) {
      return NextResponse.json({ error: 'Pengiriman ini sedang diproses atau sudah berhasil.' }, { status: 409 })
    }

    // Put the bubble back to PENDING immediately so the agent sees the retry take effect
    // rather than staring at a red FAILED badge while the attempt runs.
    await prisma.message.update({ where: { id: parsed.data.messageId }, data: { deliveryStatus: 'PENDING' } })

    // Fire the attempt without awaiting, for the same reason sendMessage does: the response
    // should not block on a provider round-trip.
    void processOutboundJob(job.id).catch((error: unknown) => {
      console.error('retry: percobaan gagal dijadwalkan', { jobId: job.id, error })
    })

    return NextResponse.json({ ok: true, jobId: job.id })
  } catch (error) {
    console.error('POST /api/outbound-jobs/retry gagal', error)
    return NextResponse.json({ error: 'Gagal mengirim ulang' }, { status: 500 })
  }
}
