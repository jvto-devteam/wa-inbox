/**
 * @vitest-environment node
 *
 * The four mutating flow routes share one shape, so they are tested together — the interesting
 * comparison is which permission each demands and which error maps to which status.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import {
  saveFlowDraft,
  transitionFlow,
  FlowNotEditableError,
  FlowNotFoundError,
  FlowTransitionError,
} from '@/lib/bot-control/flow-workflow'
import { PATCH as saveDraft } from './draft/route'
import { POST as requestReview } from './request-review/route'
import { POST as approve } from './approve/route'
import { POST as reject } from './reject/route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/flow-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bot-control/flow-workflow')>()
  return { ...actual, saveFlowDraft: vi.fn(), transitionFlow: vi.fn() }
})

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const KEY = 'whatsapp-existing-bot-v1'
const params = Promise.resolve({ key: KEY })
const REASON = 'Kalimat fallback lama terdengar menyalahkan customer'
const CONFIG = { fallbackReply: 'Saya cek dulu ya.' }

function req(body: unknown = {}, method = 'POST', withSession = true) {
  return new Request(`http://localhost/api/bot-control/flows/${KEY}/x`, {
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
  vi.mocked(saveFlowDraft).mockResolvedValue({ key: KEY, versionId: 'ver_1', version: 1, status: 'DRAFT', config: CONFIG })
  vi.mocked(transitionFlow).mockResolvedValue({ key: KEY, versionId: 'ver_1', version: 1, status: 'REVIEW', config: CONFIG })
})

describe('PATCH /draft', () => {
  it('saves the draft and names the acting operator', async () => {
    const res = await saveDraft(req({ config: CONFIG, reason: REASON }, 'PATCH'), { params })
    expect(res.status).toBe(200)
    expect(saveFlowDraft).toHaveBeenCalledWith(
      KEY,
      { config: CONFIG, reason: REASON },
      { id: 'acc_admin', name: 'Admin Satu' },
      expect.anything()
    )
  })

  it('refuses an AGENT and a session-less request', async () => {
    expect((await saveDraft(req({ config: CONFIG, reason: REASON }, 'PATCH', false), { params })).status).toBe(401)

    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
    expect((await saveDraft(req({ config: CONFIG, reason: REASON }, 'PATCH'), { params })).status).toBe(403)
    expect(saveFlowDraft).not.toHaveBeenCalled()
  })

  it('requires a substantive reason', async () => {
    expect((await saveDraft(req({ config: CONFIG, reason: 'x' }, 'PATCH'), { params })).status).toBe(400)
  })

  it('answers 403, not 400, for a flow or field that may not be edited', async () => {
    // The request is well-formed; the flow is simply off limits.
    vi.mocked(saveFlowDraft).mockRejectedValue(new FlowNotEditableError('Level READ_ONLY'))
    expect((await saveDraft(req({ config: CONFIG, reason: REASON }, 'PATCH'), { params })).status).toBe(403)
  })

  it('answers 404 for a flow with no definition', async () => {
    vi.mocked(saveFlowDraft).mockRejectedValue(new FlowNotFoundError())
    expect((await saveDraft(req({ config: CONFIG, reason: REASON }, 'PATCH'), { params })).status).toBe(404)
  })

  it('reports an unexpected failure as a 500 without leaking the raw error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(saveFlowDraft).mockRejectedValue(new Error('db down'))

    const res = await saveDraft(req({ config: CONFIG, reason: REASON }, 'PATCH'), { params })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal menyimpan draft flow' })
  })
})

describe('flow transition routes', () => {
  it('each asks for its own transition', async () => {
    await requestReview(req(), { params })
    expect(transitionFlow).toHaveBeenCalledWith(KEY, 'REVIEW', expect.anything(), null, expect.anything())

    await approve(req(), { params })
    expect(transitionFlow).toHaveBeenCalledWith(KEY, 'APPROVE', expect.anything(), null, expect.anything())

    await reject(req({ reason: REASON }), { params })
    expect(transitionFlow).toHaveBeenCalledWith(KEY, 'REJECT', expect.anything(), REASON, expect.anything())
  })

  it('refuses an AGENT everywhere', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
    for (const handler of [requestReview, approve, reject]) {
      expect((await handler(req({ reason: REASON }), { params })).status).toBe(403)
    }
    expect(transitionFlow).not.toHaveBeenCalled()
  })

  it('requires a reason to reject but not to approve', async () => {
    expect((await reject(req({}), { params })).status).toBe(400)
    expect((await approve(req({}), { params })).status).toBe(200)
  })

  it('answers 409 when the version is in the wrong state', async () => {
    vi.mocked(transitionFlow).mockRejectedValue(new FlowTransitionError('berstatus DRAFT'))
    expect((await approve(req(), { params })).status).toBe(409)
  })

  it('answers 404 for a flow with no version', async () => {
    vi.mocked(transitionFlow).mockRejectedValue(new FlowNotFoundError())
    expect((await approve(req(), { params })).status).toBe(404)
  })
})
