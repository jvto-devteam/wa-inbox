/**
 * @vitest-environment node
 *
 * Server-side end-to-end for the audit finding "Tombol Publish di UI Releases tidak pernah bisa
 * berhasil karena tidak mengirim testRunId".
 *
 * route.test.ts stubs `publishRelease`, so it can never notice the gate; page.test.tsx proves
 * the browser now sends `testRunId`, but stubs the server. This file joins the two halves: the
 * REAL route handler calling the REAL publishRelease, with only Prisma and the audit writer
 * mocked. The first case is literally the body the old UI sent, and it must still be refused —
 * that is what makes the second case mean something.
 *
 * No database is touched. `DATABASE_URL` in this repo points at the production VPS, where a
 * publish would flip approved rules, knowledge and flows live for real customers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { writeBotAuditLog } from '@/lib/bot-control/audit'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/audit', () => ({ writeBotAuditLog: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const mockTx = mockDeep<Prisma.TransactionClient>()

type TransactionCallback<T> = (tx: Prisma.TransactionClient) => Promise<T>

function postReq(body: unknown) {
  return new Request('http://localhost/api/bot-control/releases', {
    method: 'POST',
    headers: { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const PASSED = { id: 'run_pass', status: 'PASSED', total: 12, passed: 12, failed: 0 }
const FAILED = { id: 'run_fail', status: 'FAILED', total: 12, passed: 9, failed: 3 }

beforeEach(() => {
  mockReset(mockPrisma)
  mockReset(mockTx)
  vi.clearAllMocks()
  mockPrisma.$transaction.mockImplementation((arg: unknown) => (arg as TransactionCallback<unknown>)(mockTx))
  vi.mocked(writeBotAuditLog).mockResolvedValue('audit_1')
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })

  mockPrisma.account.findUnique.mockResolvedValue({ name: 'Admin Satu' } as never)
  mockPrisma.botTestRun.findUnique.mockResolvedValue(PASSED as never)
  mockPrisma.botRuleSetting.findMany.mockResolvedValue([] as never)
  mockPrisma.botFlowVersion.findMany.mockResolvedValue([] as never)
  mockPrisma.knowledgeRevision.findMany.mockResolvedValue([] as never)
  mockPrisma.botTestCase.count.mockResolvedValue(3 as never)

  mockTx.botRelease.findFirst.mockResolvedValue(null as never)
  mockTx.botRelease.updateMany.mockResolvedValue({ count: 0 } as never)
  mockTx.botRelease.update.mockResolvedValue({ id: 'rel_new' } as never)
  mockTx.botRelease.create.mockResolvedValue({
    id: 'rel_new',
    version: 9,
    title: 'Release uji',
    status: 'PUBLISHED',
    publishedAt: new Date('2026-09-07T03:00:00.000Z'),
  } as never)
  mockTx.botRuleSetting.findMany.mockResolvedValue([] as never)
  mockTx.botFlowVersion.findMany.mockResolvedValue([] as never)
  mockTx.knowledgeRevision.findMany.mockResolvedValue([] as never)
  mockTx.channelPolicySetting.findUnique.mockResolvedValue(null as never)
})

describe('POST /api/bot-control/releases — gerbang test run (regresi Temuan 1)', () => {
  it('menolak body lama { title, description } dengan 409, bukan 200', async () => {
    // Exactly what the page used to send. If this ever returns 200 the gate has been weakened.
    const res = await POST(postReq({ title: 'Release uji', description: 'tanpa test run' }))

    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('belum ada yang dilampirkan')
  })

  it('meloloskan publish saat testRunId yang lulus dilampirkan', async () => {
    const res = await POST(postReq({ title: 'Release uji', testRunId: PASSED.id }))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ version: 9, status: 'PUBLISHED' })
    // The run is recorded on the release, so "which suite proved this" survives the publish.
    expect(mockTx.botRelease.create.mock.calls[0][0].data).toMatchObject({ testRunId: PASSED.id })
  })

  it('tetap menolak test run yang gagal', async () => {
    mockPrisma.botTestRun.findUnique.mockResolvedValue(FAILED as never)

    const res = await POST(postReq({ title: 'Release uji', testRunId: FAILED.id }))

    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('gagal (3 dari 12 kasus)')
  })

  it('menolak override dari ADMIN — override adalah hak OWNER', async () => {
    mockPrisma.botTestRun.findUnique.mockResolvedValue(FAILED as never)

    const res = await POST(
      postReq({
        title: 'Release uji',
        testRunId: FAILED.id,
        overrideFailedTest: true,
        reason: 'Kasus ujinya sendiri yang salah dan perbaikannya butuh publish ini.',
      })
    )

    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('Hanya OWNER')
  })

  it('meloloskan override OWNER yang disertai alasan', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_owner', role: 'OWNER', tokenVersion: 0 })
    mockPrisma.botTestRun.findUnique.mockResolvedValue(FAILED as never)

    const res = await POST(
      postReq({
        title: 'Release uji',
        testRunId: FAILED.id,
        overrideFailedTest: true,
        reason: 'Kasus ujinya sendiri yang salah dan perbaikannya butuh publish ini.',
      })
    )

    expect(res.status).toBe(200)
  })

  it('menolak override OWNER tanpa alasan yang memadai', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_owner', role: 'OWNER', tokenVersion: 0 })
    mockPrisma.botTestRun.findUnique.mockResolvedValue(FAILED as never)

    const res = await POST(
      postReq({ title: 'Release uji', testRunId: FAILED.id, overrideFailedTest: true, reason: 'pendek' })
    )

    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('minimal 10 karakter')
  })
})
