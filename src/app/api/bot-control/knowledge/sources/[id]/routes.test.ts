/**
 * @vitest-environment node
 *
 * The per-source routes share one shape, so they are tested together — the interesting
 * comparison is which permission each demands and which error maps to which status.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import {
  archiveKnowledgeSource,
  saveKnowledgeDraft,
  transitionKnowledge,
  KnowledgeNotEditableError,
  KnowledgeNotFoundError,
  KnowledgeTransitionError,
} from '@/lib/bot-control/knowledge-workflow'
import { PATCH as saveDraft } from './draft/route'
import { POST as requestReview } from './request-review/route'
import { POST as approve } from './approve/route'
import { POST as reject } from './reject/route'
import { POST as archive } from './archive/route'
import { GET as getRevisions } from './revisions/route'
import { GET as getSource } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/knowledge-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bot-control/knowledge-workflow')>()
  return {
    ...actual,
    saveKnowledgeDraft: vi.fn(),
    transitionKnowledge: vi.fn(),
    archiveKnowledgeSource: vi.fn(),
  }
})

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const params = Promise.resolve({ id: 'ks_1' })
const REASON = 'Menutup knowledge gap harga ATV'
const BODY = { items: [{ question: 'Berapa harga ATV?', answer: 'Ikut katalog aktif.' }] }

function req(body: unknown = {}, method = 'POST', withSession = true) {
  return new Request('http://localhost/api/bot-control/knowledge/sources/ks_1/x', {
    method,
    headers: withSession ? { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  })
}

function getReq(withSession = true) {
  return new Request('http://localhost/api/bot-control/knowledge/sources/ks_1', {
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  mockPrisma.account.findUnique.mockResolvedValue({ name: 'Admin Satu' } as never)
  mockPrisma.account.findMany.mockResolvedValue([] as never)
  vi.mocked(saveKnowledgeDraft).mockResolvedValue({
    sourceId: 'ks_1',
    revisionId: 'krev_1',
    version: 1,
    status: 'DRAFT',
    title: 'FAQ',
  })
  vi.mocked(transitionKnowledge).mockResolvedValue({
    sourceId: 'ks_1',
    revisionId: 'krev_1',
    version: 1,
    status: 'REVIEW',
    title: 'FAQ',
  })
  vi.mocked(archiveKnowledgeSource).mockResolvedValue({ sourceId: 'ks_1', status: 'ARCHIVED' })
})

describe('PATCH /draft', () => {
  it('saves the revision and names the acting operator', async () => {
    const res = await saveDraft(req({ body: BODY, reason: REASON }, 'PATCH'), { params })
    expect(res.status).toBe(200)
    expect(saveKnowledgeDraft).toHaveBeenCalledWith(
      'ks_1',
      expect.objectContaining({ reason: REASON }),
      { id: 'acc_admin', name: 'Admin Satu' },
      expect.anything()
    )
  })

  it('refuses an AGENT and a request with no session', async () => {
    expect((await saveDraft(req({ body: BODY, reason: REASON }, 'PATCH', false), { params })).status).toBe(401)

    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
    expect((await saveDraft(req({ body: BODY, reason: REASON }, 'PATCH'), { params })).status).toBe(403)
    expect(saveKnowledgeDraft).not.toHaveBeenCalled()
  })

  it('requires a substantive reason', async () => {
    expect((await saveDraft(req({ body: BODY, reason: 'x' }, 'PATCH'), { params })).status).toBe(400)
  })

  it('answers 400 for invalid content and 404 for a missing source', async () => {
    vi.mocked(saveKnowledgeDraft).mockRejectedValue(new KnowledgeNotEditableError('Isi knowledge tidak valid'))
    expect((await saveDraft(req({ body: BODY, reason: REASON }, 'PATCH'), { params })).status).toBe(400)

    vi.mocked(saveKnowledgeDraft).mockRejectedValue(new KnowledgeNotFoundError())
    expect((await saveDraft(req({ body: BODY, reason: REASON }, 'PATCH'), { params })).status).toBe(404)
  })
})

describe('transition routes', () => {
  it('each asks for its own transition', async () => {
    await requestReview(req(), { params })
    expect(transitionKnowledge).toHaveBeenCalledWith('ks_1', 'REVIEW', expect.anything(), null, expect.anything())

    await approve(req(), { params })
    expect(transitionKnowledge).toHaveBeenCalledWith('ks_1', 'APPROVE', expect.anything(), null, expect.anything())

    await reject(req({ reason: REASON }), { params })
    expect(transitionKnowledge).toHaveBeenCalledWith('ks_1', 'REJECT', expect.anything(), REASON, expect.anything())
  })

  it('lets a drafter send to review but not approve', async () => {
    // The separation the review step exists to create. With only ADMIN today both collapse,
    // but the matrix is what will make them differ once BOT_MANAGER exists.
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
    expect((await requestReview(req(), { params })).status).toBe(403)
    expect((await approve(req(), { params })).status).toBe(403)
  })

  it('requires a reason to reject but not to approve', async () => {
    expect((await reject(req({}), { params })).status).toBe(400)
    expect((await approve(req({}), { params })).status).toBe(200)
  })

  it('answers 409 when the revision is in the wrong state', async () => {
    vi.mocked(transitionKnowledge).mockRejectedValue(new KnowledgeTransitionError('berstatus DRAFT'))
    expect((await approve(req(), { params })).status).toBe(409)
  })
})

describe('POST /archive', () => {
  it('archives and requires a reason', async () => {
    expect((await archive(req({ reason: REASON }), { params })).status).toBe(200)
    expect((await archive(req({ reason: 'x' }), { params })).status).toBe(400)
  })

  it('needs APPROVE, not merely edit rights', async () => {
    // Archiving takes knowledge away from the bot at the next cache expiry without going
    // through a release — closer to publishing than to drafting.
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
    expect((await archive(req({ reason: REASON }), { params })).status).toBe(403)
  })

  it('answers 403 for a catalog mirror', async () => {
    vi.mocked(archiveKnowledgeSource).mockRejectedValue(new KnowledgeNotEditableError('Sumber katalog'))
    expect((await archive(req({ reason: REASON }), { params })).status).toBe(403)
  })
})

describe('GET /revisions', () => {
  it('returns the history newest first, without bodies', async () => {
    // A history list shows WHICH versions existed; sending every version's full prose would
    // make the panel grow without bound on a source edited fifty times.
    mockPrisma.knowledgeSource.findUnique.mockResolvedValue({ id: 'ks_1', key: 'managed/abc' } as never)
    mockPrisma.knowledgeRevision.findMany.mockResolvedValue([
      { id: 'krev_2', version: 2, title: 'v2', summary: null, status: 'PUBLISHED', changeReason: null, createdBy: null, reviewedBy: null, reviewedAt: null, publishedAt: null, releaseId: null, createdAt: new Date(), updatedAt: new Date() },
    ] as never)

    const body = await (await getRevisions(getReq(), { params })).json()
    expect(mockPrisma.knowledgeRevision.findMany.mock.calls[0][0]?.orderBy).toEqual({ version: 'desc' })
    expect(body.revisions[0]).not.toHaveProperty('body')
  })

  it('answers 404 for a source that does not exist', async () => {
    mockPrisma.knowledgeSource.findUnique.mockResolvedValue(null as never)
    expect((await getRevisions(getReq(), { params })).status).toBe(404)
  })

  it('is readable by an AGENT', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
    mockPrisma.knowledgeSource.findUnique.mockResolvedValue({ id: 'ks_1' } as never)
    mockPrisma.knowledgeRevision.findMany.mockResolvedValue([] as never)
    expect((await getRevisions(getReq(), { params })).status).toBe(200)
  })
})

describe('GET /sources/[id]', () => {
  it('returns the latest revision body for the editor', async () => {
    mockPrisma.knowledgeSource.findUnique.mockResolvedValue({
      id: 'ks_1',
      key: 'managed/abc',
      title: 'FAQ',
      type: 'MANUAL',
      status: 'DRAFT',
      summary: null,
      sourcePath: null,
      ownerId: 'acc_1',
      revisions: [{ id: 'krev_1', version: 1, status: 'DRAFT', title: 'FAQ', summary: null, changeReason: null, body: BODY }],
    } as never)

    const body = await (await getSource(getReq(), { params })).json()
    expect(body.managed).toBe(true)
    expect(body.latestRevision.body).toEqual(BODY)
    expect(body.latestRevision.bodyUnreadable).toBe(false)
  })

  it('flags a body it cannot parse instead of handing raw Json to the editor', async () => {
    // The editor would render a shape it cannot map onto its fields and silently drop the
    // parts it did not understand on the next save.
    mockPrisma.knowledgeSource.findUnique.mockResolvedValue({
      id: 'ks_1',
      key: 'managed/abc',
      title: 'FAQ',
      type: 'MANUAL',
      status: 'DRAFT',
      summary: null,
      sourcePath: null,
      ownerId: null,
      revisions: [{ id: 'krev_1', version: 1, status: 'DRAFT', title: 'FAQ', summary: null, changeReason: null, body: { bentuk: 'asing' } }],
    } as never)

    const body = await (await getSource(getReq(), { params })).json()
    expect(body.latestRevision.body).toBeNull()
    expect(body.latestRevision.bodyUnreadable).toBe(true)
  })
})
