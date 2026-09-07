/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { publishRelease, ReleaseVersionConflictError } from '@/lib/bot-control/release'
import { GET, POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/release', async (importOriginal) => {
  // The publish path itself is covered in release.test.ts; here only the route's own
  // behaviour matters, so `readReleaseSnapshot` stays real and only the writer is stubbed.
  const actual = await importOriginal<typeof import('@/lib/bot-control/release')>()
  return { ...actual, publishRelease: vi.fn() }
})

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function getReq(query = '', withSession = true) {
  return new Request(`http://localhost/api/bot-control/releases${query}`, {
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

function postReq(body: unknown, withSession = true) {
  return new Request('http://localhost/api/bot-control/releases', {
    method: 'POST',
    headers: withSession ? { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  })
}

function release(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rel_1',
    version: 4,
    title: 'Release Bot Control',
    description: 'Publish rule channel policy',
    status: 'PUBLISHED',
    publishedBy: 'acc_1',
    publishedAt: new Date('2026-09-07T02:00:00.000Z'),
    rollbackOfId: null,
    testRunId: null,
    snapshot: {
      schemaVersion: 1,
      capturedAt: '2026-09-07T02:00:00.000Z',
      rules: [{ id: 'r1', key: 'k', name: 'n', version: null }],
      knowledge: [],
      flows: [],
      channelPolicy: null,
      testSummary: null,
    },
    notes: null,
    createdAt: new Date('2026-09-07T02:00:00.000Z'),
    updatedAt: new Date('2026-09-07T02:00:00.000Z'),
    ...overrides,
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  mockPrisma.botRelease.findMany.mockResolvedValue([release()] as never)
  mockPrisma.botRelease.count.mockResolvedValue(1 as never)
  mockPrisma.account.findMany.mockResolvedValue([{ id: 'acc_1', name: 'Budi' }] as never)
  mockPrisma.account.findUnique.mockResolvedValue({ name: 'Admin Satu' } as never)
  vi.mocked(publishRelease).mockResolvedValue({
    id: 'rel_new',
    version: 5,
    title: 'Release baru',
    status: 'PUBLISHED',
    publishedAt: new Date('2026-09-07T03:00:00.000Z'),
  })
})

describe('GET /api/bot-control/releases', () => {
  it('refuses a request with no session', async () => {
    expect((await GET(getReq('', false))).status).toBe(401)
  })

  it('is readable by an AGENT — "what is live right now" is everyone\'s question', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
    expect((await GET(getReq())).status).toBe(200)
  })

  it('lists newest first and resolves who published each one', async () => {
    const body = await (await GET(getReq())).json()
    expect(mockPrisma.botRelease.findMany.mock.calls[0][0]?.orderBy).toEqual({ version: 'desc' })
    expect(body.items[0]).toMatchObject({ version: 4, status: 'PUBLISHED', publishedByName: 'Budi' })
  })

  it('summarises the snapshot to counts instead of shipping it', async () => {
    // A snapshot grows with every phase; sending all of them in a list response makes the page
    // slower for every release the account has ever had.
    const body = await (await GET(getReq())).json()
    expect(body.items[0]).not.toHaveProperty('snapshot')
    expect(body.items[0].changes).toEqual({ rules: 1, knowledge: 0, flows: 0, channelPolicy: 0 })
  })

  it('flags a snapshot this build cannot read instead of guessing at it', async () => {
    // That is exactly the release a rollback would refuse, so the list has to say so.
    mockPrisma.botRelease.findMany.mockResolvedValue([release({ snapshot: { bentuk: 'asing' } })] as never)

    const body = await (await GET(getReq())).json()
    expect(body.items[0].changes).toBeNull()
  })

  it('keeps a release whose publisher account is gone', async () => {
    // The release outlives whoever published it; an empty name beats dropping the row.
    mockPrisma.account.findMany.mockResolvedValue([] as never)

    const body = await (await GET(getReq())).json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].publishedByName).toBeNull()
  })

  it('filters by a known status and ignores an unknown one', async () => {
    await GET(getReq('?status=SUPERSEDED'))
    expect(mockPrisma.botRelease.findMany.mock.calls[0][0]?.where).toMatchObject({ status: 'SUPERSEDED' })

    // Zero rows would read as "nothing has ever been published" — alarming, and untrue.
    await GET(getReq('?status=BUKAN_STATUS'))
    expect(mockPrisma.botRelease.findMany.mock.calls[1][0]?.where).not.toHaveProperty('status')
  })

  it('reports a database failure as a 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.botRelease.findMany.mockRejectedValue(new Error('db down'))

    const res = await GET(getReq())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal memuat daftar release' })
  })
})

describe('POST /api/bot-control/releases', () => {
  it('publishes and returns the new version', async () => {
    const res = await POST(postReq({ title: 'Release Bot Control 2026-09-07' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ version: 5, status: 'PUBLISHED' })
  })

  it('passes the acting admin through, so the release is attributable', async () => {
    await POST(postReq({ title: 'x' }))
    expect(publishRelease).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'acc_admin', actorName: 'Admin Satu' })
    )
  })

  it('refuses an AGENT', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })

    const res = await POST(postReq({ title: 'x' }))
    expect(res.status).toBe(403)
    expect(publishRelease).not.toHaveBeenCalled()
  })

  it('rejects a release with no title', async () => {
    // A release list where every row says "" is a list nobody can navigate during an incident.
    const res = await POST(postReq({ title: '   ' }))
    expect(res.status).toBe(400)
    expect(publishRelease).not.toHaveBeenCalled()
  })

  it('answers 409 when another publish won the version race', async () => {
    vi.mocked(publishRelease).mockRejectedValue(new ReleaseVersionConflictError())

    const res = await POST(postReq({ title: 'x' }))
    expect(res.status).toBe(409)
  })

  it('reports an unexpected failure as a 500 without leaking the raw error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(publishRelease).mockRejectedValue(new Error('db down'))

    const res = await POST(postReq({ title: 'x' }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal mempublish release' })
  })
})
