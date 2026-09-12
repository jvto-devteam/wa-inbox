/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function req(query = '', withSession = true) {
  return new Request(`http://localhost/api/inbox/gaps${query}`, {
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

function gapRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gap_1',
    conversationId: 'conv_1',
    messageId: 'msg_bot',
    topic: 'price',
    reason: 'reply_unsourced',
    messageText: 'berapa harga ATV sekarang?',
    createdAt: new Date('2026-09-12T02:00:00.000Z'),
    conversation: { contact: { name: 'Bruno' } },
    ...overrides,
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.knowledgeGapLog.count.mockResolvedValue(7 as never)
  mockPrisma.knowledgeGapLog.findMany.mockResolvedValue([gapRow()] as never)
})

describe('GET /api/inbox/gaps', () => {
  it('terbuka untuk AGENT: mengembalikan hitungan semua yang belum selesai dan daftar terbarunya', async () => {
    const res = await GET(req())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      count: 7,
      items: [
        {
          id: 'gap_1',
          conversationId: 'conv_1',
          messageId: 'msg_bot',
          contactName: 'Bruno',
          topic: 'price',
          reason: 'reply_unsourced',
          messageText: 'berapa harga ATV sekarang?',
          createdAt: '2026-09-12T02:00:00.000Z',
        },
      ],
    })
  })

  it('hanya menghitung dan menampilkan gap yang belum selesai, terbaru dulu', async () => {
    await GET(req())

    expect(mockPrisma.knowledgeGapLog.count).toHaveBeenCalledWith({ where: { resolvedAt: null } })
    expect(mockPrisma.knowledgeGapLog.findMany).toHaveBeenCalledWith({
      where: { resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { conversation: { include: { contact: true } } },
    })
  })

  it('menghormati limit dan menolak yang di luar batas', async () => {
    await GET(req('?limit=3'))
    expect(mockPrisma.knowledgeGapLog.findMany.mock.calls[0][0]).toMatchObject({ take: 3 })

    const tooBig = await GET(req('?limit=99'))
    expect(tooBig.status).toBe(400)
    expect(await tooBig.json()).toEqual({ error: 'Parameter limit tidak valid' })
  })

  it('menyaring menurut messageId saat panel mencari gap milik satu jawaban', async () => {
    await GET(req('?messageId=msg_bot&limit=1'))

    expect(mockPrisma.knowledgeGapLog.findMany.mock.calls[0][0]).toMatchObject({
      where: { resolvedAt: null, messageId: 'msg_bot' },
      take: 1,
    })
  })

  it('membawa messageId null untuk baris gap lama', async () => {
    mockPrisma.knowledgeGapLog.findMany.mockResolvedValue([gapRow({ messageId: null, reason: 'no_facts_resolved' })] as never)
    const body = (await (await GET(req())).json()) as { items: Array<{ messageId: string | null }> }
    expect(body.items[0].messageId).toBeNull()
  })

  it('401 tanpa sesi, tanpa menyentuh database', async () => {
    const res = await GET(req('', false))
    expect(res.status).toBe(401)
    expect(mockPrisma.knowledgeGapLog.count).not.toHaveBeenCalled()
  })

  it('500 dengan bentuk { error } bila database gagal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.knowledgeGapLog.count.mockRejectedValue(new Error('db down'))
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal memuat gap knowledge' })
  })
})
