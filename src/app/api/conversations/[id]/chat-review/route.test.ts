/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/summary-items/sync', () => ({
  reconcileSummaryItems: vi.fn().mockResolvedValue(undefined),
  applyReviewToItem: vi.fn().mockResolvedValue('unchanged'),
}))
vi.mock('@/lib/daily-summary/review', () => ({ reviewConversation: vi.fn() }))
vi.mock('@/lib/chat-review/store', () => ({ saveChatReview: vi.fn().mockResolvedValue(true) }))

import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { applyReviewToItem, reconcileSummaryItems } from '@/lib/summary-items/sync'
import { reviewConversation } from '@/lib/daily-summary/review'
import { saveChatReview } from '@/lib/chat-review/store'
import { GET, POST } from './route'

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const req = (method = 'GET') => new Request('http://localhost/api/conversations/c1/chat-review', { method, headers: { cookie: 'wa_inbox_session=tok' } })
const ctx = { params: Promise.resolve({ id: 'c1' }) }

const review = {
  status: 'perlu_tindakan', alasan: 'a', jenisKontak: 'calon_tamu', topik: 'Ijen',
  pertanyaan: [{ teks: 'Harga?', terjawab: false }], poinPenting: [], janjiTim: [], statusAgen: '', langkahBerikut: '',
}
const payload = (date: string) => ({
  version: 1, date, windowStart: 'a', windowEnd: 'b', generatedAt: 'c',
  thresholds: { unrepliedMinMs: 1, dormantMinMs: 1, lookbackMs: 1 },
  counts: { activeConversations: 0, inbound: 0, outbound: 0, newConversations: 0, reviewed: 0, reviewFailed: 0 },
  filteredOut: { unreplied: 0, dormant: 0 }, unreplied: [], dormant: [], newLeads: [], handoffs: [],
  gaps: { newCount: 0, openTotal: 0, byReason: [], byTopic: [], items: [] },
  conversations: [{ conversationId: 'c1', contactName: 'Budi', pipelineStage: 'NEW', inbound: 1, outbound: 0, review }],
})
const doneItem = {
  id: 'si1', kind: 'REPLY', state: 'DONE', anchorAt: new Date('2026-10-17T01:00:00Z'), dueAt: null,
  closedReason: 'REPLIED', note: null, closedAt: new Date('2026-10-17T02:00:00Z'),
}
const msg = (direction: 'INBOUND' | 'OUTBOUND', min: number) => ({
  id: `m${min}`, direction, sentBy: direction === 'INBOUND' ? 'CUSTOMER' : 'HUMAN', type: 'TEXT', content: 'halo', createdAt: new Date(Date.UTC(2026, 9, 19, 0, min)),
})

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(reviewConversation).mockReset()
  vi.mocked(saveChatReview).mockClear()
  vi.mocked(reconcileSummaryItems).mockClear()
  vi.mocked(applyReviewToItem).mockClear()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.dailySummary.findMany.mockResolvedValue([])
  mockPrisma.message.findMany.mockResolvedValue([])
})

