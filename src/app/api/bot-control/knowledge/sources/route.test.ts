/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { createManagedKnowledge, KnowledgeNotEditableError } from '@/lib/bot-control/knowledge-workflow'
import { GET, POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/knowledge-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bot-control/knowledge-workflow')>()
  return { ...actual, createManagedKnowledge: vi.fn() }
})

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
    ownerId: null,
    _count: { chunks: 10 },
    // A catalog mirror has none and never will; managed sources carry their latest first.
    revisions: [],
    ...overrides,
  } as never
}

const BODY = { items: [{ question: 'Berapa harga ATV?', answer: 'Ikut katalog aktif.' }] }
const REASON = 'Menutup knowledge gap harga ATV'

function postReq(body: unknown, withSession = true) {
  return new Request('http://localhost/api/bot-control/knowledge/sources', {
    method: 'POST',
    headers: withSession ? { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mockReset(mockPrisma)
  // Clears call history on the non-Prisma mocks too; without it a "not called" assertion sees
  // the previous test's call.
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.knowledgeSource.findMany.mockResolvedValue([sourceRow()] as never)
  mockPrisma.knowledgeSource.count.mockResolvedValue(1 as never)
  mockPrisma.account.findUnique.mockResolvedValue({ name: 'Admin Satu' } as never)
  vi.mocked(createManagedKnowledge).mockResolvedValue({
    sourceId: 'ks_1',
    revisionId: 'krev_1',
    version: 1,
    status: 'DRAFT',
    title: 'FAQ Harga ATV',
  })
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

  it('filters by lifecycle onto the status column, not a second one', async () => {
    // KnowledgeSource.status already holds exactly these values and is already written by the
    // indexer's archiving. A second state column would give every row two opinions about
    // whether it is live, and they would drift the first time one writer forgot the other.
    await GET(req('?lifecycle=ARCHIVED'))
    expect(mockPrisma.knowledgeSource.findMany.mock.calls[0][0]?.where).toMatchObject({ status: 'ARCHIVED' })
  })

  it('ignores a lifecycle value outside the known set', async () => {
    await GET(req('?lifecycle=ENTAH'))
    expect(mockPrisma.knowledgeSource.findMany.mock.calls[0][0]?.where).not.toHaveProperty('status')
  })

  it('filters by owner', async () => {
    await GET(req('?ownerId=acc_9'))
    expect(mockPrisma.knowledgeSource.findMany.mock.calls[0][0]?.where).toMatchObject({ ownerId: 'acc_9' })
  })

  it('filters by whether something is pending, both ways', async () => {
    await GET(req('?hasDraft=true'))
    expect(mockPrisma.knowledgeSource.findMany.mock.calls[0][0]?.where?.revisions).toEqual({
      some: { status: { in: ['DRAFT', 'REVIEW', 'APPROVED'] } },
    })

    await GET(req('?hasDraft=false'))
    expect(mockPrisma.knowledgeSource.findMany.mock.calls[1][0]?.where?.revisions).toEqual({
      none: { status: { in: ['DRAFT', 'REVIEW', 'APPROVED'] } },
    })
  })

  it('reports a catalog mirror as unmanaged, with no revision', async () => {
    const body = await (await GET(req())).json()
    expect(body.items[0].managed).toBe(false)
    expect(body.items[0].latestRevision).toBeNull()
    expect(body.items[0].hasDraft).toBe(false)
  })

  it('surfaces a managed source latest revision and pending state', async () => {
    mockPrisma.knowledgeSource.findMany.mockResolvedValue([
      sourceRow({
        type: 'MANUAL',
        revisions: [{ id: 'krev_2', version: 2, status: 'REVIEW' }],
      }),
    ] as never)

    const body = await (await GET(req())).json()
    expect(body.items[0]).toMatchObject({
      managed: true,
      hasDraft: true,
      latestRevision: { id: 'krev_2', version: 2, status: 'REVIEW' },
    })
  })

  it('reports a published-only source as having nothing pending', async () => {
    mockPrisma.knowledgeSource.findMany.mockResolvedValue([
      sourceRow({ type: 'MANUAL', revisions: [{ id: 'krev_1', version: 1, status: 'PUBLISHED' }] }),
    ] as never)

    expect((await (await GET(req())).json()).items[0].hasDraft).toBe(false)
  })
})

describe('POST /api/bot-control/knowledge/sources', () => {
  it('creates a managed source as a draft', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })

    const res = await POST(postReq({ title: 'FAQ Harga ATV', body: BODY, reason: REASON }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'DRAFT', version: 1 })
  })

  it('refuses an AGENT and a session-less request', async () => {
    expect((await POST(postReq({ title: 'x', body: BODY, reason: REASON }, false))).status).toBe(401)
    // The default session in this file is an AGENT.
    expect((await POST(postReq({ title: 'x', body: BODY, reason: REASON }))).status).toBe(403)
    expect(createManagedKnowledge).not.toHaveBeenCalled()
  })

  it('requires a title and a substantive reason', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
    expect((await POST(postReq({ title: '  ', body: BODY, reason: REASON }))).status).toBe(400)
    expect((await POST(postReq({ title: 'x', body: BODY, reason: 'pendek' }))).status).toBe(400)
  })

  it('answers 400 when the content itself is what is wrong', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
    vi.mocked(createManagedKnowledge).mockRejectedValue(new KnowledgeNotEditableError('Isi knowledge tidak valid pada: answer.'))

    const res = await POST(postReq({ title: 'x', body: {}, reason: REASON }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: expect.stringContaining('answer') })
  })
})