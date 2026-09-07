/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import * as route from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function req(query = '', withSession = true) {
  return new Request(`http://localhost/api/bot-control/audit-logs${query}`, {
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

function log(overrides: Record<string, unknown> = {}) {
  return {
    id: 'audit_1',
    actorId: 'acc_1',
    actorName: 'Budi',
    action: 'PUBLISH',
    entityType: 'RELEASE',
    entityId: 'rel_1',
    entityKey: 'release:4',
    before: null,
    after: { version: 4 },
    reason: null,
    releaseId: 'rel_1',
    ipAddress: '203.0.113.9',
    userAgent: 'Firefox',
    createdAt: new Date('2026-09-07T02:00:00.000Z'),
    ...overrides,
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  mockPrisma.botControlAuditLog.findMany.mockResolvedValue([log()] as never)
  mockPrisma.botControlAuditLog.count.mockResolvedValue(1 as never)
})

describe('GET /api/bot-control/audit-logs', () => {
  it('refuses an AGENT, per the permission matrix', async () => {
    // These rows carry actor identity and before/after values for every configuration change
    // in the account — a narrower audience than the rest of Bot Control by design.
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })

    const res = await route.GET(req())
    expect(res.status).toBe(403)
    expect(mockPrisma.botControlAuditLog.findMany).not.toHaveBeenCalled()
  })

  it('refuses a request with no session', async () => {
    expect((await route.GET(req('', false))).status).toBe(403)
  })

  it('returns the timeline newest first', async () => {
    const res = await route.GET(req())
    expect(res.status).toBe(200)
    expect(mockPrisma.botControlAuditLog.findMany.mock.calls[0][0]?.orderBy).toEqual({ createdAt: 'desc' })

    const body = await res.json()
    expect(body.items[0]).toMatchObject({ action: 'PUBLISH', entityType: 'RELEASE', actorName: 'Budi' })
  })

  it('never returns the stored IP or user-agent', async () => {
    // They exist so a specific incident can be investigated deliberately, not so every admin
    // opening a page gets a running feed of their colleagues' locations and devices.
    const body = await (await route.GET(req())).json()
    expect(body.items[0]).not.toHaveProperty('ipAddress')
    expect(body.items[0]).not.toHaveProperty('userAgent')
  })

  it('exposes no way to write, edit or delete a row', () => {
    // SDD Manage Second §9.9. An audit log an operator can edit is not an audit log.
    expect(route).not.toHaveProperty('POST')
    expect(route).not.toHaveProperty('PATCH')
    expect(route).not.toHaveProperty('PUT')
    expect(route).not.toHaveProperty('DELETE')
  })

  it('filters by action, entity and release', async () => {
    await route.GET(req('?action=ROLLBACK&entityType=RULE&entityId=r1&actorId=acc_9&releaseId=rel_2'))
    expect(mockPrisma.botControlAuditLog.findMany.mock.calls[0][0]?.where).toMatchObject({
      action: 'ROLLBACK',
      entityType: 'RULE',
      entityId: 'r1',
      actorId: 'acc_9',
      releaseId: 'rel_2',
    })
  })

  it('ignores an action outside the known set', async () => {
    await route.GET(req('?action=BUKAN_AKSI'))
    expect(mockPrisma.botControlAuditLog.findMany.mock.calls[0][0]?.where).not.toHaveProperty('action')
  })

  it('filters by date range', async () => {
    await route.GET(req('?dateFrom=2026-09-01&dateTo=2026-09-07T23:59:59.999Z'))
    expect(mockPrisma.botControlAuditLog.findMany.mock.calls[0][0]?.where?.createdAt).toEqual({
      gte: new Date('2026-09-01'),
      lte: new Date('2026-09-07T23:59:59.999Z'),
    })
  })

  it('ignores an unparseable date instead of 500-ing on Invalid Date', async () => {
    await route.GET(req('?dateFrom=bukan-tanggal'))
    expect(mockPrisma.botControlAuditLog.findMany.mock.calls[0][0]?.where).not.toHaveProperty('createdAt')
  })

  it('clamps paging so one query string cannot scan the whole table', async () => {
    await route.GET(req('?limit=100000&page=-3'))
    const call = mockPrisma.botControlAuditLog.findMany.mock.calls[0][0]
    expect(call?.take).toBe(200)
    expect(call?.skip).toBe(0)
  })

  it('reports a database failure as a 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.botControlAuditLog.findMany.mockRejectedValue(new Error('db down'))

    const res = await route.GET(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal memuat audit log' })
  })
})
