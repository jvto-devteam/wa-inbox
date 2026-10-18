/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

import { prisma } from '@/lib/db'
import type { ConversationReview } from '@/lib/daily-summary/payload-schema'
import { chatReviewHistory } from './history'

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const rev = (topik: string): ConversationReview => ({
  status: 'perlu_tindakan', alasan: 'a', jenisKontak: 'calon_tamu', topik, pertanyaan: [{ teks: 'q', terjawab: false }], poinPenting: [], statusAgen: '', langkahBerikut: '',
})
const ref = (conversationId: string) => ({ conversationId, contactName: 'Budi', pipelineStage: 'NEW' })

function payload(date: string, parts: Record<string, unknown[]>) {
  return {
    version: 1, date, windowStart: 'a', windowEnd: 'b', generatedAt: 'c',
    thresholds: { unrepliedMinMs: 1, dormantMinMs: 1, lookbackMs: 1 },
    counts: { activeConversations: 0, inbound: 0, outbound: 0, newConversations: 0, reviewed: 0, reviewFailed: 0 },
    filteredOut: { unreplied: 0, dormant: 0 },
    unreplied: [], dormant: [], newLeads: [], handoffs: [],
    gaps: { newCount: 0, openTotal: 0, byReason: [], byTopic: [], items: [] },
    conversations: [],
    ...parts,
  }
}

beforeEach(() => mockReset(mockPrisma))

describe('chatReviewHistory', () => {
  it('mengambil review non-null pertama, melewati payload rusak dan hari tanpa percakapan itu', async () => {
    mockPrisma.dailySummary.findMany.mockResolvedValue([
      { date: '2026-10-18', payload: payload('2026-10-18', { conversations: [{ ...ref('c1'), inbound: 1, outbound: 0, review: null }], unreplied: [{ ...ref('c1'), lastMessageAt: 'x', waitingMs: 1, snippet: 's', review: rev('dari unreplied') }] }) },
      { date: '2026-10-17', payload: { rusak: true } },
      { date: '2026-10-16', payload: payload('2026-10-16', { conversations: [{ ...ref('lain'), inbound: 1, outbound: 0, review: rev('lain') }] }) },
      { date: '2026-10-15', payload: payload('2026-10-15', { conversations: [{ ...ref('c1'), inbound: 1, outbound: 0, review: rev('aktif') }] }) },
    ] as never)

    const history = await chatReviewHistory('c1')

    expect(history.map((h) => [h.date, h.review.topik])).toEqual([['2026-10-18', 'dari unreplied'], ['2026-10-15', 'aktif']])
    expect(mockPrisma.dailySummary.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { date: 'desc' }, take: 31 }))
  })
})
