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
  publishKnowledgeRevision,
  saveKnowledgeDraft,
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
  mockTx.knowledgeRevision.updateMany.mockResolvedValue({ count: 0 } as never)
  mockTx.knowledgeRevision.update.mockResolvedValue(revision({ status: 'PUBLISHED' }))
  mockTx.knowledgeSource.update.mockResolvedValue(source())
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

  it('always creates it as MANUAL, the type every guard in this module keys on', async () => {
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

  it('writes no history row for a draft nobody can read yet', async () => {
    // BotControlAuditLog is the history of what the BOT does. A draft is not published, so no
    // customer can be answered from it, and the revision row already carries `createdBy` and
    // `changeReason` for whoever wants to know who typed it.
    await createManagedKnowledge({ title: 'x', body: BODY, reason: REASON }, actor)
    expect(writeBotAuditLog).not.toHaveBeenCalled()
  })
})

describe('saveKnowledgeDraft', () => {
  it('writes no history row either, for the same reason a new draft does not', async () => {
    await saveKnowledgeDraft('ks_1', { body: BODY, reason: REASON }, actor)
    expect(writeBotAuditLog).not.toHaveBeenCalled()
  })

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
    // Editing a published revision would change the past: the history panel would show a v1
    // describing content the bot never actually used while v1 was live.
    mockPrisma.knowledgeRevision.findFirst.mockResolvedValue(revision({ status: 'PUBLISHED' }))

    await saveKnowledgeDraft('ks_1', { body: BODY, reason: REASON }, actor)

    expect(mockPrisma.knowledgeRevision.update).not.toHaveBeenCalled()
    expect(mockPrisma.knowledgeRevision.create.mock.calls[0][0].data).toMatchObject({ version: 2, status: 'DRAFT' })
  })

  it('creates a NEW version when the latest revision was archived by a newer publish', async () => {
    // ARCHIVED is history too. Writing over it would rewrite a version somebody can still see
    // in the panel, and the version numbers would stop lining up with what the bot ever said.
    mockPrisma.knowledgeRevision.findFirst.mockResolvedValue(revision({ status: 'ARCHIVED' }))
    await saveKnowledgeDraft('ks_1', { body: BODY, reason: REASON }, actor)
    expect(mockPrisma.knowledgeRevision.update).not.toHaveBeenCalled()
    expect(mockPrisma.knowledgeRevision.create.mock.calls[0][0].data).toMatchObject({ version: 2, status: 'DRAFT' })
  })

  it('refuses a source it did not create, whatever wrote that row', async () => {
    // The MANUAL guard, from the editing side: a row this module does not own belongs to some
    // other writer, and writing over it would silently lose one of the two.
    mockPrisma.knowledgeSource.findUnique.mockResolvedValue(source({ type: 'IMPORTED' }))

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

describe('publishKnowledgeRevision', () => {
  it('turns the draft into the revision the bot reads, recording who and when', async () => {
    await publishKnowledgeRevision('ks_1', actor, null)

    expect(mockTx.knowledgeRevision.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'krev_1' },
      data: { status: 'PUBLISHED', publishedBy: 'acc_1' },
    })
    expect(mockTx.knowledgeRevision.update.mock.calls[0][0].data.publishedAt).toBeInstanceOf(Date)
  })

  it('archives the revision that was live BEFORE the new one lands', async () => {
    // Two PUBLISHED revisions on one source would both be handed to the bot: the loader in
    // managed-knowledge.ts selects every PUBLISHED row and does not deduplicate by source.
    await publishKnowledgeRevision('ks_1', actor, null)

    expect(mockTx.knowledgeRevision.updateMany).toHaveBeenCalledWith({
      where: { knowledgeSourceId: 'ks_1', status: 'PUBLISHED' },
      data: { status: 'ARCHIVED' },
    })
    const order = mockTx.knowledgeRevision.updateMany.mock.invocationCallOrder[0]
    expect(order).toBeLessThan(mockTx.knowledgeRevision.update.mock.invocationCallOrder[0])
  })

  it('brings the source out of DRAFT so the list stops calling it unpublished', async () => {
    await publishKnowledgeRevision('ks_1', actor, null)
    expect(mockTx.knowledgeSource.update).toHaveBeenCalledWith({
      where: { id: 'ks_1' },
      data: { status: 'PUBLISHED', title: 'FAQ Harga ATV', summary: null },
    })
  })

  it('does all three writes in one transaction', async () => {
    await publishKnowledgeRevision('ks_1', actor, null)
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    expect(writeBotAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PUBLISH', entityType: 'KNOWLEDGE' }),
      mockTx
    )
  })

  it('records exactly one history row naming who, which entity, the action and the reason', async () => {
    // Activating knowledge is the moment a customer starts getting a different answer, which is
    // the whole reason this table still exists. `createdAt` is the column default, so "when"
    // comes from the database rather than from anything a caller could get wrong.
    await publishKnowledgeRevision('ks_1', actor, 'Harga ATV naik mulai Oktober')

    expect(writeBotAuditLog).toHaveBeenCalledTimes(1)
    expect(writeBotAuditLog).toHaveBeenCalledWith(
      {
        action: 'PUBLISH',
        entityType: 'KNOWLEDGE',
        entityId: 'ks_1',
        entityKey: 'managed/abc',
        actorId: 'acc_1',
        actorName: 'Budi',
        reason: 'Harga ATV naik mulai Oktober',
      },
      mockTx
    )
    // No diff, and nothing that could carry one: the row says what happened, not what the value
    // used to be. The value in force is on the revision itself.
    const written = vi.mocked(writeBotAuditLog).mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(written).sort()).toEqual([
      'action',
      'actorId',
      'actorName',
      'entityId',
      'entityKey',
      'entityType',
      'reason',
    ])
  })

  it('refuses when the latest revision is already live', async () => {
    // Nothing to activate, and re-publishing would archive the live revision and then restore
    // it — an audit trail full of events that did not happen.
    mockPrisma.knowledgeRevision.findFirst.mockResolvedValue(revision({ status: 'PUBLISHED' }))
    await expect(publishKnowledgeRevision('ks_1', actor, null)).rejects.toBeInstanceOf(KnowledgeTransitionError)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('never activates a source it did not create', async () => {
    // CLAUDE.md: this module owns MANUAL rows and refuses every other type.
    mockPrisma.knowledgeSource.findUnique.mockResolvedValue(source({ type: 'IMPORTED' }))
    await expect(publishKnowledgeRevision('ks_1', actor, null)).rejects.toBeInstanceOf(KnowledgeNotEditableError)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('refuses an archived source', async () => {
    mockPrisma.knowledgeSource.findUnique.mockResolvedValue(source({ status: 'ARCHIVED' }))
    await expect(publishKnowledgeRevision('ks_1', actor, null)).rejects.toBeInstanceOf(KnowledgeTransitionError)
  })

  it('refuses a source with no revision at all', async () => {
    mockPrisma.knowledgeRevision.findFirst.mockResolvedValue(null as never)
    await expect(publishKnowledgeRevision('ks_1', actor, null)).rejects.toBeInstanceOf(KnowledgeNotFoundError)
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

  it('records the row that says the bot stopped using this, and why', async () => {
    await archiveKnowledgeSource('ks_1', 'Sudah digantikan paket baru', actor)

    expect(writeBotAuditLog).toHaveBeenCalledWith({
      action: 'DISABLE',
      entityType: 'KNOWLEDGE',
      entityId: 'ks_1',
      entityKey: 'managed/abc',
      actorId: 'acc_1',
      actorName: 'Budi',
      reason: 'Sudah digantikan paket baru',
    })
  })

  it('refuses to archive a source it did not create', async () => {
    mockPrisma.knowledgeSource.findUnique.mockResolvedValue(source({ type: 'IMPORTED' }))
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
