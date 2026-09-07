/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { writeBotAuditLog } from '@/lib/bot-control/audit'
import {
  archiveKnowledgeSource,
  createManagedKnowledge,
  saveKnowledgeDraft,
  transitionKnowledge,
  KnowledgeNotEditableError,
  KnowledgeNotFoundError,
  KnowledgeTransitionError,
  MANAGED_SOURCE_TYPE,
} from './knowledge-workflow'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/bot-control/audit', () => ({ writeBotAuditLog: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const mockTx = mockDeep<Prisma.TransactionClient>()

const actor = { id: 'acc_1', name: 'Budi' }
const REASON = 'Menutup knowledge gap harga ATV'
const BODY = { items: [{ question: 'Berapa harga ATV?', answer: 'Mengikuti paket di katalog aktif.' }] }

function source(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ks_1',
    key: 'managed/abc',
    title: 'FAQ Harga ATV',
    type: MANAGED_SOURCE_TYPE,
    status: 'PUBLISHED',
    summary: null,
    sourcePath: null,
    ...overrides,
  } as never
}

function revision(overrides: Record<string, unknown> = {}) {
  return {
    id: 'krev_1',
    knowledgeSourceId: 'ks_1',
    version: 1,
    title: 'FAQ Harga ATV',
    summary: null,
    body: BODY,
    status: 'DRAFT',
    changeReason: null,
    ...overrides,
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  mockReset(mockTx)
  vi.clearAllMocks()
  vi.mocked(writeBotAuditLog).mockResolvedValue('audit_1')
  mockPrisma.$transaction.mockImplementation((arg: unknown) =>
    (arg as (tx: Prisma.TransactionClient) => Promise<unknown>)(mockTx)
  )
  mockTx.knowledgeSource.create.mockResolvedValue(source())
  mockTx.knowledgeRevision.create.mockResolvedValue(revision())
  mockPrisma.knowledgeSource.findUnique.mockResolvedValue(source())
  mockPrisma.knowledgeRevision.findFirst.mockResolvedValue(revision())
  mockPrisma.knowledgeRevision.update.mockResolvedValue(revision())
  mockPrisma.knowledgeRevision.create.mockResolvedValue(revision({ id: 'krev_2', version: 2 }))
  mockPrisma.knowledgeSource.update.mockResolvedValue(source({ status: 'ARCHIVED' }))
})

