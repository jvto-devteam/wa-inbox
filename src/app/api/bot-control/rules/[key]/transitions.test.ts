/**
 * @vitest-environment node
 *
 * The three transition routes share one handler shape, so they are tested together — what
 * differs between them is the transition they request and the permission they demand, and
 * comparing those side by side is the point.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { transitionRule, RuleNotFoundError, RuleTransitionError } from '@/lib/bot-control/rule-workflow'
import { POST as requestReview } from './request-review/route'
import { POST as approve } from './approve/route'
import { POST as reject } from './reject/route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/rule-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bot-control/rule-workflow')>()
  return { ...actual, transitionRule: vi.fn() }
})

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const params = Promise.resolve({ key: 'bot.handoff_on_human_request' })
const REASON = 'Tidak sesuai kebijakan channel'

function req(body: unknown = {}, withSession = true) {
  return new Request('http://localhost/api/bot-control/rules/bot.handoff_on_human_request/x', {
    method: 'POST',
    headers: withSession ? { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  mockPrisma.account.findUnique.mockResolvedValue({ name: 'Admin Satu' } as never)
  vi.mocked(transitionRule).mockResolvedValue({
    key: 'bot.handoff_on_human_request',
    status: 'REVIEW',
    draftEnabled: false,
    draftConfig: {},
  })
})

describe('rule transition routes', () => {
  it('each asks for its own transition', async () => {
    await requestReview(req(), { params })
    expect(transitionRule).toHaveBeenCalledWith('bot.handoff_on_human_request', 'REVIEW', expect.anything(), null, expect.anything())

    await approve(req(), { params })
    expect(transitionRule).toHaveBeenCalledWith('bot.handoff_on_human_request', 'APPROVE', expect.anything(), null, expect.anything())

    await reject(req({ reason: REASON }), { params })
    expect(transitionRule).toHaveBeenCalledWith('bot.handoff_on_human_request', 'REJECT', expect.anything(), REASON, expect.anything())
  })

  it('refuses every one of them with no session', async () => {
    for (const handler of [requestReview, approve, reject]) {
      expect((await handler(req({ reason: REASON }, false), { params })).status).toBe(401)
    }
    expect(transitionRule).not.toHaveBeenCalled()
  })

  it('refuses an AGENT everywhere', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })

    for (const handler of [requestReview, approve, reject]) {
      expect((await handler(req({ reason: REASON }), { params })).status).toBe(403)
    }
    expect(transitionRule).not.toHaveBeenCalled()
  })

  it('requires a reason to reject, but not to send to review or approve', async () => {
    // A rejection with no explanation leaves the next person to re-derive why from scratch.
    expect((await reject(req({}), { params })).status).toBe(400)
    expect((await reject(req({ reason: 'x' }), { params })).status).toBe(400)

    expect((await requestReview(req({}), { params })).status).toBe(200)
    expect((await approve(req({}), { params })).status).toBe(200)
  })

  it('answers 409, not 400, when the rule is in the wrong state', async () => {
    // The request is well-formed; the rule simply is not somewhere this transition is legal.
    vi.mocked(transitionRule).mockRejectedValue(new RuleTransitionError('berstatus DRAFT'))
    expect((await approve(req(), { params })).status).toBe(409)
  })

  it('answers 404 for a rule with no row', async () => {
    vi.mocked(transitionRule).mockRejectedValue(new RuleNotFoundError('bot.handoff_on_human_request'))
    expect((await approve(req(), { params })).status).toBe(404)
  })

  it('reports an unexpected failure as a 500 without leaking the raw error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(transitionRule).mockRejectedValue(new Error('db down'))

    const res = await approve(req(), { params })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal memproses permintaan' })
  })
})
