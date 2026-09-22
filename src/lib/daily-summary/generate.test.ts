/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { Prisma, type PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('./collect', async (importOriginal) => ({ ...(await importOriginal<typeof import('./collect')>()), collectDay: vi.fn() }))
vi.mock('./review', async (importOriginal) => ({ ...(await importOriginal<typeof import('./review')>()), reviewConversation: vi.fn() }))

import { prisma } from '@/lib/db'
import { collectDay, type CollectedDay, type ConversationFacts, type TranscriptMessage } from './collect'
import { reviewConversation } from './review'
import { buildPayload, generateDailySummary, pruneDailySummaries } from './generate'
import type { ConversationReview } from './payload-schema'
import { jakartaDayRange } from './time'

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const DATE = '2026-09-21'
const { start, end } = jakartaDayRange(DATE)
const HOUR = 60 * 60 * 1000

function msg(direction: 'INBOUND' | 'OUTBOUND', at: Date, content = 'halo'): TranscriptMessage {
  return { direction, sentBy: direction === 'INBOUND' ? 'CUSTOMER' : 'AGENT', type: 'text', content, createdAt: at }
}

function conv(id: string, messages: TranscriptMessage[], extra: Partial<ConversationFacts> = {}): ConversationFacts {
  return {
    conversationId: id,
    contactName: `Kontak ${id}`,
    pipelineStage: 'new',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    tripBrief: null,
    messages,
    inboundToday: 0,
    outboundToday: 0,
    ...extra,
  }
}

function review(status: ConversationReview['status']): ConversationReview {
  return {
    status,
    alasan: 'alasan',
    jenisKontak: 'calon_tamu',
    topik: 'Ijen',
    pertanyaan: [],
    poinPenting: [],
    statusAgen: '',
    langkahBerikut: '',
  }
}

function day(conversations: ConversationFacts[], extra: Partial<CollectedDay> = {}): CollectedDay {
  return { start, end, conversations, handoffRuns: [], gaps: [], openGapTotal: 0, contactNames: new Map(), ...extra }
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(collectDay).mockReset()
  vi.mocked(reviewConversation).mockReset()
})

describe('buildPayload', () => {
  const unrepliedOk = conv('closed', [msg('INBOUND', new Date(end.getTime() - 3 * HOUR), 'ok thanks')], { inboundToday: 1 })
  const unrepliedOpen = conv('open', [msg('INBOUND', new Date(end.getTime() - 5 * HOUR), 'harga Ijen?')], { inboundToday: 1 })
  const unrepliedUnknown = conv('unknown', [msg('INBOUND', new Date(end.getTime() - 2 * HOUR), 'hmm')], { inboundToday: 1 })
  const dormantClosed = conv('dormant-closed', [msg('OUTBOUND', new Date(end.getTime() - 72 * HOUR))])

  const reviews = new Map<string, ConversationReview | null>([
    ['closed', review('selesai')],
    ['open', review('perlu_tindakan')],
    ['unknown', null],
    ['dormant-closed', review('selesai')],
  ])
  const payload = buildPayload(DATE, day([unrepliedOk, unrepliedOpen, unrepliedUnknown, dormantClosed]), reviews, end)

  it('kandidat yang dinilai selesai tidak tampil, tapi dihitung', () => {
    expect(payload.unreplied.map((u) => u.conversationId)).toEqual(['open', 'unknown'])
    expect(payload.filteredOut).toEqual({ unreplied: 1, dormant: 1 })
    expect(payload.dormant).toEqual([])
  })

  it('review gagal tetap tampil sebagai belum dicek dan dihitung', () => {
    expect(payload.unreplied.find((u) => u.conversationId === 'unknown')?.review).toBeNull()
    expect(payload.counts.reviewFailed).toBe(1)
    expect(payload.counts.reviewed).toBe(3)
  })

  it('belum dibalas diurutkan dari yang paling lama menunggu', () => {
    expect(payload.unreplied[0].waitingMs).toBe(5 * HOUR)
  })

  it('handoff ditandai masih menunggu bila percakapannya juga belum dibalas', () => {
    const p = buildPayload(
      DATE,
      day([unrepliedOpen], {
        handoffRuns: [{ id: 'run1', conversationId: 'open', startedAt: new Date(start.getTime() + HOUR), inboundText: 'mau bicara dengan orang' }],
        contactNames: new Map([['open', 'Kontak open']]),
      }),
      new Map([['open', review('perlu_tindakan')]]),
      end
    )
    expect(p.handoffs).toEqual([expect.objectContaining({ runId: 'run1', stillWaiting: true, contactName: 'Kontak open' })])
  })

  it('gap dikelompokkan per alasan dan topik', () => {
    const gap = (id: string, reason: string, topic: string) => ({ id, conversationId: 'open', messageId: null, contactName: null, topic, reason, messageText: 'x' })
    const p = buildPayload(
      DATE,
      day([], { gaps: [gap('g1', 'reply_unsourced', 'ijen'), gap('g2', 'reply_unsourced', 'bromo'), gap('g3', 'no_facts_resolved', 'ijen')], openGapTotal: 9 }),
      new Map(),
      end
    )
    expect(p.gaps.byReason).toEqual([{ key: 'reply_unsourced', count: 2 }, { key: 'no_facts_resolved', count: 1 }])
    expect(p.gaps.byTopic[0]).toEqual({ key: 'ijen', count: 2 })
    expect(p.gaps.openTotal).toBe(9)
  })
})