describe('GET /api/conversations/[id]/chat-review: pinned & changeHistory', () => {
  const act = (id: string, type: string, bookingId: string | null) => ({
    id, type, field: 'pickup_point', proposedValue: 'Hotel X', bookingId, sourceMessageId: `m_${id}`,
    createdAt: new Date('2026-10-20T01:00:00Z'), state: 'OPEN',
  })
  beforeEach(() => {
    mockPrisma.conversation.findUnique.mockResolvedValue({
      chatReview: null, chatReviewAt: null, summaryItem: null, bookingData: { booking_id: 'B1' },
    } as never)
    mockPrisma.message.findFirst.mockResolvedValue(null)
  })

  it('pinned shows open CHANGE/TASK/MISMATCH in the current booking, not closed ones', async () => {
    mockPrisma.bookingAction.findMany.mockResolvedValue([
      act('a1', 'CHANGE', 'B1'), act('a2', 'TASK', null), act('a3', 'MISMATCH', 'B1'), act('old', 'CHANGE', 'B0'),
    ] as never)
    mockPrisma.bookingActionEvent.findMany.mockResolvedValue([])
    const body = await (await GET(req(), ctx)).json()
    expect(body.pinned.map((p: { id: string }) => p.id)).toEqual(['a1', 'a2', 'a3'])
    expect(body.pinned[0]).toMatchObject({ type: 'CHANGE', field: 'pickup_point', sourceMessageId: 'm_a1' })
    // Hanya OPEN dan tiga tipe itu yang diminta ke DB: yang tertutup/DATA_REQUEST tak pernah muncul.
    expect(mockPrisma.bookingAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { conversationId: 'c1', state: 'OPEN', type: { in: ['CHANGE', 'TASK', 'MISMATCH'] } } }),
    )
  })

  it('changeHistory: 20 newest events with actor name and sourceMessageId', async () => {
    mockPrisma.bookingAction.findMany.mockResolvedValue([])
    mockPrisma.bookingActionEvent.findMany.mockResolvedValue([
      { id: 'e1', event: 'EXECUTED', actor: 'ACCOUNT', accountId: 'acc1', reason: null, sourceMessageId: 'm1',
        oldValue: 'A', newValue: 'B', createdAt: new Date('2026-10-20T02:00:00Z') },
    ] as never)
    mockPrisma.account.findMany.mockResolvedValue([{ id: 'acc1', name: 'Dewi' }] as never)
    const body = await (await GET(req(), ctx)).json()
    expect(mockPrisma.bookingActionEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { conversationId: 'c1', event: { not: 'PUSHED' } }, orderBy: { createdAt: 'desc' }, take: 20 }),
    )
    expect(body.changeHistory).toEqual([
      expect.objectContaining({ id: 'e1', event: 'EXECUTED', accountName: 'Dewi', sourceMessageId: 'm1', newValue: 'B' }),
    ])
  })
})

describe('GET /api/conversations/[id]/chat-review', () => {
  it('401 tanpa sesi', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null)
    expect((await GET(req(), ctx)).status).toBe(401)
  })

  it('404 bila percakapan tidak ada', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(null)
    expect((await GET(req(), ctx)).status).toBe(404)
  })

  it('mengembalikan latest, item DONE dengan closedReason, dan riwayat tanpa payload rusak', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({
      chatReview: review, chatReviewAt: new Date('2026-10-19T00:00:00Z'), summaryItem: doneItem,
    } as never)
    mockPrisma.dailySummary.findMany.mockResolvedValue([
      { date: '2026-10-18', payload: payload('2026-10-18') },
      { date: '2026-10-17', payload: { rusak: 1 } },
      { date: '2026-10-16', payload: payload('2026-10-16') },
    ] as never)

    const res = await GET(req(), ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(reconcileSummaryItems).toHaveBeenCalled()
    expect(body.latest).toEqual({ review, at: '2026-10-19T00:00:00.000Z' })
    expect(body.item).toEqual({
      id: 'si1', kind: 'REPLY', state: 'DONE', anchorAt: '2026-10-17T01:00:00.000Z', dueAt: null,
      closedReason: 'REPLIED', note: null, closedAt: '2026-10-17T02:00:00.000Z',
    })
    expect(body.history.map((h: { date: string }) => h.date)).toEqual(['2026-10-18', '2026-10-16'])
  })

  it('riwayat membawa respondedAt/respondedMessageId/respondedBy dari satu kueri pesan keluar', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({ chatReview: review, chatReviewAt: new Date('2026-10-19T00:00:00Z'), summaryItem: null } as never)
    mockPrisma.dailySummary.findMany.mockResolvedValue([
      { date: '2026-10-18', payload: payload('2026-10-18') },
      { date: '2026-10-16', payload: payload('2026-10-16') },
    ] as never)
    mockPrisma.message.findMany.mockResolvedValue([{ id: 'mOut', createdAt: new Date('2026-10-19T02:00:00Z'), sentBy: 'BOT' }] as never)

    const body = await (await GET(req(), ctx)).json()

    expect(body.history[0]).toMatchObject({ date: '2026-10-18', respondedAt: '2026-10-19T02:00:00.000Z', respondedMessageId: 'mOut', respondedBy: 'BOT' })
    expect(body.history[1]).toMatchObject({ date: '2026-10-16', respondedMessageId: 'mOut', respondedBy: 'BOT' })
    expect(Object.keys(body.history[0]).sort()).toEqual(['date', 'respondedAt', 'respondedBy', 'respondedMessageId', 'review'])
  })

  it('latest null bila belum ada atau tidak lolos skema', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({ chatReview: { rusak: true }, chatReviewAt: new Date(), summaryItem: null } as never)
    const body = await (await GET(req(), ctx)).json()
    expect(body).toEqual({ latest: null, item: null, history: [], lastMessageAt: null, pinned: [], changeHistory: [] })
  })

  it('lastMessageAt = waktu pesan terakhir dari tabel pesan', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({ chatReview: review, chatReviewAt: new Date('2026-10-19T00:00:00Z'), summaryItem: null } as never)
    mockPrisma.message.findFirst.mockResolvedValue({ createdAt: new Date('2026-10-19T03:00:00Z') } as never)
    const body = await (await GET(req(), ctx)).json()
    expect(body.lastMessageAt).toBe('2026-10-19T03:00:00.000Z')
    expect(mockPrisma.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { conversationId: 'c1' }, orderBy: { createdAt: 'desc' } })
    )
  })
})

