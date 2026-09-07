/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { upsertTriage, DecisionNotFoundError, TriageForbiddenError } from '@/lib/bot-control/triage'
import { GET as listTriage } from './route'
import { POST as upsertRoute, PATCH as patchRoute, GET as getOne } from '../[id]/triage/route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/triage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bot-control/triage')>()
  return { ...actual, upsertTriage: vi.fn() }
})

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const params = Promise.resolve({ id: 'run_1' })

function req(query = '', withSession = true) {
  return new Request(`http://localhost/api/bot-control/decisions/triage${query}`, {
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

function bodyReq(body: unknown, method = 'POST', withSession = true) {
  return new Request('http://localhost/api/bot-control/decisions/run_1/triage', {
    method,
    headers: withSession ? { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  })
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tri_1',
    decisionRunId: 'run_1',
    status: 'OPEN',
    issueType: 'BAD_REPLY',
    severity: 'NORMAL',
    assignedTo: 'acc_agent',
    note: null,
    linkedEntityType: null,
    linkedEntityId: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date('2026-09-07T02:00:00.000Z'),
    updatedAt: new Date('2026-09-07T02:00:00.000Z'),
    ...overrides,
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.account.findUnique.mockResolvedValue({ name: 'Budi' } as never)
  mockPrisma.account.findMany.mockResolvedValue([{ id: 'acc_agent', name: 'Budi' }] as never)
  mockPrisma.botDecisionTriage.findMany.mockResolvedValue([row()] as never)
  mockPrisma.botDecisionTriage.count.mockResolvedValue(1 as never)
  mockPrisma.botDecisionTriage.findUnique.mockResolvedValue(row())
  mockPrisma.botDecisionRun.findMany.mockResolvedValue([
    {
      id: 'run_1',
      conversationId: 'conv_1',
      inboundText: 'Berapa harga ATV?',
      status: 'REPLIED',
      mode: 'faq',
      startedAt: new Date(),
    },
  ] as never)
  vi.mocked(upsertTriage).mockResolvedValue(row())
})

describe('POST/PATCH /api/bot-control/decisions/[id]/triage', () => {
  it('both verbs perform the same upsert', async () => {
    // decisionRunId is unique, so asking a client to know whether one exists before choosing a
    // verb would just move a race condition into the browser.
    expect((await upsertRoute(bodyReq({ issueType: 'BAD_REPLY' }), { params })).status).toBe(200)
    expect((await patchRoute(bodyReq({ note: 'x' }, 'PATCH'), { params })).status).toBe(200)
    expect(upsertTriage).toHaveBeenCalledTimes(2)
  })

  it('passes the caller role through, so triage.ts can apply the narrow rules', async () => {
    await upsertRoute(bodyReq({ issueType: 'BAD_REPLY' }), { params })
    expect(upsertTriage).toHaveBeenCalledWith(
      'run_1',
      expect.anything(),
      { id: 'acc_agent', name: 'Budi', isAdmin: false },
      expect.anything()
    )

    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
    await upsertRoute(bodyReq({ issueType: 'BAD_REPLY' }), { params })
    expect(upsertTriage).toHaveBeenLastCalledWith(
      'run_1',
      expect.anything(),
      expect.objectContaining({ isAdmin: true }),
      expect.anything()
    )
  })

  it('rejects an issue type outside the known set', async () => {
    expect((await upsertRoute(bodyReq({ issueType: 'ENTAH' }), { params })).status).toBe(400)
    expect(upsertTriage).not.toHaveBeenCalled()
  })

  it('rejects an unknown field rather than storing it silently', async () => {
    expect((await upsertRoute(bodyReq({ prioritas: 'tinggi' }), { params })).status).toBe(400)
  })

  it('answers 403 when the role refuses, not 400', async () => {
    // The request is well-formed; the ROLE is what is refusing.
    vi.mocked(upsertTriage).mockRejectedValue(new TriageForbiddenError('Hanya admin'))
    expect((await upsertRoute(bodyReq({ status: 'RESOLVED' }), { params })).status).toBe(403)
  })

  it('answers 404 for a decision that does not exist', async () => {
    vi.mocked(upsertTriage).mockRejectedValue(new DecisionNotFoundError())
    expect((await upsertRoute(bodyReq({}), { params })).status).toBe(404)
  })

  it('refuses a session-less request', async () => {
    expect((await upsertRoute(bodyReq({}, 'POST', false), { params })).status).toBe(401)
  })
})

describe('GET /api/bot-control/decisions/[id]/triage', () => {
  it('returns null rather than 404 when nobody has filed one', async () => {
    // "No triage yet" is the normal state of almost every decision; treating it as an error
    // would fill the console with expected failures.
    mockPrisma.botDecisionTriage.findUnique.mockResolvedValue(null as never)

    const res = await getOne(req('', true), { params })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ triage: null })
  })
})

describe('GET /api/bot-control/decisions/triage', () => {
  it('puts open work above finished work', async () => {
    // A queue whose top row is already done is a queue people stop opening.
    await listTriage(req())
    expect(mockPrisma.botDecisionTriage.findMany.mock.calls[0][0]?.orderBy).toEqual([
      { status: 'asc' },
      { updatedAt: 'desc' },
    ])
  })

  it('carries the decision each triage is about', async () => {
    // A list showing only issue types answers "how many problems" but never "which ones".
    const body = await (await listTriage(req())).json()
    expect(body.items[0].decision).toMatchObject({ inboundPreview: 'Berapa harga ATV?', conversationId: 'conv_1' })
    expect(body.items[0].assignedToName).toBe('Budi')
  })

  it('keeps a triage whose decision has been cleared', async () => {
    // The triage outlives the decision by design.
    mockPrisma.botDecisionRun.findMany.mockResolvedValue([] as never)

    const body = await (await listTriage(req())).json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].decision).toBeNull()
  })

  it('filters by status, issue type, severity and assignee', async () => {
    await listTriage(req('?status=OPEN&issueType=BAD_REPLY&severity=HIGH&assignedTo=acc_agent'))
    expect(mockPrisma.botDecisionTriage.findMany.mock.calls[0][0]?.where).toMatchObject({
      status: 'OPEN',
      issueType: 'BAD_REPLY',
      severity: 'HIGH',
      assignedTo: 'acc_agent',
    })
  })

  it('ignores values outside the known sets', async () => {
    // Zero rows would read as "nothing to do", the most misleading thing this queue can say.
    await listTriage(req('?status=ENTAH&issueType=ENTAH&severity=ENTAH'))
    const where = mockPrisma.botDecisionTriage.findMany.mock.calls[0][0]?.where
    expect(where).not.toHaveProperty('status')
    expect(where).not.toHaveProperty('issueType')
    expect(where).not.toHaveProperty('severity')
  })

  it('offers an "open only" shortcut', async () => {
    await listTriage(req('?open=true'))
    expect(mockPrisma.botDecisionTriage.findMany.mock.calls[0][0]?.where?.status).toEqual({
      in: ['OPEN', 'ASSIGNED'],
    })
  })

  it('refuses a session-less request', async () => {
    expect((await listTriage(req('', false))).status).toBe(401)
  })
})