describe('createManagedKnowledge', () => {
  it('creates the source and its first revision in one transaction', async () => {
    // A source with no revision is a row claiming knowledge that has no content — it would show
    // up in the explorer and in every count, and answer nothing.
    await createManagedKnowledge({ title: 'FAQ Harga ATV', body: BODY, reason: REASON }, actor)

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    expect(mockTx.knowledgeSource.create).toHaveBeenCalled()
    expect(mockTx.knowledgeRevision.create).toHaveBeenCalled()
  })

  it('always creates it as MANUAL, which the indexer is forbidden to touch', async () => {
    await createManagedKnowledge({ title: 'x', body: BODY, reason: REASON }, actor)
    expect(mockTx.knowledgeSource.create.mock.calls[0][0].data.type).toBe(MANAGED_SOURCE_TYPE)
  })

  it('creates the source as DRAFT, not PUBLISHED', async () => {
    // Listing it as published straight away would put unpublished content in front of an
    // operator as though the bot were already using it.
    await createManagedKnowledge({ title: 'x', body: BODY, reason: REASON }, actor)
    expect(mockTx.knowledgeSource.create.mock.calls[0][0].data.status).toBe('DRAFT')
    expect(mockTx.knowledgeRevision.create.mock.calls[0][0].data.status).toBe('DRAFT')
  })

  it('starts at version 1', async () => {
    await createManagedKnowledge({ title: 'x', body: BODY, reason: REASON }, actor)
    expect(mockTx.knowledgeRevision.create.mock.calls[0][0].data.version).toBe(1)
  })

  it('refuses an invalid body before writing anything', async () => {
    await expect(
      createManagedKnowledge({ title: 'x', body: { items: [] }, reason: REASON }, actor)
    ).rejects.toBeInstanceOf(KnowledgeNotEditableError)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('audits the creation through the transaction client', async () => {
    await createManagedKnowledge({ title: 'x', body: BODY, reason: REASON }, actor)
    expect(writeBotAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE_DRAFT', entityType: 'KNOWLEDGE', reason: REASON }),
      mockTx
    )
  })
})

describe('saveKnowledgeDraft', () => {
  it('edits the existing revision in place while it is still a draft', async () => {
    // Bumping the version on every typo fix would take a source to v40 through nothing but
    // corrections, and the numbers operators use to talk about it would stop meaning anything.
    await saveKnowledgeDraft('ks_1', { body: BODY, reason: REASON }, actor)

    expect(mockPrisma.knowledgeRevision.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'krev_1' } })
    )
    expect(mockPrisma.knowledgeRevision.create).not.toHaveBeenCalled()
  })

  it('creates a NEW version when the latest revision is published', async () => {
    // Editing a published revision would change the past: a release snapshot naming v1 would
    // describe content the bot never actually used.
    mockPrisma.knowledgeRevision.findFirst.mockResolvedValue(revision({ status: 'PUBLISHED' }))

    await saveKnowledgeDraft('ks_1', { body: BODY, reason: REASON }, actor)

    expect(mockPrisma.knowledgeRevision.update).not.toHaveBeenCalled()
    expect(mockPrisma.knowledgeRevision.create.mock.calls[0][0].data).toMatchObject({ version: 2, status: 'DRAFT' })
  })

  it('sends an already-APPROVED revision back to DRAFT when it is edited', async () => {
    mockPrisma.knowledgeRevision.findFirst.mockResolvedValue(revision({ status: 'APPROVED' }))
    await saveKnowledgeDraft('ks_1', { body: BODY, reason: REASON }, actor)
    expect(mockPrisma.knowledgeRevision.update.mock.calls[0][0].data).toMatchObject({
      status: 'DRAFT',
      reviewedBy: null,
      reviewedAt: null,
    })
  })

  it('refuses a catalog mirror, whose next sync would overwrite the edit anyway', async () => {
    // Silently losing an operator's edit at the next sync is worse than refusing it now.
    mockPrisma.knowledgeSource.findUnique.mockResolvedValue(
      source({ type: 'CATALOG_JSON', sourcePath: 'catalog/policy-cards.json' })
    )

    await expect(saveKnowledgeDraft('ks_1', { body: BODY, reason: REASON }, actor)).rejects.toBeInstanceOf(
      KnowledgeNotEditableError
    )
  })

  it('refuses an archived source', async () => {
    mockPrisma.knowledgeSource.findUnique.mockResolvedValue(source({ status: 'ARCHIVED' }))
    await expect(saveKnowledgeDraft('ks_1', { body: BODY, reason: REASON }, actor)).rejects.toBeInstanceOf(
      KnowledgeNotEditableError
    )
  })

  it('refuses a source that does not exist', async () => {
    mockPrisma.knowledgeSource.findUnique.mockResolvedValue(null as never)
    await expect(saveKnowledgeDraft('ks_1', { body: BODY, reason: REASON }, actor)).rejects.toBeInstanceOf(
      KnowledgeNotFoundError
    )
  })

  it('refuses an invalid body without touching the row', async () => {
    await expect(
      saveKnowledgeDraft('ks_1', { body: { items: [{ question: 'x' }] }, reason: REASON }, actor)
    ).rejects.toBeInstanceOf(KnowledgeNotEditableError)
    expect(mockPrisma.knowledgeRevision.update).not.toHaveBeenCalled()
  })

  it('keeps the existing title and summary when the caller sends neither', async () => {
    await saveKnowledgeDraft('ks_1', { body: BODY, reason: REASON }, actor)
    expect(mockPrisma.knowledgeRevision.update.mock.calls[0][0].data).toMatchObject({ title: 'FAQ Harga ATV' })
  })
})

