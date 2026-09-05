/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifySessionToken } from '@/lib/auth/session'
import { indexCatalogKnowledge } from '@/lib/bot-control/knowledge-indexer'
import { POST } from './route'

vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/knowledge-indexer', () => ({ indexCatalogKnowledge: vi.fn() }))

const req = new Request('http://localhost/api/bot-control/knowledge/sync', {
  method: 'POST',
  headers: { cookie: 'wa_inbox_session=tok' },
})

beforeEach(() => {
  // Call history has to be cleared, not just the return values re-stubbed: the two
  // "never called" assertions below would otherwise pass on the first test's calls.
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  vi.mocked(indexCatalogKnowledge).mockResolvedValue({ sourcesIndexed: 32, chunksIndexed: 410, errors: [] })
})

describe('POST /api/bot-control/knowledge/sync', () => {
  it('runs the indexer and returns its counts', async () => {
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sourcesIndexed: 32, chunksIndexed: 410, errors: [] })
  })

  it('refuses an AGENT — indexing writes to the database and walks the filesystem', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })

    const res = await POST(req)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Hanya admin yang bisa menyinkronkan index knowledge' })
    expect(indexCatalogKnowledge).not.toHaveBeenCalled()
  })

  it('refuses a request with no session before doing any work', async () => {
    const res = await POST(new Request('http://localhost/api/bot-control/knowledge/sync', { method: 'POST' }))
    expect(res.status).toBe(403)
    expect(indexCatalogKnowledge).not.toHaveBeenCalled()
  })

  it('reports per-file parse failures as a successful run with problems', async () => {
    // 31 indexed files plus one broken one is materially different from "nothing was indexed",
    // and an operator has to be able to tell them apart.
    vi.mocked(indexCatalogKnowledge).mockResolvedValue({
      sourcesIndexed: 31,
      chunksIndexed: 400,
      errors: [{ sourcePath: 'catalog/broken.json', message: 'Unexpected token' }],
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sourcesIndexed).toBe(31)
    expect(body.errors).toHaveLength(1)
  })

  it('returns 500 with the mandated { error } shape when indexing throws outright', async () => {
    vi.mocked(indexCatalogKnowledge).mockRejectedValue(new Error('disk gone'))
    const res = await POST(req)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Index knowledge gagal — cek log server' })
  })
})
