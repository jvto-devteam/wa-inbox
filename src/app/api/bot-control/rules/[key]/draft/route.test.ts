/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { saveRuleDraft, RuleNotEditableError, RuleNotFoundError, RuleTransitionError } from '@/lib/bot-control/rule-workflow'
import { PATCH } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/rule-workflow', async (importOriginal) => {
  // The workflow itself is covered in rule-workflow.test.ts; here only the route's own auth,
  // validation and error mapping matter.
  const actual = await importOriginal<typeof import('@/lib/bot-control/rule-workflow')>()
  return { ...actual, saveRuleDraft: vi.fn() }
})

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const params = Promise.resolve({ key: 'bot.handoff_on_human_request' })
const REASON = 'Model klasifikasi handoff sedang bermasalah'

function req(body: unknown, withSession = true) {
  return new Request('http://localhost/api/bot-control/rules/bot.handoff_on_human_request/draft', {
    method: 'PATCH',
    headers: withSession ? { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  mockPrisma.account.findUnique.mockResolvedValue({ name: 'Admin Satu' } as never)
  vi.mocked(saveRuleDraft).mockResolvedValue({
    key: 'bot.handoff_on_human_request',
    status: 'DRAFT',
    draftEnabled: false,
    draftConfig: {},
  })
})

describe('PATCH /api/bot-control/rules/[key]/draft', () => {
  it('saves the draft and names the acting operator', async () => {
    const res = await PATCH(req({ enabled: false, reason: REASON }), { params })
    expect(res.status).toBe(200)
    expect(saveRuleDraft).toHaveBeenCalledWith(
      'bot.handoff_on_human_request',
      expect.objectContaining({ enabled: false, reason: REASON }),
      { id: 'acc_admin', name: 'Admin Satu' },
      expect.anything()
    )
  })

  it('refuses a request with no session', async () => {
    const res = await PATCH(req({ enabled: false, reason: REASON }, false), { params })
    expect(res.status).toBe(401)
    expect(saveRuleDraft).not.toHaveBeenCalled()
  })

  it('refuses an AGENT, per the permission matrix', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })

    const res = await PATCH(req({ enabled: false, reason: REASON }), { params })
    expect(res.status).toBe(403)
    expect(saveRuleDraft).not.toHaveBeenCalled()
  })

  it('requires a substantive reason', async () => {
    // A rule change is read back months later by somebody working out why the bot's behaviour
    // shifted, and "enabled: false" with no explanation answers nothing.
    expect((await PATCH(req({ enabled: false, reason: 'x' }), { params })).status).toBe(400)
    expect((await PATCH(req({ enabled: false }), { params })).status).toBe(400)
    expect(saveRuleDraft).not.toHaveBeenCalled()
  })

  it('requires enabled to be a boolean, not a string', async () => {
    expect((await PATCH(req({ enabled: 'false', reason: REASON }), { params })).status).toBe(400)
  })

  it('answers 403, not 400, for a rule that may not be edited', async () => {
    // The request is well-formed; the rule is simply off limits.
    vi.mocked(saveRuleDraft).mockRejectedValue(new RuleNotEditableError('Rule tidak boleh diubah dari UI.'))
    expect((await PATCH(req({ enabled: false, reason: REASON }), { params })).status).toBe(403)
  })

  it('answers 404 for a rule with no row', async () => {
    vi.mocked(saveRuleDraft).mockRejectedValue(new RuleNotFoundError('bot.handoff_on_human_request'))
    expect((await PATCH(req({ enabled: false, reason: REASON }), { params })).status).toBe(404)
  })

  it('answers 409 when the rule is in a state that forbids editing', async () => {
    vi.mocked(saveRuleDraft).mockRejectedValue(new RuleTransitionError('sedang berstatus X'))
    expect((await PATCH(req({ enabled: false, reason: REASON }), { params })).status).toBe(409)
  })

  it('reports an unexpected failure as a 500 without leaking the raw error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(saveRuleDraft).mockRejectedValue(new Error('db down'))

    const res = await PATCH(req({ enabled: false, reason: REASON }), { params })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal menyimpan draft rule' })
  })
})
