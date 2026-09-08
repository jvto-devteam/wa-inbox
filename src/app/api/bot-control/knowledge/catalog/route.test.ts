/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifySessionToken } from '@/lib/auth/session'
import { searchCatalogEntries, catalogTopics, type CatalogEntry } from '@/lib/bot-control/catalog-explorer'
import { GET } from './route'

vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/catalog-explorer', () => ({
  searchCatalogEntries: vi.fn(),
  catalogTopics: vi.fn(),
}))

function req(query = '', withSession = true) {
  return new Request(`http://localhost/api/bot-control/knowledge/catalog${query}`, {
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

const ENTRY: CatalogEntry = {
  id: 'general-modules.json#policy_ijen_health',
  sourceFile: 'general-modules.json',
  topic: 'policy',
  title: 'Ijen Health Screening',
  body: 'Setiap tamu wajib membawa surat sehat.',
  links: [],
  prices: [],
  tags: ['ijen_scoped', 'approved'],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
  vi.mocked(searchCatalogEntries).mockReturnValue({
    items: [ENTRY],
    page: 1,
    limit: 50,
    total: 1,
    syncedAt: '2026-08-07T00:00:00.000Z',
  })
  vi.mocked(catalogTopics).mockReturnValue(['paket', 'policy'])
})

describe('GET /api/bot-control/knowledge/catalog', () => {
  it('serves the catalog entries read from disk, with the topics for the filter', async () => {
    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      page: 1,
      limit: 50,
      total: 1,
      syncedAt: '2026-08-07T00:00:00.000Z',
      topics: ['paket', 'policy'],
    })
    expect(body.items[0].title).toBe('Ijen Health Screening')
  })

  it('lets an AGENT read it', async () => {
    expect((await GET(req())).status).toBe(200)
  })

  it('rejects a request with no session as 401 and the mandated { error } shape', async () => {
    const res = await GET(req('', false))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Tidak terautentikasi' })
    expect(searchCatalogEntries).not.toHaveBeenCalled()
  })

  it('passes the search term and topic straight through to the disk reader', async () => {
    await GET(req('?q=masker&topic=policy'))
    expect(searchCatalogEntries).toHaveBeenCalledWith(expect.objectContaining({ q: 'masker', topic: 'policy' }))
  })

  it('clamps an absurd limit instead of letting it run unbounded', async () => {
    await GET(req('?limit=100000'))
    expect(searchCatalogEntries).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }))
  })

  it('returns 500 with the mandated { error } shape when catalog/ cannot be read', async () => {
    // Rendering an unreadable catalog as "no results" would have an operator conclude the bot
    // knows nothing, when the real problem is a broken deployment.
    vi.mocked(searchCatalogEntries).mockImplementation(() => {
      throw new Error('EACCES')
    })
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal membaca isi katalog dari disk' })
  })

  it('exports no mutation handler at all', async () => {
    // The endpoint it replaced had a POST that rewrote KnowledgeSource rows from disk. Nothing
    // here writes anything, which is what keeps CLAUDE.md's "never overwrite a MANUAL source"
    // rule structurally impossible to break from the catalog side.
    const mod = await import('./route')
    expect(Object.keys(mod).filter((k) => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(k))).toEqual([])
  })
})
