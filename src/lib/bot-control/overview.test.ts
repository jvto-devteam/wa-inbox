import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { collectOverview, startOfDayInJakarta } from './overview'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

// Prisma's `groupBy` is a heavily overloaded generic, so vitest-mock-extended cannot surface a
// mock through the type system even though the runtime object is one. Same handle as
// documentation-exporter.test.ts uses for the identical problem.
const groupByMock = mockPrisma.knowledgeGapLog.groupBy as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockReset(mockPrisma)
  mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({
    botAutoReplyAll: true,
    defaultChannel: 'UNOFFICIAL',
  } as never)
  mockPrisma.waNumber.count.mockResolvedValue(1 as never)
  mockPrisma.knowledgeSource.count.mockResolvedValue(32 as never)
  mockPrisma.botDecisionRun.count.mockResolvedValue(0 as never)
  mockPrisma.knowledgeGapLog.count.mockResolvedValue(0 as never)
  mockPrisma.outboundJob.count.mockResolvedValue(0 as never)
  mockPrisma.botDecisionRun.findMany.mockResolvedValue([] as never)
  groupByMock.mockResolvedValue([])
  mockPrisma.outboundJob.findMany.mockResolvedValue([] as never)
  mockPrisma.conversation.findMany.mockResolvedValue([] as never)
})

describe('startOfDayInJakarta', () => {
  it('returns the most recent WIB midnight, expressed as an instant', () => {
    // 09:00 WIB on 6 Sep -> the day began at 00:00 WIB, which is 17:00Z on 5 Sep.
    expect(startOfDayInJakarta(new Date('2026-09-06T02:00:00.000Z')).toISOString()).toBe('2026-09-05T17:00:00.000Z')
  })

  it('does not roll the day over at UTC midnight', () => {
    // 23:00Z is already 06:00 WIB the NEXT day. A naive UTC-midnight boundary would report
    // "today" as the previous WIB day here, so every morning before 07:00 WIB the counters
    // would still be showing yesterday's traffic.
    const early = startOfDayInJakarta(new Date('2026-09-05T23:00:00.000Z'))
    expect(early.toISOString()).toBe('2026-09-05T17:00:00.000Z')
    expect(early.toISOString()).not.toBe('2026-09-05T00:00:00.000Z')
  })

  it('holds the boundary steady across a whole WIB day', () => {
    const justAfterMidnight = startOfDayInJakarta(new Date('2026-09-05T17:00:01.000Z'))
    const justBeforeNextMidnight = startOfDayInJakarta(new Date('2026-09-06T16:59:59.000Z'))
    expect(justAfterMidnight.toISOString()).toBe(justBeforeNextMidnight.toISOString())
  })
})

