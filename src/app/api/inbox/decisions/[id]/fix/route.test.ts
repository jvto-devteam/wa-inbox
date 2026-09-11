/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { writeBotAuditLog } from '@/lib/bot-control/audit'
import { classifyFactTopics } from '@/lib/bot/fact-topic-classifier'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/audit', () => ({ writeBotAuditLog: vi.fn() }))
vi.mock('@/lib/bot/fact-topic-classifier', () => ({ classifyFactTopics: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const mockTx = mockDeep<Prisma.TransactionClient>()
const params = { params: Promise.resolve({ id: 'run_1' }) }
const REASON = 'Harga ATV sudah naik sejak Agustus'
const ITEMS = [{ question: 'Berapa harga ATV?', answer: 'ATV 1 jam Rp400.000 per orang.', topics: ['price'] }]
const INVALID = 'Data perbaikan tidak valid; isi minimal satu item dan alasan minimal 10 karakter'

const EDIT = { kind: 'edit', sourceId: 'ks_1', title: 'FAQ Harga ATV', summary: '', items: ITEMS, reason: REASON }
const NEW = { kind: 'new', title: 'Harga ATV terbaru', items: ITEMS, reason: REASON }

function req(body: unknown, withSession = true) {
  return new Request('http://localhost/api/inbox/decisions/run_1/fix', {
    method: 'POST',
    headers: withSession ? { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  })
}

function source(overrides: Record<string, unknown> = {}) {
  return { id: 'ks_1', key: 'managed/atv', title: 'FAQ Harga ATV', type: 'MANUAL', status: 'PUBLISHED', summary: null, ...overrides } as never
}

function revision(overrides: Record<string, unknown> = {}) {
  return {
    id: 'krev_3',
    knowledgeSourceId: 'ks_1',
    version: 3,
    title: 'FAQ Harga ATV',
    summary: null,
    body: { items: ITEMS },
    status: 'PUBLISHED',
    changeReason: null,
    ...overrides,
  } as never
}

const runWithSource = {
  id: 'run_1',
  knowledgeRefs: {
    knowledge: {
      managedLines: [{ line: 'ATV 1 jam: IDR 350000', source: 'FAQ Harga ATV (v3)', sourceId: 'ks_1', sourceKey: 'managed/atv', version: 3 }],
    },
  },
}

beforeEach(() => {
  mockReset(mockPrisma)
  mockReset(mockTx)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
  vi.mocked(writeBotAuditLog).mockResolvedValue('audit_1')
  vi.mocked(classifyFactTopics).mockResolvedValue([])
  mockPrisma.$transaction.mockImplementation((arg: unknown) =>
    (arg as (tx: Prisma.TransactionClient) => Promise<unknown>)(mockTx)
  )
  mockPrisma.account.findUnique.mockResolvedValue({ name: 'Budi' } as never)
  mockPrisma.botDecisionRun.findUnique.mockResolvedValue(runWithSource as never)
  mockPrisma.botDecisionRun.update.mockResolvedValue({ id: 'run_1' } as never)
  mockPrisma.knowledgeSource.findUnique.mockResolvedValue(source())
  mockPrisma.knowledgeRevision.create.mockResolvedValue(revision({ id: 'krev_4', version: 4, status: 'DRAFT' }))
  mockTx.knowledgeRevision.updateMany.mockResolvedValue({ count: 1 } as never)
  mockTx.knowledgeSource.update.mockResolvedValue(source())
})

describe('POST /api/inbox/decisions/[id]/fix — umum', () => {
  it('401 tanpa sesi, tanpa membaca apa pun', async () => {
    const res = await POST(req(EDIT, false), params)
    expect(res.status).toBe(401)
    expect(mockPrisma.botDecisionRun.findUnique).not.toHaveBeenCalled()
  })

  it('400 lewat Zod: alasan pendek, item kosong, kind asing, atau field tambahan', async () => {
    for (const body of [
      { ...EDIT, reason: 'pendek' },
      { ...NEW, items: [] },
      { ...NEW, kind: 'hapus' },
      { ...NEW, status: 'PUBLISHED' },
    ]) {
      const res = await POST(req(body), params)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: INVALID })
    }
    expect(mockPrisma.botDecisionRun.findUnique).not.toHaveBeenCalled()
  })

  it('404 bila keputusan tidak ada', async () => {
    mockPrisma.botDecisionRun.findUnique.mockResolvedValue(null as never)
    const res = await POST(req(EDIT), params)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Keputusan tidak ditemukan.' })
  })
})

describe("POST /api/inbox/decisions/[id]/fix — kind: 'edit'", () => {
  beforeEach(() => {
    // 1) penjaga draft di route, 2) saveKnowledgeDraft, 3) publishKnowledgeRevision.
    mockPrisma.knowledgeRevision.findFirst
      .mockResolvedValueOnce(revision())
      .mockResolvedValueOnce(revision())
      .mockResolvedValueOnce(revision({ id: 'krev_4', version: 4, status: 'DRAFT' }))
    mockTx.knowledgeRevision.update.mockResolvedValue(revision({ id: 'krev_4', version: 4, status: 'PUBLISHED' }))
  })

  it('terbuka untuk AGENT: menyimpan revisi baru lalu mengaktifkannya, dengan audit PUBLISH', async () => {
    const res = await POST(req(EDIT), params)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      sourceId: 'ks_1',
      revisionId: 'krev_4',
      version: 4,
      status: 'PUBLISHED',
      title: 'FAQ Harga ATV',
      flagged: true,
    })
    expect(mockPrisma.knowledgeRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ knowledgeSourceId: 'ks_1', version: 4, status: 'DRAFT', changeReason: REASON, createdBy: 'acc_agent' }),
      })
    )
    expect(mockTx.knowledgeRevision.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'krev_4' }, data: expect.objectContaining({ status: 'PUBLISHED', publishedBy: 'acc_agent' }) })
    )
    expect(writeBotAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PUBLISH', entityType: 'KNOWLEDGE', entityId: 'ks_1', actorId: 'acc_agent', actorName: 'Budi', reason: REASON }),
      mockTx
    )
  })

  it('menandai run: flaggedAt sekarang, flagNote = alasan', async () => {
    await POST(req(EDIT), params)

    const arg = mockPrisma.botDecisionRun.update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'run_1' })
    expect(arg.data).toMatchObject({ flagNote: REASON })
    expect(arg.data.flaggedAt).toBeInstanceOf(Date)
  })

  it('penandaan gagal: respons flagged false, revisi tetap aktif', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.botDecisionRun.update.mockRejectedValue(new Error('db down'))

    const res = await POST(req(EDIT), params)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ version: 4, status: 'PUBLISHED', flagged: false })
    expect(writeBotAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'PUBLISH' }), mockTx)
  })

  it('penjaga MANUAL tetap utuh: sumber non-MANUAL ditolak tanpa revisi, aktivasi, audit, atau tanda', async () => {
    mockPrisma.knowledgeSource.findUnique.mockResolvedValue(source({ type: 'CATALOG' }))

    const res = await POST(req(EDIT), params)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/bertipe CATALOG/)
    expect(mockPrisma.knowledgeRevision.create).not.toHaveBeenCalled()
    expect(mockPrisma.knowledgeRevision.update).not.toHaveBeenCalled()
    expect(mockTx.knowledgeRevision.update).not.toHaveBeenCalled()
    expect(writeBotAuditLog).not.toHaveBeenCalled()
    expect(mockPrisma.botDecisionRun.update).not.toHaveBeenCalled()
  })

  it('menolak sourceId yang tidak dipakai jawaban itu', async () => {
    const res = await POST(req({ ...EDIT, sourceId: 'ks_lain' }), params)
    expect(res.status).toBe(400)
    expect(mockPrisma.knowledgeSource.findUnique).not.toHaveBeenCalled()
  })

  it('menolak edit untuk run lama yang managedLines-nya belum membawa sourceId', async () => {
    mockPrisma.botDecisionRun.findUnique.mockResolvedValue({
      id: 'run_1',
      knowledgeRefs: { knowledge: { managedLines: [{ line: 'ATV 1 jam: IDR 350000', source: 'FAQ Harga ATV (v3)' }] } },
    } as never)
    const res = await POST(req(EDIT), params)
    expect(res.status).toBe(400)
  })

  it('409 bila entri punya draft yang belum diaktifkan, supaya draft itu tidak tertimpa', async () => {
    mockPrisma.knowledgeRevision.findFirst.mockReset()
    mockPrisma.knowledgeRevision.findFirst.mockResolvedValueOnce(revision({ id: 'krev_4', version: 4, status: 'DRAFT' }))

    const res = await POST(req(EDIT), params)

    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/draft v4/)
    expect(mockPrisma.knowledgeRevision.update).not.toHaveBeenCalled()
    expect(mockPrisma.knowledgeRevision.create).not.toHaveBeenCalled()
    expect(writeBotAuditLog).not.toHaveBeenCalled()
  })

  it('404 bila sumber tidak ada', async () => {
    mockPrisma.knowledgeSource.findUnique.mockResolvedValue(null as never)
    const res = await POST(req(EDIT), params)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Knowledge tidak ditemukan.' })
  })

  it('500 dengan bentuk { error } bila aktivasi gagal di tengah jalan', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockTx.knowledgeRevision.updateMany.mockRejectedValue(new Error('db down'))
    const res = await POST(req(EDIT), params)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal menyimpan perbaikan' })
  })
})

