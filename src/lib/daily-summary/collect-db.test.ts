/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

import { prisma } from '@/lib/db'
import { collectDay } from './collect'
import { jakartaDayRange } from './time'

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const { start, end } = jakartaDayRange('2026-09-21')

const contact = (name: string, phone: string) => ({ contact: { name, phone } })

beforeEach(() => {
  mockReset(mockPrisma)
  mockPrisma.conversation.findMany.mockImplementation((async (args: { select?: { isTest?: boolean } }) =>
    args.select?.isTest
      ? [
          { id: 'c-id', isTest: false, ...contact('Budi', '6281234567890') },
          { id: 'c-de', isTest: false, ...contact('Anna', '4915732300210') },
        ]
      : [
          { id: 'c-id', createdAt: start, pipelineStage: 'new', tripBrief: null, ...contact('Budi', '6281234567890') },
          { id: 'c-de', createdAt: start, pipelineStage: 'new', tripBrief: null, ...contact('Anna', '4915732300210') },
        ]) as never)
  ;(mockPrisma.message.groupBy as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([])
  mockPrisma.message.findMany.mockResolvedValue([])
  mockPrisma.botDecisionRun.findMany.mockResolvedValue([
    { id: 'r1', conversationId: 'c-id', startedAt: start, inboundText: 'x' },
    { id: 'r2', conversationId: 'c-de', startedAt: start, inboundText: 'y' },
  ] as never)
  mockPrisma.knowledgeGapLog.findMany.mockImplementation((async (args: { where?: { resolvedAt?: null } }) =>
    args.where && 'resolvedAt' in args.where
      ? [{ conversation: contact('Budi', '6281234567890') }, { conversation: contact('Anna', '4915732300210') }]
      : [
          { id: 'g1', conversationId: 'c-id', messageId: null, topic: 't', reason: 'r', messageText: 'm', conversation: contact('Budi', '6281234567890') },
          { id: 'g2', conversationId: 'c-de', messageId: null, topic: 't', reason: 'r', messageText: 'm', conversation: contact('Anna', '4915732300210') },
        ]) as never)
})

describe('collectDay — email otomatis', () => {
  // Newsletter, notifikasi bank, dan balasan mesin tidak butuh perhatian manusia -- tanpa
  // saringan ini setiap benang itu muncul sebagai "belum dibalas" dan memakan satu panggilan LLM.
  it('benang email bertanda otomatis tidak ikut dikumpulkan', async () => {
    await collectDay(start, end, { excludeIndonesian: false })
    const first = mockPrisma.conversation.findMany.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(first.where).toMatchObject({ isTest: false, mailAutomated: false })
  })
})

describe('collectDay — nomor Indonesia', () => {
  it('disaring dari percakapan, handoff, dan gap saat setelan chatbot aktif', async () => {
    const day = await collectDay(start, end, { excludeIndonesian: true })
    expect(day.conversations.map((c) => c.conversationId)).toEqual(['c-de'])
    expect(day.handoffRuns.map((r) => r.id)).toEqual(['r2'])
    expect(day.gaps.map((g) => g.id)).toEqual(['g2'])
    expect(day.openGapTotal).toBe(1)
  })

  it('tetap ikut saat setelan chatbot mati', async () => {
    const day = await collectDay(start, end, { excludeIndonesian: false })
    expect(day.conversations).toHaveLength(2)
    expect(day.handoffRuns).toHaveLength(2)
    expect(day.openGapTotal).toBe(2)
  })
})

describe('collectDay — kabar otomatis (review Important A/B)', () => {
  it('ditandai lewat SATU kueri id (filter JSON positif); transkrip tidak memuat botTrace', async () => {
    const q = { id: 'm1', direction: 'INBOUND', sentBy: 'CUSTOMER', type: 'text', content: 'Ijen?', createdAt: new Date(end.getTime() - 3 * 60 * 60 * 1000) }
    const n = { id: 'n1', direction: 'OUTBOUND', sentBy: 'BOT', type: 'text', content: 'Noted', createdAt: new Date(end.getTime() - 3 * 60 * 60 * 1000 + 10_000) }
    mockPrisma.message.findMany.mockImplementation((async (a: { where: { OR?: unknown } }) => (a.where.OR ? [{ id: 'n1' }] : [n, q])) as never)
    const day = await collectDay(start, end, { excludeIndonesian: false })
    const idQueries = mockPrisma.message.findMany.mock.calls.filter((c) => (c[0]?.where as { OR?: unknown }).OR)
    expect(idQueries).toHaveLength(1)
    expect(idQueries[0][0]?.select).toEqual({ id: true })
    for (const [a] of mockPrisma.message.findMany.mock.calls) expect(a?.select).not.toHaveProperty('botTrace')
    const msgs = day.conversations[0].messages
    expect(msgs.find((m) => m.id === 'n1')?.automated).toBe(true)
    expect(msgs.find((m) => m.id === 'm1')?.automated).toBeUndefined()
  })
})
