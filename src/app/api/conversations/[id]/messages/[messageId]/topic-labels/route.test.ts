/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { classifyAndStoreTopicLabels } from '@/lib/inbox/topic-labels'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/inbox/topic-labels', () => ({ classifyAndStoreTopicLabels: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const LABELS = {
  topic: 'price',
  alsoTopics: [],
  job: 'J2',
  topicSource: 'llm',
  source: 'manual',
  at: '2026-09-11T08:00:00.000Z',
} as const

function ctx(id = 'conv_1', messageId = 'msg_1') {
  return { params: Promise.resolve({ id, messageId }) }
}

function req(withSession = true) {
  return new Request('http://localhost/api/conversations/conv_1/messages/msg_1/topic-labels', {
    method: 'POST',
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

const inbound = { conversationId: 'conv_1', direction: 'INBOUND', content: 'Berapa harga Ijen?', topicLabels: null }

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.message.findUnique.mockResolvedValue(inbound as never)
  vi.mocked(classifyAndStoreTopicLabels).mockResolvedValue({ ...LABELS, alsoTopics: [] })
})

describe('POST /api/conversations/[id]/messages/[messageId]/topic-labels', () => {
  it('menolak tanpa sesi sebelum menyentuh database', async () => {
    const res = await POST(req(false), ctx())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Tidak terautentikasi' })
    expect(mockPrisma.message.findUnique).not.toHaveBeenCalled()
  })

  it('terbuka untuk AGENT: mengklasifikasi pesan tanpa label dengan source manual', async () => {
    const res = await POST(req(), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ topicLabels: LABELS })
    expect(classifyAndStoreTopicLabels).toHaveBeenCalledWith('msg_1', 'manual')
  })

  it('mengembalikan label yang sudah ada tanpa memanggil model', async () => {
    const stored = { ...LABELS, source: 'auto' }
    mockPrisma.message.findUnique.mockResolvedValue({ ...inbound, topicLabels: stored } as never)

    const res = await POST(req(), ctx())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ topicLabels: stored })
    expect(classifyAndStoreTopicLabels).not.toHaveBeenCalled()
  })

  it('404 bila pesan tidak ada', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null as never)
    const res = await POST(req(), ctx())
    expect(res.status).toBe(404)
    expect(classifyAndStoreTopicLabels).not.toHaveBeenCalled()
  })

  it('404 bila pesan milik percakapan lain', async () => {
    const res = await POST(req(), ctx('conv_lain'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Pesan tidak ditemukan di percakapan ini' })
    expect(classifyAndStoreTopicLabels).not.toHaveBeenCalled()
  })

  it('400 bila pesan bukan INBOUND', async () => {
    mockPrisma.message.findUnique.mockResolvedValue({ ...inbound, direction: 'OUTBOUND' } as never)
    const res = await POST(req(), ctx())
    expect(res.status).toBe(400)
    expect(classifyAndStoreTopicLabels).not.toHaveBeenCalled()
  })

  it('400 bila pesan tanpa teks', async () => {
    mockPrisma.message.findUnique.mockResolvedValue({ ...inbound, content: '  ' } as never)
    const res = await POST(req(), ctx())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Hanya pesan masuk yang berteks yang bisa diperiksa topiknya' })
  })

  it('400 bila parameter kosong, tanpa menyentuh database', async () => {
    const res = await POST(req(), ctx('conv_1', ' '))
    expect(res.status).toBe(400)
    expect(mockPrisma.message.findUnique).not.toHaveBeenCalled()
  })

  it('500 dengan bentuk { error } bila klasifikasi tidak menghasilkan label', async () => {
    vi.mocked(classifyAndStoreTopicLabels).mockResolvedValue(null)
    const res = await POST(req(), ctx())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Topik gagal diperiksa. Coba lagi sebentar lagi.' })
  })

  it('500 dengan bentuk { error } bila database gagal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.message.findUnique.mockRejectedValue(new Error('db down'))
    const res = await POST(req(), ctx())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal memeriksa topik' })
  })
})
