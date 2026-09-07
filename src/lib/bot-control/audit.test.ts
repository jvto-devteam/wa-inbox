/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { REDACTED } from '@/lib/bot-control/trace-sanitizer'
import { diffAuditFields, writeBotAuditLog, AUDIT_ACTIONS } from './audit'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
/** A distinct object, as `$transaction` really hands the caller — never the shared client. */
const mockTx = mockDeep<Prisma.TransactionClient>()

function req(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/bot-control/releases', { method: 'POST', headers })
}

/** The fields every write needs, so each test only states what it is actually about. */
const base = { action: 'UPDATE_DRAFT' as const, entityType: 'RULE' }

beforeEach(() => {
  mockReset(mockPrisma)
  mockReset(mockTx)
  vi.clearAllMocks()
  mockPrisma.botControlAuditLog.create.mockResolvedValue({ id: 'audit_1' } as never)
  mockTx.botControlAuditLog.create.mockResolvedValue({ id: 'audit_1' } as never)
})

describe('AUDIT_ACTIONS', () => {
  it('carries exactly the eleven actions the SDD lists', () => {
    // Pinned because the audit log's filter UI and every writer read from this list; a
    // silently-added twelfth action would be unfilterable and effectively invisible.
    expect(AUDIT_ACTIONS).toHaveLength(11)
    expect(AUDIT_ACTIONS).toContain('PUBLISH')
    expect(AUDIT_ACTIONS).toContain('ROLLBACK')
    expect(AUDIT_ACTIONS).toContain('OVERRIDE_TEST_FAILURE')
  })
})

describe('diffAuditFields', () => {
  it('keeps only the fields that actually changed', () => {
    // Storing whole objects would make every audit row a second copy of the full config —
    // and sooner or later a second copy of a token with it.
    const { before, after } = diffAuditFields(
      { enabled: true, severity: 'HIGH', name: 'Tetap sama' },
      { enabled: false, severity: 'HIGH', name: 'Tetap sama' }
    )
    expect(before).toEqual({ enabled: true })
    expect(after).toEqual({ enabled: false })
  })

  it('records an added field as null on the missing side', () => {
    // "This field did not exist before" is information; dropping it loses that.
    const { before, after } = diffAuditFields({}, { note: 'baru' })
    expect(before).toEqual({ note: null })
    expect(after).toEqual({ note: 'baru' })
  })

  it('records a removed field the same way', () => {
    const { before, after } = diffAuditFields({ note: 'lama' }, {})
    expect(before).toEqual({ note: 'lama' })
    expect(after).toEqual({ note: null })
  })

  it('does not call a nested object changed just because its keys are in a different order', () => {
    // A config rebuilt in another key order would otherwise be reported as changed on every
    // save, and an audit log full of no-op rows is one nobody reads.
    const { before, after } = diffAuditFields(
      { config: { a: 1, b: { c: 2, d: 3 } } },
      { config: { b: { d: 3, c: 2 }, a: 1 } }
    )
    expect(before).toEqual({})
    expect(after).toEqual({})
  })

  it('does report a nested object whose contents really changed', () => {
    const { after } = diffAuditFields({ config: { rate: 20 } }, { config: { rate: 40 } })
    expect(after).toEqual({ config: { rate: 40 } })
  })

  it('treats a null before or after as an empty side', () => {
    const { before, after } = diffAuditFields(null, { enabled: true })
    expect(before).toEqual({ enabled: null })
    expect(after).toEqual({ enabled: true })
  })
})

describe('writeBotAuditLog', () => {
  it('stores only the changed fields, not the whole object', async () => {
    await writeBotAuditLog({
      ...base,
      before: { enabled: true, name: 'Tetap' },
      after: { enabled: false, name: 'Tetap' },
    })

    const data = mockPrisma.botControlAuditLog.create.mock.calls[0][0].data
    expect(data.before).toEqual({ enabled: true })
    expect(data.after).toEqual({ enabled: false })
  })

  it('leaves before/after unset when nothing changed', async () => {
    // A row whose diff is `{}` is noise; absent is the honest representation.
    await writeBotAuditLog({ ...base, before: { enabled: true }, after: { enabled: true } })

    const data = mockPrisma.botControlAuditLog.create.mock.calls[0][0].data
    expect(data.before).toBeUndefined()
    expect(data.after).toBeUndefined()
  })

  it('redacts a secret before it reaches the database', async () => {
    // Redacting at render time would mean the secret is already stored and merely hidden by
    // whichever component happens to draw it.
    await writeBotAuditLog({
      ...base,
      before: { accessToken: 'lama' },
      after: { accessToken: 'EAAGxyz1234567890abcdefghij' },
    })

    const data = mockPrisma.botControlAuditLog.create.mock.calls[0][0].data
    expect(JSON.stringify(data.after)).not.toContain('EAAGxyz1234567890abcdefghij')
    expect(JSON.stringify(data.after)).toContain(REDACTED)
  })

  it('redacts a secret embedded in a plain string value too', async () => {
    await writeBotAuditLog({
      ...base,
      before: { note: 'kosong' },
      after: { note: 'gagal memanggil dengan Authorization: Bearer abcdef1234567890' },
    })

    const data = mockPrisma.botControlAuditLog.create.mock.calls[0][0].data
    expect(JSON.stringify(data.after)).not.toContain('abcdef1234567890')
  })

  it('records the operator behind a proxy from the forwarded header', async () => {
    await writeBotAuditLog(
      { ...base, req: req({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'user-agent': 'Firefox' }) }
    )

    const data = mockPrisma.botControlAuditLog.create.mock.calls[0][0].data
    // The first hop is the client; the rest are proxies.
    expect(data.ipAddress).toBe('203.0.113.9')
    expect(data.userAgent).toBe('Firefox')
  })

  it('falls back to x-real-ip, and to null when neither header is present', async () => {
    await writeBotAuditLog({ ...base, req: req({ 'x-real-ip': '198.51.100.4' }) })
    expect(mockPrisma.botControlAuditLog.create.mock.calls[0][0].data.ipAddress).toBe('198.51.100.4')

    await writeBotAuditLog({ ...base, req: req() })
    expect(mockPrisma.botControlAuditLog.create.mock.calls[1][0].data.ipAddress).toBeNull()
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

  it('rethrows inside a transaction, so a publish with no audit row never lands', async () => {
    // Passing `tx` is the caller asking for all-or-nothing (SDD Manage Second §11).
    mockTx.botControlAuditLog.create.mockRejectedValue(new Error('db down'))

    await expect(writeBotAuditLog(base, mockTx)).rejects.toThrow('db down')
  })

  it('writes through the transaction client it was given, not the shared one', async () => {
    await writeBotAuditLog(base, mockTx)

    expect(mockTx.botControlAuditLog.create).toHaveBeenCalled()
    expect(mockPrisma.botControlAuditLog.create).not.toHaveBeenCalled()
  })
})
