import { prisma } from '@/lib/db'

/**
 * The data behind Bot Control Overview (guidebook §18.1): nine status cards and three of the
 * four widgets. The fourth, the channel capability summary, is a static matrix rendered
 * client-side from `channel-capabilities.ts` and needs no query.
 *
 * Everything here READS. The overview must never be able to change what it reports on.
 */

const INBOUND_PREVIEW_LENGTH = 90
const LATEST_DECISIONS = 10
const TOP_TOPICS = 5
const RECENT_FAILED_SENDS = 5

/** How far back "top unanswered topics" looks. A gap from two months ago is history, not a queue. */
export const UNANSWERED_TOPIC_WINDOW_DAYS = 7

/**
 * WIB is a fixed +07:00 with no daylight saving, so the shift is arithmetic rather than a
 * timezone library.
 *
 * The offset matters: the operators reading this page are in Jakarta, and on a VPS running UTC
 * a naive local midnight would roll "today" over at 07:00 WIB. Every morning between midnight
 * and 7am, "Bot runs today" would still be counting yesterday's traffic -- the kind of quietly
 * wrong number that makes an operator stop trusting the whole page.
 */
export function startOfDayInJakarta(now: Date = new Date()): Date {
  const WIB_OFFSET_MS = 7 * 60 * 60 * 1000
  const shifted = new Date(now.getTime() + WIB_OFFSET_MS)
  shifted.setUTCHours(0, 0, 0, 0)
  return new Date(shifted.getTime() - WIB_OFFSET_MS)
}

export type OverviewCards = {
  botMode: 'ON' | 'OFF'
  /** Guidebook §3 wants UNOFFICIAL here; the card shows what is actually configured. */
  outboundDefault: 'OFFICIAL' | 'UNOFFICIAL'
  officialWebhook: 'ACTIVE' | 'INACTIVE'
  unofficialProvider: 'CONFIGURED' | 'UNCONFIGURED'
  knowledgeSources: number
  botRunsToday: number
  handoffToday: number
  knowledgeGapsToday: number
  failedOutboundJobs: number
}

export type OverviewDecision = {
  id: string
  conversationId: string
  contactName: string | null
  status: string
  inboundPreview: string
  startedAt: string
}

export type OverviewTopic = { topic: string; count: number }

export type OverviewFailedSend = {
  id: string
  conversationId: string
  contactName: string | null
  channel: string
  provider: string
  attempts: number
  maxAttempts: number
  lastError: string | null
  createdAt: string
}

export type BotControlOverview = {
  cards: OverviewCards
  latestDecisions: OverviewDecision[]
  topUnansweredTopics: OverviewTopic[]
  recentFailedSends: OverviewFailedSend[]
  generatedAt: string
}

export async function collectOverview(now: Date = new Date()): Promise<BotControlOverview> {
  const since = startOfDayInJakarta(now)
  const topicsSince = new Date(now.getTime() - UNANSWERED_TOPIC_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  const [
    settings,
    officialConfigured,
    unofficialConfigured,
    knowledgeSources,
    botRunsToday,
    handoffToday,
    knowledgeGapsToday,
    failedOutboundJobs,
    decisions,
    topics,
    failedSends,
  ] = await Promise.all([
    prisma.settings.findUniqueOrThrow({
      where: { id: 1 },
      // Explicit, so that a credential column added to Settings later cannot ride along into
      // a response this page renders in the browser.
      select: { botAutoReplyAll: true, defaultChannel: true },
    }),
    // Counted rather than read. `WaNumber` holds the Meta access token and the wa-coexist API
    // key, and the only thing this page needs to know is whether they are set -- so the answer
    // is computed in the database and the secrets never enter this process at all.
    prisma.waNumber.count({ where: { accessToken: { not: '' }, phoneNumberId: { not: '' } } }),
    prisma.waNumber.count({
      where: { coexistBaseUrl: { not: '' }, coexistApiKey: { not: '' }, coexistNumberKey: { not: '' } },
    }),
    prisma.knowledgeSource.count({ where: { status: { not: 'ARCHIVED' } } }),
    prisma.botDecisionRun.count({ where: { startedAt: { gte: since } } }),
    prisma.botDecisionRun.count({ where: { status: 'HANDOFF', startedAt: { gte: since } } }),
    prisma.knowledgeGapLog.count({ where: { createdAt: { gte: since } } }),
    prisma.outboundJob.count({ where: { status: 'FAILED' } }),
    prisma.botDecisionRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: LATEST_DECISIONS,
      select: { id: true, conversationId: true, status: true, inboundText: true, startedAt: true },
    }),
    prisma.knowledgeGapLog.groupBy({
      by: ['topic'],
      where: { createdAt: { gte: topicsSince } },
      _count: { topic: true },
      orderBy: { _count: { topic: 'desc' } },
      take: TOP_TOPICS,
    }),
    prisma.outboundJob.findMany({
      where: { status: 'FAILED' },
      orderBy: { updatedAt: 'desc' },
      take: RECENT_FAILED_SENDS,
      select: {
        id: true,
        conversationId: true,
        channel: true,
        provider: true,
        attempts: true,
        maxAttempts: true,
        lastError: true,
        createdAt: true,
      },
    }),
  ])

  // One lookup for both widgets rather than one per row: BotDecisionRun has no foreign key to
  // Conversation on purpose (an audit row outlives what it describes), so the contact cannot
  // be `include`d and a per-row query would be fifteen round-trips for a decorative column.
  const conversationIds = [
    ...new Set([...decisions.map((d) => d.conversationId), ...failedSends.map((j) => j.conversationId)]),
  ]
  const conversations =
    conversationIds.length === 0
      ? []
      : await prisma.conversation.findMany({
          where: { id: { in: conversationIds } },
          select: { id: true, contact: { select: { name: true } } },
        })
  const nameByConversation = new Map(conversations.map((c) => [c.id, c.contact?.name ?? null]))

  return {
    cards: {
      botMode: settings.botAutoReplyAll ? 'ON' : 'OFF',
      outboundDefault: settings.defaultChannel,
      officialWebhook: officialConfigured > 0 ? 'ACTIVE' : 'INACTIVE',
      unofficialProvider: unofficialConfigured > 0 ? 'CONFIGURED' : 'UNCONFIGURED',
      knowledgeSources,
      botRunsToday,
      handoffToday,
      knowledgeGapsToday,
      failedOutboundJobs,
    },
    latestDecisions: decisions.map((run) => ({
      id: run.id,
      conversationId: run.conversationId,
      // Null when the conversation has since been deleted -- saying so beats an empty cell
      // that reads like a bug.
      contactName: nameByConversation.get(run.conversationId) ?? null,
      status: run.status,
      inboundPreview: run.inboundText.slice(0, INBOUND_PREVIEW_LENGTH),
      startedAt: run.startedAt.toISOString(),
    })),
    topUnansweredTopics: topics.map((row) => ({ topic: row.topic, count: row._count.topic })),
    recentFailedSends: failedSends.map((job) => ({
      id: job.id,
      conversationId: job.conversationId,
      contactName: nameByConversation.get(job.conversationId) ?? null,
      channel: job.channel,
      provider: job.provider,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      lastError: job.lastError,
      createdAt: job.createdAt.toISOString(),
    })),
    generatedAt: now.toISOString(),
  }
}
