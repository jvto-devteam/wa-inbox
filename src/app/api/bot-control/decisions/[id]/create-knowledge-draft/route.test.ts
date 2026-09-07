/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { createManagedKnowledge } from '@/lib/bot-control/knowledge-workflow'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/knowledge-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bot-control/knowledge-workflow')>()
  return { ...actual, createManagedKnowledge: vi.fn() }
})

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const params = Promise.resolve({ id: 'run_1' })
const REASON = 'Customer sering menanyakan ini dan bot gagal menjawab'

function req(body: unknown, withSession = true) {
  return new Request('http://localhost/api/bot-control/decisions/run_1/create-knowledge-draft', {
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
  mockPrisma.botDecisionRun.findUnique.mockResolvedValue({
    id: 'run_1',
    inboundText: 'Berapa harga paket ATV untuk 4 orang?',
    replyText: 'Maaf, saya belum punya informasinya.',
  } as never)
  vi.mocked(createManagedKnowledge).mockResolvedValue({
    sourceId: 'ks_1',
    revisionId: 'krev_1',
    version: 1,
    status: 'DRAFT',
    title: 'Berapa harga paket ATV untuk 4 orang?',
  })
})

describe('POST /api/bot-control/decisions/[id]/create-knowledge-draft', () => {
  it("prefills the question from what the customer actually wrote", async () => {
    const res = await POST(req({ answer: 'Rp350.000 per orang.', reason: REASON }), { params })
    expect(res.status).toBe(200)

    expect(createManagedKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { items: [{ question: 'Berapa harga paket ATV untuk 4 orang?', answer: 'Rp350.000 per orang.' }] },
      }),
      expect.anything(),
      expect.anything()
    )
  })

  it('does NOT use the bot reply unless asked', async () => {
    // The common case is that the reply was the problem; pre-filling a wrong answer is how a
    // wrong answer gets approved by somebody skimming.
    const res = await POST(req({ reason: REASON }), { params })
    expect(res.status).toBe(400)
    expect(createManagedKnowledge).not.toHaveBeenCalled()
  })

  it('uses the bot reply when the operator says it was right', async () => {
    await POST(req({ useBotReply: true, reason: REASON }), { params })
    expect(createManagedKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { items: [{ question: expect.any(String), answer: 'Maaf, saya belum punya informasinya.' }] },
      }),
      expect.anything(),
      expect.anything()
    )
  })

  it('refuses rather than inventing a placeholder answer', async () => {
    // A draft whose answer says "TODO" is one approval away from the bot telling a customer
    // "TODO".
    mockPrisma.botDecisionRun.findUnique.mockResolvedValue({ id: 'run_1', inboundText: 'Halo', replyText: null } as never)

    const res = await POST(req({ useBotReply: true, reason: REASON }), { params })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: expect.stringContaining('Jawaban wajib diisi') })
  })

  it('refuses a run whose inbound text is empty', async () => {
    mockPrisma.botDecisionRun.findUnique.mockResolvedValue({ id: 'run_1', inboundText: '   ', replyText: 'x' } as never)
    expect((await POST(req({ answer: 'y', reason: REASON }), { params })).status).toBe(400)
  })

  it('truncates a very long question into a usable title', async () => {
    mockPrisma.botDecisionRun.findUnique.mockResolvedValue({
      id: 'run_1',
      inboundText: 'a'.repeat(400),
      replyText: null,
    } as never)

    await POST(req({ answer: 'jawaban', reason: REASON }), { params })
    const title = vi.mocked(createManagedKnowledge).mock.calls[0][0].title
    expect(title.length).toBeLessThanOrEqual(120)
  })

  it('answers 404 for a decision run that does not exist', async () => {
    mockPrisma.botDecisionRun.findUnique.mockResolvedValue(null as never)
    expect((await POST(req({ answer: 'y', reason: REASON }), { params })).status).toBe(404)
  })

  it('refuses an AGENT and a session-less request', async () => {
    expect((await POST(req({ answer: 'y', reason: REASON }, false), { params })).status).toBe(401)

    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
    expect((await POST(req({ answer: 'y', reason: REASON }), { params })).status).toBe(403)
    expect(createManagedKnowledge).not.toHaveBeenCalled()
  })

  it('requires a substantive reason', async () => {
    expect((await POST(req({ answer: 'y', reason: 'x' }), { params })).status).toBe(400)
  })
})
