import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { readPaging } from '@/lib/bot-control/paging'
import { STUCK_SENDING_MS } from '@/lib/outbound/worker'

/**
 * GET /api/outbound-jobs — the outbound queue, as an operator can actually see it.
 *
 * Until now the queue was write-only from a human's point of view: jobs were created, retried
 * and failed entirely in the background, and the ONLY window onto any of it was the delivery
 * badge on a single bubble in one conversation. A provider outage that failed forty messages
 * across thirty conversations was therefore invisible unless somebody opened all thirty.
 * SDD Manage Second §8.7 / §9.6 makes that queue a page; this is the data behind it.
 *
 * Read-only for any signed-in user, matching the rest of Bot Control (§19 of the Expose SDD)
 * and matching POST /api/outbound-jobs/retry, which an AGENT already uses to recover their own
 * failed message. The row deliberately carries no payload text: the message content is already
 * readable in the conversation itself, and duplicating it here would put every outbound
 * message body into a second, list-shaped surface for no operational gain.
 */

/** Statuses a job can hold. Anything else in the query string is a typo, not a filter. */
const JOB_STATUSES = ['QUEUED', 'SENDING', 'RETRYING', 'SENT', 'FAILED', 'CANCELLED'] as const
const JOB_CHANNELS = ['OFFICIAL', 'UNOFFICIAL'] as const
const JOB_PROVIDERS = ['COEXIST', 'META'] as const

type JobStatus = (typeof JOB_STATUSES)[number]
type JobChannel = (typeof JOB_CHANNELS)[number]

function isChannel(value: string): value is JobChannel {
  return (JOB_CHANNELS as readonly string[]).includes(value)
}

export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const url = new URL(req.url)
  const { page, limit, skip } = readPaging(url)

  const where: Prisma.OutboundJobWhereInput = {}
  const status = url.searchParams.get('status')?.trim()
  const channel = url.searchParams.get('channel')?.trim()
  const provider = url.searchParams.get('provider')?.trim()
  const conversationId = url.searchParams.get('conversationId')?.trim()

  // Validated against the known set rather than passed through: an unknown status would
  // silently return zero rows, which reads as "the queue is empty" — the single most
  // misleading thing this page could say.
  if (status && (JOB_STATUSES as readonly string[]).includes(status)) where.status = status
  // A type guard, not a cast: `channel` is a Prisma enum column, and asserting an arbitrary
  // query-string value into it would hand Postgres a value the enum has no member for.
  if (channel && isChannel(channel)) where.channel = channel
  if (provider && (JOB_PROVIDERS as readonly string[]).includes(provider)) where.provider = provider
  if (conversationId) where.conversationId = conversationId

  // SDD Manage Second §18.6 asks for a date filter alongside status. An unparseable date is
  // IGNORED rather than 400'd, matching the decisions endpoint: a half-typed value in a date
  // picker should show unfiltered rows, and an `Invalid Date` reaching Prisma would 500.
  const from = url.searchParams.get('dateFrom')?.trim()
  const to = url.searchParams.get('dateTo')?.trim()
  const range: Prisma.DateTimeFilter = {}
  const parsedFrom = from ? new Date(from) : null
  const parsedTo = to ? new Date(to) : null
  if (parsedFrom && !Number.isNaN(parsedFrom.getTime())) range.gte = parsedFrom
  if (parsedTo && !Number.isNaN(parsedTo.getTime())) range.lte = parsedTo
  if (range.gte !== undefined || range.lte !== undefined) where.createdAt = range

  // "Stuck" is not a stored status — it is a SENDING row that stopped moving. Surfacing it as
  // a filter is what lets an operator find the jobs that recover-stuck would act on BEFORE
  // pressing the button, rather than pressing it blind.
  const stuckOnly = url.searchParams.get('stuck') === 'true'
  if (stuckOnly) {
    where.status = 'SENDING'
    where.updatedAt = { lt: new Date(Date.now() - STUCK_SENDING_MS) }
  }

  try {
    const [jobs, total] = await Promise.all([
      prisma.outboundJob.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.outboundJob.count({ where }),
    ])

    // The summary cards (§9.6) count the WHOLE queue, not the filtered page: an operator who
    // has filtered to FAILED still needs to see how many are queued behind it.
    //
    // Six counts rather than one groupBy. The cardinality is fixed at six forever, each one is
    // an index scan (`@@index([status, nextAttemptAt])`), and they run in parallel — whereas
    // groupBy's generic signature cannot be typed through the test's Prisma mock, and the only
    // way to keep it would be casting the mock, which is exactly what this repo moved away from.
    const statusCounts = await Promise.all(
      JOB_STATUSES.map((jobStatus) => prisma.outboundJob.count({ where: { status: jobStatus } }))
    )
    const summary = Object.fromEntries(JOB_STATUSES.map((s, i) => [s, statusCounts[i]])) as Record<JobStatus, number>

    const conversationIds = [...new Set(jobs.map((job) => job.conversationId))]
    const conversations =
      conversationIds.length === 0
        ? []
        : await prisma.conversation.findMany({
            where: { id: { in: conversationIds } },
            select: { id: true, contact: { select: { name: true, phone: true } } },
          })
    const contactByConversation = new Map(conversations.map((c) => [c.id, c.contact]))

    return NextResponse.json({
      items: jobs.map((job) => {
        const contact = contactByConversation.get(job.conversationId)
        return {
          id: job.id,
          conversationId: job.conversationId,
          messageId: job.messageId,
          // Null once the conversation is deleted. Saying so beats an empty cell that reads
          // like a rendering bug.
          contactName: contact?.name ?? null,
          contactPhone: contact?.phone ?? null,
          channel: job.channel,
          provider: job.provider,
          status: job.status,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          nextAttemptAt: job.nextAttemptAt?.toISOString() ?? null,
          lastError: job.lastError,
          createdAt: job.createdAt.toISOString(),
          updatedAt: job.updatedAt.toISOString(),
        }
      }),
      summary,
      page,
      limit,
      total,
    })
  } catch (error) {
    console.error('GET /api/outbound-jobs gagal', error)
    return NextResponse.json({ error: 'Gagal memuat antrean pengiriman' }, { status: 500 })
  }
}
