/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { writeBotAuditLog } from '@/lib/bot-control/audit'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/audit', () => ({ writeBotAuditLog: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const params = { params: Promise.resolve({ id: 'run_1' }) }

function req(body: unknown, withSession = true) {
  return new Request('http://localhost/api/bot-control/decisions/run_1/flag', {
    method: 'POST',
    headers: withSession ? { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  })
}

/** What the update returns; the route echoes it back to the page. */
function saved(overrides: Record<string, unknown> = {}) {
  return { id: 'run_1', flaggedAt: new Date('2026-09-08T02:00:00.000Z'), flagNote: null, ...overrides } as never
}

function updateArg() {
  return mockPrisma.botDecisionRun.update.mock.calls[0][0]
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.account.findUnique.mockResolvedValue({ name: 'Budi' } as never)
  mockPrisma.botDecisionRun.findUnique.mockResolvedValue({ id: 'run_1', flaggedAt: null, flagNote: null } as never)
  mockPrisma.botDecisionRun.update.mockResolvedValue(saved())
})

describe('POST /api/bot-control/decisions/[id]/flag', () => {
  it('marking a decision writes flaggedAt and flagNote onto the decision row itself', async () => {
    mockPrisma.botDecisionRun.update.mockResolvedValue(saved({ flagNote: 'Harga ATV salah' }))

    const res = await POST(req({ flagged: true, note: 'Harga ATV salah' }), params)
    const body = await res.json()

    expect(res.status).toBe(200)
    // Two columns on BotDecisionRun, not a row in a second table: this is the whole point of b4.
    expect(updateArg().data).toMatchObject({ flagNote: 'Harga ATV salah' })
    expect(updateArg().data.flaggedAt).toBeInstanceOf(Date)
    expect(body).toEqual({ id: 'run_1', flaggedAt: '2026-09-08T02:00:00.000Z', flagNote: 'Harga ATV salah' })
  })

  it('accepts a mark with no note at all', async () => {
    const res = await POST(req({ flagged: true }), params)
    expect(res.status).toBe(200)
    expect(updateArg().data.flaggedAt).toBeInstanceOf(Date)
    expect(updateArg().data.flagNote).toBeNull()
  })

  it('keeps the original flaggedAt when an already-flagged decision is re-flagged', async () => {
    // Editing the note must not restamp the moment somebody first noticed the problem.
    const first = new Date('2026-09-01T00:00:00.000Z')
    mockPrisma.botDecisionRun.findUnique.mockResolvedValue({ id: 'run_1', flaggedAt: first, flagNote: 'lama' } as never)

    await POST(req({ flagged: true, note: 'baru' }), params)
    expect(updateArg().data).toMatchObject({ flaggedAt: first, flagNote: 'baru' })
  })

  it('unmarking clears flaggedAt, and the note with it', async () => {
    mockPrisma.botDecisionRun.findUnique.mockResolvedValue({
      id: 'run_1',
      flaggedAt: new Date('2026-09-01T00:00:00.000Z'),
      flagNote: 'Harga ATV salah',
    } as never)
    mockPrisma.botDecisionRun.update.mockResolvedValue(saved({ flaggedAt: null, flagNote: null }))

    const body = await (await POST(req({ flagged: false }), params)).json()

    // A row with no flaggedAt but a leftover note is a row nobody can read.
    expect(updateArg().data).toEqual({ flaggedAt: null, flagNote: null })
    expect(body).toEqual({ id: 'run_1', flaggedAt: null, flagNote: null })
  })

  it('writes nothing to the audit log at all', async () => {
    // BotControlAuditLog is the history of changes a CUSTOMER could notice. A flag changes
    // nothing the bot does — the mark and its note are on the decision run, which is where
    // anybody reading the decision will find them.
    await POST(req({ flagged: true, note: 'Balasan ngawur' }), params)
    await POST(req({ flagged: false }), params)

    expect(writeBotAuditLog).not.toHaveBeenCalled()
  })

  it('returns 404 for a decision that does not exist, without writing anything', async () => {
    mockPrisma.botDecisionRun.findUnique.mockResolvedValue(null as never)
    const res = await POST(req({ flagged: true }), params)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Keputusan tidak ditemukan.' })
    expect(mockPrisma.botDecisionRun.update).not.toHaveBeenCalled()
  })

  it('rejects a body carrying any of the removed follow-up fields', async () => {
    // The schema is `.strict()`, so a stale client cannot resurrect the eight-issue-type,
    // four-status, four-severity, assignee-and-resolver form this endpoint replaced.
    const res = await POST(req({ flagged: true, severity: 'HIGH', assignee: 'acc_1' }), params)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Data tanda tidak valid' })
    expect(mockPrisma.botDecisionRun.update).not.toHaveBeenCalled()
  })

  it('rejects a body with no `flagged` at all rather than guessing a direction', async () => {
    const res = await POST(req({ note: 'apa saja' }), params)
    expect(res.status).toBe(400)
  })

  it('rejects a request with no session before touching the database', async () => {
    const res = await POST(req({ flagged: true }, false), params)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Tidak terautentikasi' })
    expect(mockPrisma.botDecisionRun.findUnique).not.toHaveBeenCalled()
  })

  it('is open to an AGENT: the person who notices a bad answer is the one reading the chat', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
    const res = await POST(req({ flagged: true }), params)
    expect(res.status).toBe(200)
  })

  it('returns 500 with the mandated { error } shape when the write fails', async () => {
    mockPrisma.botDecisionRun.update.mockRejectedValue(new Error('db down'))
    const res = await POST(req({ flagged: true }), params)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal menyimpan tanda' })
  })
})
