/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  loadPublishedManagedKnowledge,
  invalidateManagedKnowledgeCache,
  toKnowledgeRefs,
  toCatalogKnowledgeRefs,
  MANAGED_KNOWLEDGE_CACHE_TTL_MS,
} from './managed-knowledge'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const BODY = { items: [{ question: 'Berapa harga ATV?', answer: 'Mengikuti paket di katalog aktif.' }] }

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'krev_1',
    knowledgeSourceId: 'ks_1',
    version: 2,
    title: 'FAQ Harga ATV',
    body: BODY,
    knowledgeSource: { key: 'managed/abc', status: 'PUBLISHED' },
    ...overrides,
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  invalidateManagedKnowledgeCache()
  mockPrisma.knowledgeRevision.findMany.mockResolvedValue([row()] as never)
})

describe('loadPublishedManagedKnowledge', () => {
  it('returns published revisions with their items', async () => {
    const result = await loadPublishedManagedKnowledge()
    expect(result.available).toBe(true)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({ sourceKey: 'managed/abc', version: 2, items: BODY.items })
  })

  it('reads only PUBLISHED revisions whose source is not archived', async () => {
    // Drafts must not reach the bot's mouth; and archiving deliberately leaves the published
    // revision in place so old snapshots resolve, so the source filter is what actually stops
    // an archived source being used.
    await loadPublishedManagedKnowledge()
    expect(mockPrisma.knowledgeRevision.findMany.mock.calls[0][0]?.where).toEqual({
      status: 'PUBLISHED',
      knowledgeSource: { status: { not: 'ARCHIVED' } },
    })
  })

  it('skips a revision whose body it cannot read, rather than passing it to the bot', async () => {
    // Handing the bot a shape it dereferences blindly mid-turn is how a malformed row becomes
    // a customer seeing "undefined".
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.knowledgeRevision.findMany.mockResolvedValue([row({ body: { bentuk: 'asing' } }), row({ id: 'krev_2' })] as never)

    const result = await loadPublishedManagedKnowledge()
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].revisionId).toBe('krev_2')
  })

  it('returns an empty, flagged result when the database fails, instead of throwing', async () => {
    // The bot has always run on the catalog alone. Losing the managed additions degrades an
    // answer; throwing ends the turn.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.knowledgeRevision.findMany.mockRejectedValue(new Error('db down'))

    const result = await loadPublishedManagedKnowledge()
    expect(result.entries).toEqual([])
    expect(result.available).toBe(false)
  })

  it('does not cache a failure, so recovery is immediate', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.knowledgeRevision.findMany.mockRejectedValueOnce(new Error('db down'))
    await loadPublishedManagedKnowledge()

    mockPrisma.knowledgeRevision.findMany.mockResolvedValue([row()] as never)
    expect((await loadPublishedManagedKnowledge()).available).toBe(true)
  })

  it('serves the cache within the TTL and refetches after it', async () => {
    // This is read inside a bot turn, which already spends its budget on LLM calls.
    const start = 1_000_000
    await loadPublishedManagedKnowledge(start)
    await loadPublishedManagedKnowledge(start + MANAGED_KNOWLEDGE_CACHE_TTL_MS - 1)
    expect(mockPrisma.knowledgeRevision.findMany).toHaveBeenCalledTimes(1)

    await loadPublishedManagedKnowledge(start + MANAGED_KNOWLEDGE_CACHE_TTL_MS + 1)
    expect(mockPrisma.knowledgeRevision.findMany).toHaveBeenCalledTimes(2)
  })

  it('refetches immediately once the cache is invalidated', async () => {
    const start = 1_000_000
    await loadPublishedManagedKnowledge(start)
    invalidateManagedKnowledgeCache()
    await loadPublishedManagedKnowledge(start)
    expect(mockPrisma.knowledgeRevision.findMany).toHaveBeenCalledTimes(2)
  })

  it('returns an empty list when nothing is published, without failing', async () => {
    mockPrisma.knowledgeRevision.findMany.mockResolvedValue([] as never)
    const result = await loadPublishedManagedKnowledge()
    expect(result).toMatchObject({ entries: [], available: true })
  })
})

describe('knowledge refs', () => {
  it('labels managed entries with their source type and version', async () => {
    // Once two sources of knowledge exist, a trace that only lists titles cannot answer "did
    // that come from the released catalog or from something somebody typed on Tuesday".
    const { entries } = await loadPublishedManagedKnowledge()
    expect(toKnowledgeRefs(entries)).toEqual([
      { sourceType: 'MANAGED', sourceKey: 'managed/abc', title: 'FAQ Harga ATV', version: 2 },
    ])
  })

  it('labels catalog refs too, so both sides of a trace are marked', () => {
    expect(toCatalogKnowledgeRefs(['catalog/policy-cards.json'])).toEqual([
      { sourceType: 'CATALOG', sourceKey: 'catalog/policy-cards.json', title: 'catalog/policy-cards.json' },
    ])
  })

  it('gives a catalog ref no version, because a file is whatever is on disk now', () => {
    expect(toCatalogKnowledgeRefs(['catalog/x.json'])[0]).not.toHaveProperty('version')
  })
})
