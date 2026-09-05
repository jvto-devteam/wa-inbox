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
  return new Request(`http://localhost/api/bot-control/knowledge/sources${query}`, {
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

function sourceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'src_1',
    key: 'catalog/policy-cards.json',
    title: 'Policy Cards',
    type: 'CATALOG_JSON',
    sourcePath: 'catalog/policy-cards.json',
    status: 'PUBLISHED',
    summary: '10 record dari policy-cards.json',
    metadata: { fileSize: 11499, rootShape: 'array' },
    lastSyncedAt: new Date('2026-09-05T03:00:00.000Z'),
    _count: { chunks: 10 },
    ...overrides,
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.knowledgeSource.findMany.mockResolvedValue([sourceRow()] as never)
  mockPrisma.knowledgeSource.count.mockResolvedValue(1 as never)
})

describe('GET /api/bot-control/knowledge/sources', () => {
  it('returns the paged shape the contract specifies', async () => {
    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ page: 1, limit: 50, total: 1 })
    expect(body.items[0]).toMatchObject({
      key: 'catalog/policy-cards.json',
      sourcePath: 'catalog/policy-cards.json',
      chunkCount: 10,
      lastSyncedAt: '2026-09-05T03:00:00.000Z',
    })
  })

  it('lets an AGENT read it', async () => {
    expect((await GET(req())).status).toBe(200)
  })

  it('rejects a request with no session as 401 and the mandated { error } shape', async () => {
    const res = await GET(req('', false))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Tidak terautentikasi' })
  })

  it('pushes the search term into the database query, not into a post-filter', async () => {
    // A `.filter()` after `take` means "the first 50 rows, of which the matching ones" — empty
    // while matches exist. The count must come from the same `where` or paging lies.
    await GET(req('?q=ijen'))

    const where = mockPrisma.knowledgeSource.findMany.mock.calls[0][0]?.where
    expect(where?.OR).toEqual([
      { title: { contains: 'ijen', mode: 'insensitive' } },
      { key: { contains: 'ijen', mode: 'insensitive' } },
      { summary: { contains: 'ijen', mode: 'insensitive' } },
    ])
    expect(mockPrisma.knowledgeSource.count.mock.calls[0][0]?.where).toEqual(where)
  })

  it('filters by type and status', async () => {
    await GET(req('?type=CATALOG_JSON&status=ARCHIVED'))
    expect(mockPrisma.knowledgeSource.findMany.mock.calls[0][0]?.where).toMatchObject({
      type: 'CATALOG_JSON',
      status: 'ARCHIVED',
    })
  })

  it('filters by topic through the chunk relation, since topic lives on the chunk', async () => {
    await GET(req('?topic=policy-cards'))
    expect(mockPrisma.knowledgeSource.findMany.mock.calls[0][0]?.where).toMatchObject({
      chunks: { some: { topic: 'policy-cards' } },
    })
  })

  it('applies no filter at all when the query params are blank', async () => {
    await GET(req('?q=&type=&status=&topic='))
    expect(mockPrisma.knowledgeSource.findMany.mock.calls[0][0]?.where).toEqual({})
  })

  it('pages with skip/take derived from page and limit', async () => {
    await GET(req('?page=3&limit=20'))
    expect(mockPrisma.knowledgeSource.findMany.mock.calls[0][0]).toMatchObject({ skip: 40, take: 20 })
  })

  it('clamps an absurd limit instead of letting it run unbounded', async () => {
    await GET(req('?limit=100000'))
    expect(mockPrisma.knowledgeSource.findMany.mock.calls[0][0]?.take).toBe(200)
  })

  it('clamps a negative page instead of producing a negative skip', async () => {
    // Prisma rejects a negative skip at runtime, turning a junk query string into a 500.
    await GET(req('?page=-4'))
    expect(mockPrisma.knowledgeSource.findMany.mock.calls[0][0]?.skip).toBe(0)
  })

  it('returns 500 with the mandated { error } shape when the query fails', async () => {
    mockPrisma.knowledgeSource.findMany.mockRejectedValue(new Error('db down'))
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal memuat sumber knowledge' })
  })
})
