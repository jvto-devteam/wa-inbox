/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { DEFAULT_CHANNEL_POLICY } from '@/lib/bot-control/channel-policy-config'
import {
  getChannelPolicyState,
  saveChannelPolicyDraft,
  transitionChannelPolicy,
  PolicyInvalidError,
  PolicyNotFoundError,
  PolicyTransitionError,
} from '@/lib/bot-control/channel-policy-workflow'
import { GET } from './route'
import { PATCH } from './draft/route'
import { POST as requestReview } from './request-review/route'
import { POST as approve } from './approve/route'
import { POST as reject } from './reject/route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/channel-policy-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bot-control/channel-policy-workflow')>()
  return {
    ...actual,
    getChannelPolicyState: vi.fn(),
    saveChannelPolicyDraft: vi.fn(),
    transitionChannelPolicy: vi.fn(),
  }
})

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const REASON = 'Provider unofficial sedang bermasalah sepanjang pagi'

const state = {
  key: 'whatsapp.default',
  status: 'PUBLISHED',
  active: DEFAULT_CHANNEL_POLICY,
  draft: null,
  warnings: [],
}

function getReq(withSession = true) {
  return new Request('http://localhost/api/bot-control/channel-policy', {
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

function bodyReq(body: unknown, method = 'POST', withSession = true) {
  return new Request('http://localhost/api/bot-control/channel-policy/x', {
    method,
    headers: withSession ? { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  mockPrisma.account.findUnique.mockResolvedValue({ name: 'Admin Satu' } as never)
  vi.mocked(getChannelPolicyState).mockResolvedValue(state)
  vi.mocked(saveChannelPolicyDraft).mockResolvedValue(state)
  vi.mocked(transitionChannelPolicy).mockResolvedValue(state)
})

describe('GET /api/bot-control/channel-policy', () => {
  it('is readable by an AGENT and carries the bounds the editor renders from', async () => {
    // One copy of the limits, on the server. A second copy in the form would drift.
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })

    const body = await (await GET(getReq())).json()
    expect(body.active.defaultOutbound).toBe('UNOFFICIAL')
    expect(body.bounds.campaignRatePerMinute.min).toBe(1)
    expect(body.capabilityKeys).toContain('send_template')
  })

  it('answers 404 before the policy has been seeded', async () => {
    vi.mocked(getChannelPolicyState).mockRejectedValue(new PolicyNotFoundError())
    expect((await GET(getReq())).status).toBe(404)
  })

  it('refuses a session-less request', async () => {
    expect((await GET(getReq(false))).status).toBe(401)
  })
})

describe('PATCH /api/bot-control/channel-policy/draft', () => {
  it('saves the draft and names the acting operator', async () => {
    const res = await PATCH(bodyReq({ config: DEFAULT_CHANNEL_POLICY, reason: REASON }, 'PATCH'))
    expect(res.status).toBe(200)
    expect(saveChannelPolicyDraft).toHaveBeenCalledWith(
      { config: DEFAULT_CHANNEL_POLICY, reason: REASON },
      { id: 'acc_admin', name: 'Admin Satu' },
      expect.anything()
    )
  })

  it('lets a BOT_MANAGER edit, and refuses an AGENT', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_bm', role: 'BOT_MANAGER', tokenVersion: 0 })
    expect((await PATCH(bodyReq({ config: DEFAULT_CHANNEL_POLICY, reason: REASON }, 'PATCH'))).status).toBe(200)

    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
    expect((await PATCH(bodyReq({ config: DEFAULT_CHANNEL_POLICY, reason: REASON }, 'PATCH'))).status).toBe(403)
  })

  it('requires a substantive reason', async () => {
    expect((await PATCH(bodyReq({ config: DEFAULT_CHANNEL_POLICY, reason: 'x' }, 'PATCH'))).status).toBe(400)
  })

  it('answers 400 when the values themselves are what is wrong', async () => {
    vi.mocked(saveChannelPolicyDraft).mockRejectedValue(new PolicyInvalidError('campaignRatePerMinute'))
    const res = await PATCH(bodyReq({ config: {}, reason: REASON }, 'PATCH'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: expect.stringContaining('campaignRatePerMinute') })
  })
})

describe('channel policy transition routes', () => {
  it('each asks for its own transition', async () => {
    await requestReview(bodyReq({}))
    expect(transitionChannelPolicy).toHaveBeenCalledWith('REVIEW', expect.anything(), null, expect.anything())

    await approve(bodyReq({}))
    expect(transitionChannelPolicy).toHaveBeenCalledWith('APPROVE', expect.anything(), null, expect.anything())

    await reject(bodyReq({ reason: REASON }))
    expect(transitionChannelPolicy).toHaveBeenCalledWith('REJECT', expect.anything(), REASON, expect.anything())
  })

  it('lets a BOT_MANAGER send to review but not approve', async () => {
    // The separation the review step exists to create, now actually enforceable.
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_bm', role: 'BOT_MANAGER', tokenVersion: 0 })
    expect((await requestReview(bodyReq({}))).status).toBe(200)
    expect((await approve(bodyReq({}))).status).toBe(403)
  })

  it('lets an OWNER approve', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_owner', role: 'OWNER', tokenVersion: 0 })
    expect((await approve(bodyReq({}))).status).toBe(200)
  })

  it('requires a reason to reject but not to approve', async () => {
    expect((await reject(bodyReq({}))).status).toBe(400)
    expect((await approve(bodyReq({}))).status).toBe(200)
  })

  it('answers 409 when the policy is in the wrong state', async () => {
    vi.mocked(transitionChannelPolicy).mockRejectedValue(new PolicyTransitionError('berstatus PUBLISHED'))
    expect((await approve(bodyReq({}))).status).toBe(409)
  })
})
