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
  return new Request(`http://localhost/api/bot-control/knowledge/chunks${query}`, {
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

function chunkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chunk_1',
    knowledgeSourceId: 'src_1',
    topic: 'policy-cards',
    title: 'Booking Safety & Anti-Fraud',
    body: 'Isi kebijakan yang panjang.',
    facts: ['id: policies/anti-fraud'],
    links: ['/policies/booking-paths.md'],
    prices: [],
    tags: ['policy'],
    hash: 'a'.repeat(64),
    knowledgeSource: { key: 'catalog/policy-cards.json', title: 'Policy Cards', sourcePath: 'catalog/policy-cards.json' },
    ...overrides,
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.knowledgeChunk.findMany.mockResolvedValue([chunkRow()] as never)
  mockPrisma.knowledgeChunk.count.mockResolvedValue(1 as never)
})

describe('GET /api/bot-control/knowledge/chunks', () => {
  it('returns the paged shape with the source path attached to each chunk', async () => {
    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ page: 1, limit: 50, total: 1 })
    // "Knowledge ini datang dari file mana" is one of the questions the page exists to answer,
    // so the path travels with the chunk rather than requiring a second lookup.
    expect(body.items[0]).toMatchObject({
      sourceKey: 'catalog/policy-cards.json',
      sourcePath: 'catalog/policy-cards.json',
      topic: 'policy-cards',
      linksCount: 1,
      pricesCount: 0,
    })
  })

  it('truncates the list preview but keeps the full body available', async () => {
    const long = 'x'.repeat(900)
    mockPrisma.knowledgeChunk.findMany.mockResolvedValue([chunkRow({ body: long })] as never)

    const body = await (await GET(req())).json()
    expect(body.items[0].bodyPreview).toHaveLength(400)
    expect(body.items[0].body).toHaveLength(900)
  })

  it('counts links and prices even when the Json column holds null', async () => {
    // A chunk indexed before these fields existed, or one whose record had neither, must not
    // crash the list with "cannot read length of null".
    mockPrisma.knowledgeChunk.findMany.mockResolvedValue([chunkRow({ links: null, prices: null })] as never)

    const body = await (await GET(req())).json()
    expect(body.items[0]).toMatchObject({ linksCount: 0, pricesCount: 0 })
  })

  it('narrows to one source when sourceId is given', async () => {
    await GET(req('?sourceId=src_9'))
    expect(mockPrisma.knowledgeChunk.findMany.mock.calls[0][0]?.where).toMatchObject({ knowledgeSourceId: 'src_9' })
  })

  it('searches title and body in the database query', async () => {
    await GET(req('?q=masker'))
    const where = mockPrisma.knowledgeChunk.findMany.mock.calls[0][0]?.where
    expect(where?.OR).toEqual([
      { title: { contains: 'masker', mode: 'insensitive' } },
      { body: { contains: 'masker', mode: 'insensitive' } },
    ])
    expect(mockPrisma.knowledgeChunk.count.mock.calls[0][0]?.where).toEqual(where)
  })

  it('filters by topic', async () => {
    await GET(req('?topic=itinerary-intelligence/meal-logic'))
    expect(mockPrisma.knowledgeChunk.findMany.mock.calls[0][0]?.where).toMatchObject({
      topic: 'itinerary-intelligence/meal-logic',
    })
  })

  it('rejects a request with no session', async () => {
    const res = await GET(req('', false))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Tidak terautentikasi' })
  })

  it('pages and clamps the same way the sources endpoint does', async () => {
    await GET(req('?page=2&limit=500'))
    expect(mockPrisma.knowledgeChunk.findMany.mock.calls[0][0]).toMatchObject({ skip: 200, take: 200 })
  })

  it('returns 500 with the mandated { error } shape when the query fails', async () => {
    mockPrisma.knowledgeChunk.findMany.mockRejectedValue(new Error('db down'))
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal memuat isi knowledge' })
  })
})