describe('generateDailySummary', () => {
  beforeEach(() => {
    mockPrisma.settings.findUnique.mockResolvedValue({ ollamaModel: 'gemma4:31b-cloud' } as never)
    mockPrisma.dailySummary.deleteMany.mockResolvedValue({ count: 0 })
  })

  it('menilai tiap kandidat sekali dengan model Settings, lalu menyimpan PARTIAL bila ada yang gagal', async () => {
    mockPrisma.dailySummary.updateMany.mockResolvedValue({ count: 1 })
    vi.mocked(collectDay).mockResolvedValue(
      day([
        conv('a', [msg('INBOUND', new Date(end.getTime() - 2 * HOUR))], { inboundToday: 1 }),
        conv('b', [msg('OUTBOUND', new Date(end.getTime() - 3 * HOUR))], { outboundToday: 1 }),
      ])
    )
    vi.mocked(reviewConversation).mockResolvedValueOnce(review('perlu_tindakan')).mockResolvedValueOnce(null)

    const result = await generateDailySummary(DATE, end)

    expect(result).toEqual({ outcome: 'generated', date: DATE, status: 'PARTIAL' })
    expect(reviewConversation).toHaveBeenCalledTimes(2)
    expect(vi.mocked(reviewConversation).mock.calls[0][1]).toEqual(['unreplied', 'active'])
    expect(vi.mocked(reviewConversation).mock.calls[0][2]).toBe('gemma4:31b-cloud')
    const update = mockPrisma.dailySummary.update.mock.calls[0][0]
    expect(update.data).toMatchObject({ status: 'PARTIAL', model: 'gemma4:31b-cloud', error: null })
  })

  it('menolak jalan ganda saat baris RUNNING masih segar', async () => {
    mockPrisma.dailySummary.updateMany.mockResolvedValue({ count: 0 })
    mockPrisma.dailySummary.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' })
    )

    const result = await generateDailySummary(DATE, end)

    expect(result).toEqual({ outcome: 'already_running', date: DATE })
    expect(collectDay).not.toHaveBeenCalled()
  })

  it('kegagalan pengumpulan data → FAILED tanpa pesan error mentah', async () => {
    mockPrisma.dailySummary.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.dailySummary.update.mockResolvedValue({} as never)
    vi.mocked(collectDay).mockRejectedValue(new Error('connect ECONNREFUSED postgres://user:secret@host'))

    const result = await generateDailySummary(DATE, end)

    expect(result).toEqual({ outcome: 'failed', date: DATE })
    const update = mockPrisma.dailySummary.update.mock.calls[0][0]
    expect(update.data.status).toBe('FAILED')
    expect(String(update.data.error)).not.toContain('secret')
  })
})

describe('pruneDailySummaries', () => {
  it('menghapus hari yang lebih tua dari 30 hari, berdasarkan tanggal', async () => {
    mockPrisma.dailySummary.deleteMany.mockResolvedValue({ count: 2 })
    await expect(pruneDailySummaries(new Date('2026-09-22T05:00:00Z'))).resolves.toEqual({ deleted: 2 })
    expect(mockPrisma.dailySummary.deleteMany).toHaveBeenCalledWith({ where: { date: { lt: '2026-08-23' } } })
  })

  it('tidak pernah melempar', async () => {
    mockPrisma.dailySummary.deleteMany.mockRejectedValue(new Error('db down'))
    await expect(pruneDailySummaries()).resolves.toEqual({ deleted: 0 })
  })
})