describe('transitionKnowledge', () => {
  it('sends a draft to review', async () => {
    mockPrisma.knowledgeRevision.update.mockResolvedValue(revision({ status: 'REVIEW' }))
    await transitionKnowledge('ks_1', 'REVIEW', actor, null)
    expect(writeBotAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'REQUEST_REVIEW' }))
  })

  it('records who reviewed it, and when, on approve', async () => {
    mockPrisma.knowledgeRevision.findFirst.mockResolvedValue(revision({ status: 'REVIEW' }))
    mockPrisma.knowledgeRevision.update.mockResolvedValue(revision({ status: 'APPROVED' }))

    await transitionKnowledge('ks_1', 'APPROVE', actor, null)
    expect(mockPrisma.knowledgeRevision.update.mock.calls[0][0].data).toMatchObject({
      status: 'APPROVED',
      reviewedBy: 'acc_1',
    })
  })

  it('approves only from REVIEW', async () => {
    await expect(transitionKnowledge('ks_1', 'APPROVE', actor, null)).rejects.toBeInstanceOf(
      KnowledgeTransitionError
    )
  })

  it('KEEPS a rejected revision, unlike a rejected rule draft', async () => {
    // A rule draft is a handful of settings that can be retyped in seconds. A knowledge
    // revision is written prose, and throwing away somebody's afternoon because a reviewer
    // disagreed with one paragraph is a good way to make nobody write knowledge again.
    mockPrisma.knowledgeRevision.findFirst.mockResolvedValue(revision({ status: 'REVIEW' }))
    mockPrisma.knowledgeRevision.update.mockResolvedValue(revision({ status: 'REJECTED' }))

    await transitionKnowledge('ks_1', 'REJECT', actor, 'Harga di jawabannya sudah tidak berlaku')

    const data = mockPrisma.knowledgeRevision.update.mock.calls[0][0].data
    expect(data).toMatchObject({ status: 'REJECTED' })
    expect(data).not.toHaveProperty('body')
  })

  it('refuses a source with no revision at all', async () => {
    mockPrisma.knowledgeRevision.findFirst.mockResolvedValue(null as never)
    await expect(transitionKnowledge('ks_1', 'REVIEW', actor, null)).rejects.toBeInstanceOf(KnowledgeNotFoundError)
  })
})

describe('archiveKnowledgeSource', () => {
  it('flips the source to ARCHIVED and deletes nothing', async () => {
    // Revisions stay so a release snapshot naming a version still resolves; archiving answers
    // "stop using this", not "pretend it never existed".
    await archiveKnowledgeSource('ks_1', 'Sudah digantikan paket baru', actor)

    expect(mockPrisma.knowledgeSource.update).toHaveBeenCalledWith({
      where: { id: 'ks_1' },
      data: { status: 'ARCHIVED' },
    })
    expect(mockPrisma.knowledgeRevision.deleteMany).not.toHaveBeenCalled()
    expect(mockPrisma.knowledgeSource.delete).not.toHaveBeenCalled()
  })

  it('refuses a catalog mirror, which the indexer archives on its own', async () => {
    mockPrisma.knowledgeSource.findUnique.mockResolvedValue(source({ type: 'CATALOG_JSON' }))
    await expect(archiveKnowledgeSource('ks_1', 'apa pun sepuluh', actor)).rejects.toBeInstanceOf(
      KnowledgeNotEditableError
    )
  })

  it('refuses a source that is already archived', async () => {
    mockPrisma.knowledgeSource.findUnique.mockResolvedValue(source({ status: 'ARCHIVED' }))
    await expect(archiveKnowledgeSource('ks_1', 'apa pun sepuluh', actor)).rejects.toBeInstanceOf(
      KnowledgeTransitionError
    )
  })
})
