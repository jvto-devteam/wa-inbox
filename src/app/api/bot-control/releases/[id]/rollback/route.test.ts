/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import {
  rollbackToRelease,
  ReleaseAlreadyActiveError,
  ReleaseNotFoundError,
  ReleaseVersionConflictError,
} from '@/lib/bot-control/release'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/release', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bot-control/release')>()
  return { ...actual, rollbackToRelease: vi.fn() }
})

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const params = Promise.resolve({ id: 'rel_1' })

function req(body: unknown, withSession = true) {
  return new Request('http://localhost/api/bot-control/releases/rel_1/rollback', {
    method: 'POST',
    headers: withSession ? { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  })
}

const REASON = 'FAQ baru menyebabkan jawaban pricing salah'

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  mockPrisma.account.findUnique.mockResolvedValue({ name: 'Admin Satu' } as never)
  vi.mocked(rollbackToRelease).mockResolvedValue({
    id: 'rel_new',
    version: 6,
    title: 'Rollback ke versi 3',
    status: 'PUBLISHED',
    publishedAt: new Date('2026-09-07T04:00:00.000Z'),
    archived: [],
  })
})

describe('POST /api/bot-control/releases/[id]/rollback', () => {
  it('rolls back to the release named in the path', async () => {
    const res = await POST(req({ reason: REASON }), { params })
    expect(res.status).toBe(200)
    expect(rollbackToRelease).toHaveBeenCalledWith(
      expect.objectContaining({ targetReleaseId: 'rel_1', reason: REASON, actorId: 'acc_admin' })
    )
  })

  it('requires a substantive reason', async () => {
    // The audit row is read months later by somebody working out why the bot changed. An empty
    // reason makes it a timestamp with no meaning.
    const res = await POST(req({ reason: 'salah' }), { params })
    expect(res.status).toBe(400)
    expect(rollbackToRelease).not.toHaveBeenCalled()
  })

  it('requires a reason at all', async () => {
    expect((await POST(req({}), { params })).status).toBe(400)
    expect(rollbackToRelease).not.toHaveBeenCalled()
  })

  it('refuses an AGENT', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })

    const res = await POST(req({ reason: REASON }), { params })
    expect(res.status).toBe(403)
    expect(rollbackToRelease).not.toHaveBeenCalled()
  })

  it('answers 404 for a release that does not exist', async () => {
    vi.mocked(rollbackToRelease).mockRejectedValue(new ReleaseNotFoundError())
    expect((await POST(req({ reason: REASON }), { params })).status).toBe(404)
  })

  it('answers 409, not 400, when the target is already live', async () => {
    // The request was well-formed; the state simply makes it a no-op.
    vi.mocked(rollbackToRelease).mockRejectedValue(new ReleaseAlreadyActiveError())
    expect((await POST(req({ reason: REASON }), { params })).status).toBe(409)
  })

  it('answers 409 on a version race', async () => {
    vi.mocked(rollbackToRelease).mockRejectedValue(new ReleaseVersionConflictError())
    expect((await POST(req({ reason: REASON }), { params })).status).toBe(409)
  })

  it('reports an unreadable snapshot as a 500 without leaking the raw error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(rollbackToRelease).mockRejectedValue(new Error('Snapshot release v3 tidak bisa dibaca'))

    const res = await POST(req({ reason: REASON }), { params })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal melakukan rollback' })
  })
})