describe('POST /api/conversations/[id]/chat-review', () => {
  const stored = () =>
    mockPrisma.conversation.findUnique.mockResolvedValue({ chatReview: review, chatReviewAt: new Date(), summaryItem: null, } as never)

  it('401 tanpa sesi', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null)
    expect((await POST(req('POST'), ctx)).status).toBe(401)
  })

  it('404 bila percakapan tidak ada', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(null)
    expect((await POST(req('POST'), ctx)).status).toBe(404)
  })

  it('400 bila tanpa pesan', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({ chatReviewAt: null } as never)
    mockPrisma.message.findMany.mockResolvedValue([])
    expect((await POST(req('POST'), ctx)).status).toBe(400)
    expect(reviewConversation).not.toHaveBeenCalled()
  })

  it.each([
    ['INBOUND', ['unreplied']],
    ['OUTBOUND', ['active']],
  ] as const)('pesan terakhir %s → alasan %j, lalu menyimpan', async (direction, reasons) => {
    mockPrisma.conversation.findUnique.mockResolvedValue({ chatReviewAt: null, chatReview: review, summaryItem: null } as never)
    // findMany mengembalikan baru → lama.
    mockPrisma.message.findMany.mockResolvedValue([msg(direction, 2), msg('INBOUND', 1)] as never)
    mockPrisma.settings.findUnique.mockResolvedValue({ ollamaModel: 'gemma4:31b-cloud' } as never)
    vi.mocked(reviewConversation).mockResolvedValue(review as never)

    const res = await POST(req('POST'), ctx)

    expect(res.status).toBe(200)
    expect(vi.mocked(reviewConversation).mock.calls[0][1]).toEqual(reasons)
    expect(vi.mocked(reviewConversation).mock.calls[0][2]).toBe('gemma4:31b-cloud')
    expect(saveChatReview).toHaveBeenCalledWith('c1', review, expect.any(Date))
    // Perbarui menerapkan review baru ke item "Janji tim" dengan asOf yang sama dengan simpanannya.
    expect(applyReviewToItem).toHaveBeenCalledWith('c1', review, vi.mocked(saveChatReview).mock.calls[0][2])
    expect(Object.keys(await res.json()).sort()).toEqual(['changeHistory', 'history', 'item', 'lastMessageAt', 'latest', 'pinned'])
    // Transkrip bernomor lama → baru, dengan ids yang sejajar.
    const transcript = vi.mocked(reviewConversation).mock.calls[0][0]
    expect(transcript.ids).toEqual(['m1', 'm2'])
    expect(transcript.text.split('\n').map((l) => l.slice(0, 3))).toEqual(['#1 ', '#2 '])
  })

  it('502 saat review null, tanpa menyimpan', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({ chatReviewAt: null } as never)
    mockPrisma.message.findMany.mockResolvedValue([msg('INBOUND', 1)] as never)
    mockPrisma.settings.findUnique.mockResolvedValue(null)
    vi.mocked(reviewConversation).mockResolvedValue(null)

    const res = await POST(req('POST'), ctx)

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'Gagal meringkas. Coba lagi.' })
    expect(saveChatReview).not.toHaveBeenCalled()
    expect(applyReviewToItem).not.toHaveBeenCalled()
  })

  it('penjaga 30 detik: chatReviewAt baru → kembalikan yang ada tanpa memanggil LLM', async () => {
    stored()
    const res = await POST(req('POST'), ctx)
    expect(res.status).toBe(200)
    expect(reviewConversation).not.toHaveBeenCalled()
    expect(applyReviewToItem).not.toHaveBeenCalled()
    expect(mockPrisma.message.findMany).not.toHaveBeenCalled()
    expect((await res.json()).latest.review.topik).toBe('Ijen')
  })
})