describe("POST /api/inbox/decisions/[id]/fix — kind: 'new'", () => {
  beforeEach(() => {
    mockTx.knowledgeSource.create.mockResolvedValue(source({ id: 'ks_new', key: 'managed/new', status: 'DRAFT', title: 'Harga ATV terbaru' }))
    mockTx.knowledgeRevision.create.mockResolvedValue(
      revision({ id: 'krev_new', knowledgeSourceId: 'ks_new', version: 1, status: 'DRAFT', title: 'Harga ATV terbaru' })
    )
    mockPrisma.knowledgeSource.findUnique.mockResolvedValue(source({ id: 'ks_new', key: 'managed/new', status: 'DRAFT' }))
    mockPrisma.knowledgeRevision.findFirst.mockResolvedValue(
      revision({ id: 'krev_new', knowledgeSourceId: 'ks_new', version: 1, status: 'DRAFT', title: 'Harga ATV terbaru' })
    )
    mockTx.knowledgeRevision.update.mockResolvedValue(
      revision({ id: 'krev_new', knowledgeSourceId: 'ks_new', version: 1, status: 'PUBLISHED', title: 'Harga ATV terbaru' })
    )
  })

  it('membuat entri MANUAL baru lalu mengaktifkannya, dengan audit PUBLISH dan tanda', async () => {
    const res = await POST(req(NEW), params)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      sourceId: 'ks_new',
      revisionId: 'krev_new',
      version: 1,
      status: 'PUBLISHED',
      title: 'Harga ATV terbaru',
      flagged: true,
    })
    expect(mockTx.knowledgeSource.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'MANUAL', title: 'Harga ATV terbaru', createdBy: 'acc_agent' }) })
    )
    expect(writeBotAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PUBLISH', entityId: 'ks_new', reason: REASON }),
      mockTx
    )
    expect(mockPrisma.botDecisionRun.update).toHaveBeenCalled()
  })
})
