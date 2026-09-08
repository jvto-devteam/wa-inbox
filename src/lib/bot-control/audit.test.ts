/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { REDACTED } from '@/lib/bot-control/trace-sanitizer'
import { writeBotAuditLog, pruneBotAuditLogs, AUDIT_ACTIONS, AUDIT_RETENTION_MS } from './audit'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
/** A distinct object, as `$transaction` really hands the caller — never the shared client. */
const mockTx = mockDeep<Prisma.TransactionClient>()

/** The fields every write needs, so each test only states what it is actually about. */
const base = { action: 'PUBLISH' as const, entityType: 'KNOWLEDGE' }

beforeEach(() => {
  mockReset(mockPrisma)
  mockReset(mockTx)
  vi.clearAllMocks()
  mockPrisma.botControlAuditLog.create.mockResolvedValue({ id: 'audit_1' } as never)
  mockTx.botControlAuditLog.create.mockResolvedValue({ id: 'audit_1' } as never)
})

describe('AUDIT_ACTIONS', () => {
  it('carries exactly the four actions still written anywhere', () => {
    // Pinned because the audit page's filter reads the same list; an action nobody writes is a
    // filter option that always returns nothing, and one written but missing here is
    // unfilterable and so effectively invisible. CREATE_DRAFT/UPDATE_DRAFT left with the draft
    // write points (a draft changes nothing a customer sees), and REQUEST_REVIEW/APPROVE/REJECT
    // left with the review cycle that had one person on both ends of it.
    expect(AUDIT_ACTIONS).toEqual(['UPDATE', 'PUBLISH', 'ENABLE', 'DISABLE'])
  })
})

describe('writeBotAuditLog', () => {
  it('stores the five things a history row is: when, who, what action, which entity, and why', async () => {
    await writeBotAuditLog({
      action: 'PUBLISH',
      entityType: 'KNOWLEDGE',
      entityId: 'ks_1',
      entityKey: 'managed/faq-atv',
      actorId: 'acc_1',
      actorName: 'Admin Satu',
      reason: 'Harga ATV naik mulai Oktober',
    })

    const data = mockPrisma.botControlAuditLog.create.mock.calls[0][0].data
    expect(data).toEqual({
      action: 'PUBLISH',
      entityType: 'KNOWLEDGE',
      entityId: 'ks_1',
      entityKey: 'managed/faq-atv',
      actorId: 'acc_1',
      actorName: 'Admin Satu',
      reason: 'Harga ATV naik mulai Oktober',
    })
    // `createdAt` is the database's default, which is what makes "when" untouchable by a caller.
    expect(data).not.toHaveProperty('createdAt')
  })

  it('has nowhere to put a before/after value at all', async () => {
    // The narrowing is the point of this table's shape: proving which of two people changed a
    // value is a question one team does not have, and the value in force is on the entity.
    const params = { ...base, before: { enabled: true }, after: { enabled: false } }
    await writeBotAuditLog(params as unknown as Parameters<typeof writeBotAuditLog>[0])

    // The whole stored shape, so nothing can quietly come back: not the diff, and not the
    // operator's network address or device either.
    const data = mockPrisma.botControlAuditLog.create.mock.calls[0][0].data
    expect(Object.keys(data).sort()).toEqual([
      'action',
      'actorId',
      'actorName',
      'entityId',
      'entityKey',
      'entityType',
      'reason',
    ])
  })

  it('redacts a token pasted into the reason before it reaches the database', async () => {
    // The diff is gone, the free text is not: an operator pausing a provider at 2am pastes the
    // thing that broke. Redacting at render time would mean the secret is already stored and
    // merely hidden by whichever component happens to draw it.
    await writeBotAuditLog({
      ...base,
      action: 'DISABLE',
      reason: 'Jeda META, token EAAGxyz1234567890abcdefghij ditolak Graph',
    })

    const { reason } = mockPrisma.botControlAuditLog.create.mock.calls[0][0].data
    expect(reason).not.toContain('EAAGxyz1234567890abcdefghij')
    expect(reason).toContain(REDACTED)
  })

  it('redacts an Authorization header quoted into the reason too', async () => {
    await writeBotAuditLog({ ...base, reason: 'gagal: Authorization: Bearer abcdef1234567890' })

    const { reason } = mockPrisma.botControlAuditLog.create.mock.calls[0][0].data
    expect(reason).not.toContain('abcdef1234567890')
  })

  it('redacts the entity key on the same terms', async () => {
    // Every key written today is machine-generated. The column is documented as human-readable,
    // and the first caller to put operator text in it must not be the moment redaction stops.
    await writeBotAuditLog({ ...base, entityKey: 'api_key=abcdef1234567890' })

    const { entityKey } = mockPrisma.botControlAuditLog.create.mock.calls[0][0].data
    expect(entityKey).not.toContain('abcdef1234567890')
  })

  it('stores a blank reason as null rather than an empty string', async () => {
    await writeBotAuditLog({ ...base, reason: '   ' })
    expect(mockPrisma.botControlAuditLog.create.mock.calls[0][0].data.reason).toBeNull()
  })

  it('returns the new row id', async () => {
    expect(await writeBotAuditLog(base)).toBe('audit_1')
  })

  it('swallows a standalone failure rather than undoing the action it describes', async () => {
    // Losing the record of a successful action is bad; undoing the action because its footnote
    // failed is worse.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.botControlAuditLog.create.mockRejectedValue(new Error('db down'))

    await expect(writeBotAuditLog(base)).resolves.toBeNull()
  })

  it('rethrows inside a transaction, so an activation with no history row never lands', async () => {
    // Passing `tx` is the caller asking for all-or-nothing.
    mockTx.botControlAuditLog.create.mockRejectedValue(new Error('db down'))

    await expect(writeBotAuditLog(base, mockTx)).rejects.toThrow('db down')
  })

  it('writes through the transaction client it was given, not the shared one', async () => {
    await writeBotAuditLog(base, mockTx)

    expect(mockTx.botControlAuditLog.create).toHaveBeenCalled()
    expect(mockPrisma.botControlAuditLog.create).not.toHaveBeenCalled()
  })
})

