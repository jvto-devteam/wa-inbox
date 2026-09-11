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
const params = { params: Promise.resolve({ sourceId: 'ks_1' }) }
const ITEMS = [{ question: 'Berapa harga ATV?', answer: 'Mulai Rp350.000 per orang.' }]

function req(withSession = true) {
  return new Request('http://localhost/api/inbox/knowledge/ks_1', {
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.knowledgeRevision.findFirst.mockResolvedValue({ title: 'FAQ Harga ATV', summary: null, body: { items: ITEMS }, version: 3 } as never)
})

describe('GET /api/inbox/knowledge/[sourceId]', () => {
  it('mengembalikan revisi PUBLISHED terkini untuk semua yang login, termasuk AGENT', async () => {
    const res = await GET(req(), params)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ title: 'FAQ Harga ATV', summary: null, items: ITEMS, version: 3 })
    expect(mockPrisma.knowledgeRevision.findFirst).toHaveBeenCalledWith({
      where: {
        knowledgeSourceId: 'ks_1',
        status: 'PUBLISHED',
        knowledgeSource: { type: 'MANUAL', status: { not: 'ARCHIVED' } },
      },
      orderBy: { version: 'desc' },
      select: { title: true, summary: true, body: true, version: true },
    })
  })

  it('401 tanpa sesi, tanpa menyentuh database', async () => {
    const res = await GET(req(false), params)
    expect(res.status).toBe(401)
    expect(mockPrisma.knowledgeRevision.findFirst).not.toHaveBeenCalled()
  })

  it('404 bila tidak ada revisi aktif', async () => {
    mockPrisma.knowledgeRevision.findFirst.mockResolvedValue(null as never)
    const res = await GET(req(), params)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Entri knowledge aktif tidak ditemukan' })
  })

  it('422 bila isi revisi tidak terbaca build ini', async () => {
    mockPrisma.knowledgeRevision.findFirst.mockResolvedValue({ title: 'X', summary: null, body: { foo: 1 }, version: 1 } as never)
    const res = await GET(req(), params)
    expect(res.status).toBe(422)
  })

  it('500 dengan bentuk { error } bila database gagal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.knowledgeRevision.findFirst.mockRejectedValue(new Error('db down'))
    const res = await GET(req(), params)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal memuat entri knowledge' })
  })
})
