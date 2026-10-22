/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/summary-items/automated', () => ({ automatedMessageIds: vi.fn() }))

import { prisma } from '@/lib/db'
import type { ConversationReview } from '@/lib/daily-summary/payload-schema'
import { automatedMessageIds } from '@/lib/summary-items/automated'
import { chatReviewHistory } from './history'

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const rev = (topik: string): ConversationReview => ({
  status: 'perlu_tindakan', alasan: 'a', jenisKontak: 'calon_tamu', topik, pertanyaan: [{ teks: 'q', terjawab: false }], poinPenting: [], janjiTim: [], profil: [], statusAgen: '', langkahBerikut: '',
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

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(automatedMessageIds).mockReset().mockResolvedValue(new Set())
  mockPrisma.message.findMany.mockResolvedValue([])
})

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

describe('chatReviewHistory: penanda ditanggapi', () => {
  const perluRev = (status: ConversationReview['status']): ConversationReview => ({ ...rev('t'), status })
  const row = (date: string, status: ConversationReview['status']) => ({
    date,
    payload: payload(date, { conversations: [{ ...ref('c1'), inbound: 1, outbound: 0, review: perluRev(status) }] }),
  })
  // 2026-10-17 berakhir 2026-10-17T17:00:00Z (24.00 WIB); 2026-10-18 berakhir 2026-10-18T17:00:00Z.
  const msg = (id: string, iso: string, sentBy: 'BOT' | 'AGENT') => ({ id, createdAt: new Date(iso), sentBy })

  it('review Important A: kabar otomatis bukan tanggapan -- dilewati, tanggapan sungguhan sesudahnya yang dipakai', async () => {
    mockPrisma.dailySummary.findMany.mockResolvedValue([row('2026-10-18', 'perlu_tindakan')] as never)
    mockPrisma.message.findMany.mockResolvedValue([
      msg('mNoted', '2026-10-18T17:30:00Z', 'AGENT'),
      msg('mAgen', '2026-10-19T02:00:00Z', 'AGENT'),
    ] as never)
    vi.mocked(automatedMessageIds).mockResolvedValue(new Set(['mNoted']))
    const h = await chatReviewHistory('c1')
    expect(automatedMessageIds).toHaveBeenCalledWith(['c1'], new Date('2026-10-18T17:00:00Z'))
    expect(h[0]).toMatchObject({ respondedMessageId: 'mAgen', respondedBy: 'AGENT' })
  })

  it('ditanggapi dan selesai, dengan SATU kueri pesan', async () => {
    mockPrisma.dailySummary.findMany.mockResolvedValue([row('2026-10-18', 'perlu_tindakan'), row('2026-10-17', 'tidak_jelas'), row('2026-10-16', 'selesai')] as never)
    mockPrisma.message.findMany.mockResolvedValue([
      msg('mBot', '2026-10-17T18:00:00Z', 'BOT'),
      msg('mAgen', '2026-10-19T02:00:00Z', 'AGENT'),
    ] as never)

    const h = await chatReviewHistory('c1')

    expect(mockPrisma.message.findMany).toHaveBeenCalledTimes(1)
    expect(mockPrisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: 'c1', direction: 'OUTBOUND', deliveryStatus: { not: 'FAILED' }, createdAt: { gte: new Date('2026-10-17T17:00:00Z') } },
        orderBy: { createdAt: 'asc' },
        take: 500,
      })
    )
    expect(h[0]).toMatchObject({ date: '2026-10-18', respondedMessageId: 'mAgen', respondedBy: 'AGENT', respondedAt: '2026-10-19T02:00:00.000Z' })
    // Balasan tim (mAgen) diutamakan atas bot yang lebih dulu.
    expect(h[1]).toMatchObject({ date: '2026-10-17', respondedMessageId: 'mAgen', respondedBy: 'AGENT' })
    expect(h[2]).toMatchObject({ date: '2026-10-16', respondedAt: null, respondedMessageId: null, respondedBy: null })
  })

  it('tidak ada balasan sesudahnya: semua null', async () => {
    mockPrisma.dailySummary.findMany.mockResolvedValue([row('2026-10-18', 'perlu_tindakan')] as never)
    mockPrisma.message.findMany.mockResolvedValue([] as never)
    const [e] = await chatReviewHistory('c1')
    expect(e).toMatchObject({ respondedAt: null, respondedMessageId: null, respondedBy: null })
  })

  it('batas akhir hari: pesan tepat di akhir hari dihitung, semenit sebelumnya tidak', async () => {
    mockPrisma.dailySummary.findMany.mockResolvedValue([row('2026-10-18', 'perlu_tindakan')] as never)
    mockPrisma.message.findMany.mockResolvedValue([
      msg('sebelum', '2026-10-18T16:59:59.999Z', 'AGENT'),
      msg('tepat', '2026-10-18T17:00:00.000Z', 'AGENT'),
    ] as never)
    const [e] = await chatReviewHistory('c1')
    expect(e.respondedMessageId).toBe('tepat')
  })

  it('semua entri selesai: tidak ada kueri pesan sama sekali', async () => {
    mockPrisma.dailySummary.findMany.mockResolvedValue([row('2026-10-18', 'selesai')] as never)
    const [e] = await chatReviewHistory('c1')
    expect(mockPrisma.message.findMany).not.toHaveBeenCalled()
    expect(e.respondedAt).toBeNull()
  })

  it('bot lebih dulu lalu tim: yang dipilih balasan tim', async () => {
    mockPrisma.dailySummary.findMany.mockResolvedValue([row('2026-10-18', 'perlu_tindakan')] as never)
    mockPrisma.message.findMany.mockResolvedValue([
      msg('mBot', '2026-10-18T18:00:00Z', 'BOT'),
      msg('mAgen', '2026-10-19T05:00:00Z', 'AGENT'),
    ] as never)
    const [e] = await chatReviewHistory('c1')
    expect(e).toMatchObject({ respondedMessageId: 'mAgen', respondedBy: 'AGENT', respondedAt: '2026-10-19T05:00:00.000Z' })
  })

  it('hanya bot: dipilih balasan bot pertama', async () => {
    mockPrisma.dailySummary.findMany.mockResolvedValue([row('2026-10-18', 'perlu_tindakan')] as never)
    mockPrisma.message.findMany.mockResolvedValue([
      msg('b1', '2026-10-18T18:00:00Z', 'BOT'),
      msg('b2', '2026-10-19T05:00:00Z', 'BOT'),
    ] as never)
    const [e] = await chatReviewHistory('c1')
    expect(e).toMatchObject({ respondedMessageId: 'b1', respondedBy: 'BOT' })
  })

  it('sentBy lain (CUSTOMER) diabaikan', async () => {
    mockPrisma.dailySummary.findMany.mockResolvedValue([row('2026-10-18', 'perlu_tindakan')] as never)
    mockPrisma.message.findMany.mockResolvedValue([{ id: 'x', createdAt: new Date('2026-10-19T01:00:00Z'), sentBy: 'CUSTOMER' }] as never)
    const [e] = await chatReviewHistory('c1')
    expect(e.respondedAt).toBeNull()
  })

  it('pesan FAILED dikecualikan lewat kueri; take 500', async () => {
    mockPrisma.dailySummary.findMany.mockResolvedValue([row('2026-10-18', 'perlu_tindakan')] as never)
    await chatReviewHistory('c1')
    const arg = mockPrisma.message.findMany.mock.calls[0][0]
    expect(arg?.where).toMatchObject({ deliveryStatus: { not: 'FAILED' } })
    expect(arg?.take).toBe(500)
  })

  it('entri selesai yang lebih tua tidak melebarkan jendela kueri', async () => {
    mockPrisma.dailySummary.findMany.mockResolvedValue([row('2026-10-18', 'perlu_tindakan'), row('2026-10-10', 'selesai')] as never)
    await chatReviewHistory('c1')
    const arg = mockPrisma.message.findMany.mock.calls[0][0]
    expect(arg?.where?.createdAt).toEqual({ gte: new Date('2026-10-18T17:00:00Z') })
  })
})