describe('pruneBotAuditLogs', () => {
  const now = new Date('2027-09-08T00:00:00.000Z')

  beforeEach(() => {
    mockPrisma.botControlAuditLog.deleteMany.mockResolvedValue({ count: 0 } as never)
  })

  it('deletes rows older than a year and leaves younger ones alone', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    mockPrisma.botControlAuditLog.deleteMany.mockResolvedValue({ count: 12 } as never)

    expect(await pruneBotAuditLogs(now)).toEqual({ deleted: 12 })

    const where = mockPrisma.botControlAuditLog.deleteMany.mock.calls[0][0]?.where
    const cutoff = (where?.createdAt as { lt: Date }).lt
    expect(cutoff).toEqual(new Date(now.getTime() - AUDIT_RETENTION_MS))
    // The bound is `lt` on the cutoff and nothing else: a row from yesterday, and a row from
    // 364 days ago, both fail that test and stay. Anything wider would delete history somebody
    // is still using to answer "what did we change last season".
    expect(Object.keys(where ?? {})).toEqual(['createdAt'])
    expect(where?.createdAt).toEqual({ lt: cutoff })
    expect(new Date(now.getTime() - 364 * 24 * 60 * 60 * 1000) >= cutoff).toBe(true)
  })

  it('is safe to run twice: the second run simply matches nothing', async () => {
    await pruneBotAuditLogs(now)
    expect(await pruneBotAuditLogs(now)).toEqual({ deleted: 0 })

    // Deleting by age, never by a captured list of ids, is what makes a repeat run a no-op
    // instead of a second attempt at rows that are already gone.
    const first = mockPrisma.botControlAuditLog.deleteMany.mock.calls[0][0]
    const second = mockPrisma.botControlAuditLog.deleteMany.mock.calls[1][0]
    expect(first).toEqual(second)
  })

  it('never throws, so the job it rides along on keeps going', async () => {
    // Housekeeping on the outbound cron tick: an un-pruned table is untidy, a queue that stopped
    // draining because tidying failed is customers not getting their messages.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.botControlAuditLog.deleteMany.mockRejectedValue(new Error('db down'))

    await expect(pruneBotAuditLogs(now)).resolves.toEqual({ deleted: 0 })
  })
})