describe('collectOverview', () => {
  it('maps the nine cards from settings, credential presence, and counts', async () => {
    mockPrisma.botDecisionRun.count.mockResolvedValueOnce(41 as never).mockResolvedValueOnce(6 as never)
    mockPrisma.knowledgeGapLog.count.mockResolvedValue(3 as never)
    mockPrisma.outboundJob.count.mockResolvedValue(2 as never)

    const { cards } = await collectOverview(new Date('2026-09-06T02:00:00.000Z'))

    expect(cards).toEqual({
      botMode: 'ON',
      outboundDefault: 'UNOFFICIAL',
      officialWebhook: 'ACTIVE',
      unofficialProvider: 'CONFIGURED',
      knowledgeSources: 32,
      botRunsToday: 41,
      handoffToday: 6,
      knowledgeGapsToday: 3,
      failedOutboundJobs: 2,
    })
  })

  it('reports an unconfigured channel rather than assuming one is set up', async () => {
    mockPrisma.waNumber.count.mockResolvedValue(0 as never)
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({
      botAutoReplyAll: false,
      defaultChannel: 'OFFICIAL',
    } as never)

    const { cards } = await collectOverview()

    expect(cards.officialWebhook).toBe('INACTIVE')
    expect(cards.unofficialProvider).toBe('UNCONFIGURED')
    expect(cards.botMode).toBe('OFF')
    expect(cards.outboundDefault).toBe('OFFICIAL')
  })

  it('never loads the WhatsApp credentials it reports on', async () => {
    await collectOverview()

    // The presence of a token is answered with a COUNT in the database. Reading the rows and
    // checking the strings here would put the Meta access token and the wa-coexist API key
    // into a request whose response is rendered in a browser.
    expect(mockPrisma.waNumber.count).toHaveBeenCalled()
    expect(mockPrisma.waNumber.findFirst).not.toHaveBeenCalled()
    expect(mockPrisma.waNumber.findFirstOrThrow).not.toHaveBeenCalled()
    expect(mockPrisma.waNumber.findMany).not.toHaveBeenCalled()
  })

  it('selects Settings columns explicitly, so a future secret column cannot leak in', async () => {
    await collectOverview()

    expect(mockPrisma.settings.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 1 },
      select: { botAutoReplyAll: true, defaultChannel: true },
    })
  })

  it('counts only today, in WIB, for the per-day cards', async () => {
    await collectOverview(new Date('2026-09-06T02:00:00.000Z'))

    const [runsToday] = mockPrisma.botDecisionRun.count.mock.calls[0]
    expect(runsToday).toEqual({ where: { startedAt: { gte: new Date('2026-09-05T17:00:00.000Z') } } })
  })

  it('resolves contact names for both widgets in ONE extra query', async () => {
    mockPrisma.botDecisionRun.findMany.mockResolvedValue([
      {
        id: 'run_1',
        conversationId: 'conv_1',
        status: 'HANDOFF',
        inboundText: 'saya mau bicara dengan orang',
        startedAt: new Date('2026-09-06T01:00:00.000Z'),
      },
    ] as never)
    mockPrisma.outboundJob.findMany.mockResolvedValue([
      {
        id: 'job_1',
        conversationId: 'conv_2',
        channel: 'UNOFFICIAL',
        provider: 'COEXIST',
        attempts: 4,
        maxAttempts: 4,
        lastError: 'connect ECONNREFUSED',
        createdAt: new Date('2026-09-06T00:30:00.000Z'),
      },
    ] as never)
    mockPrisma.conversation.findMany.mockResolvedValue([
      { id: 'conv_1', contact: { name: 'Bruno Figarola' } },
      { id: 'conv_2', contact: { name: 'Sanne de Vries' } },
    ] as never)

    const overview = await collectOverview()

    expect(mockPrisma.conversation.findMany).toHaveBeenCalledTimes(1)
    expect(overview.latestDecisions[0]).toMatchObject({ id: 'run_1', contactName: 'Bruno Figarola', status: 'HANDOFF' })
    expect(overview.recentFailedSends[0]).toMatchObject({
      id: 'job_1',
      contactName: 'Sanne de Vries',
      attempts: 4,
      lastError: 'connect ECONNREFUSED',
    })
  })

  it('reports a deleted conversation as an unknown contact instead of an empty name', async () => {
    mockPrisma.botDecisionRun.findMany.mockResolvedValue([
      {
        id: 'run_1',
        conversationId: 'gone',
        status: 'REPLIED',
        inboundText: 'halo',
        startedAt: new Date('2026-09-06T01:00:00.000Z'),
      },
    ] as never)

    const overview = await collectOverview()

    expect(overview.latestDecisions[0].contactName).toBeNull()
  })

  it('skips the contact lookup entirely when both widgets are empty', async () => {
    await collectOverview()
    expect(mockPrisma.conversation.findMany).not.toHaveBeenCalled()
  })

  it('flattens the grouped gap counts into topic/count pairs', async () => {
    groupByMock.mockResolvedValue([
      { topic: 'asuransi', _count: { topic: 9 } },
      { topic: 'transport_bandara', _count: { topic: 4 } },
    ])

    const overview = await collectOverview()

    expect(overview.topUnansweredTopics).toEqual([
      { topic: 'asuransi', count: 9 },
      { topic: 'transport_bandara', count: 4 },
    ])
  })
})
