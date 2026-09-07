/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const params = Promise.resolve({ id: 'run_1' })

function req(body: unknown, withSession = true) {
  return new Request('http://localhost/api/bot-control/decisions/run_1/create-test-case', {
    method: 'POST',
    headers: withSession ? { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.botDecisionRun.findUnique.mockResolvedValue({
    id: 'run_1',
    inboundText: 'Berapa harga paket ATV untuk 4 orang?',
    conversationId: 'conv_1',
  } as never)
  mockPrisma.botTestCase.create.mockResolvedValue({
    id: 'case_1',
    name: 'Berapa harga paket ATV untuk 4 orang?',
    inputText: 'Berapa harga paket ATV untuk 4 orang?',
    expectedStatus: 'WOULD_REPLY',
    enabled: true,
  } as never)
})

describe('POST /api/bot-control/decisions/[id]/create-test-case', () => {
  it('copies the input from what the customer actually wrote', async () => {
    const res = await POST(req({ expectedStatus: 'WOULD_REPLY' }), { params })
    expect(res.status).toBe(200)
    expect(mockPrisma.botTestCase.create.mock.calls[0][0].data).toMatchObject({
      inputText: 'Berapa harga paket ATV untuk 4 orang?',
      expectedStatus: 'WOULD_REPLY',
      createdBy: 'acc_agent',
    })
  })

  it('REQUIRES the expected status rather than copying what the bot did', async () => {
    // This endpoint exists mainly for turns that went wrong; freezing the wrong outcome as the
    // expectation would make the test pass forever while the bot stays broken.
    expect((await POST(req({}), { params })).status).toBe(400)
    expect(mockPrisma.botTestCase.create).not.toHaveBeenCalled()
  })

  it('rejects a status the runner could never produce', async () => {
    expect((await POST(req({ expectedStatus: 'REPLIED' }), { params })).status).toBe(400)
  })

  it('never seeds the real conversation into the case', async () => {
    // Every case runs against the sandbox, and copying a customer's context into a suite that
    // runs before every publish would put their data in front of everyone reading a failure.
    await POST(req({ expectedStatus: 'WOULD_REPLY' }), { params })
    expect(mockPrisma.botTestCase.create.mock.calls[0][0].data.conversationSeed).toBeUndefined()
  })

  it('truncates a very long question into a usable name', async () => {
    mockPrisma.botDecisionRun.findUnique.mockResolvedValue({
      id: 'run_1',
      inboundText: 'a'.repeat(400),
      conversationId: 'conv_1',
    } as never)

    await POST(req({ expectedStatus: 'WOULD_REPLY' }), { params })
    expect(String(mockPrisma.botTestCase.create.mock.calls[0][0].data.name).length).toBeLessThanOrEqual(120)
  })

  it('refuses a run whose inbound text is empty', async () => {
    mockPrisma.botDecisionRun.findUnique.mockResolvedValue({
      id: 'run_1',
      inboundText: '   ',
      conversationId: 'conv_1',
    } as never)

    expect((await POST(req({ expectedStatus: 'WOULD_REPLY' }), { params })).status).toBe(400)
  })

  it('answers 404 for a decision that does not exist', async () => {
    mockPrisma.botDecisionRun.findUnique.mockResolvedValue(null as never)
    expect((await POST(req({ expectedStatus: 'WOULD_REPLY' }), { params })).status).toBe(404)
  })

  it('refuses a session-less request', async () => {
    expect((await POST(req({ expectedStatus: 'WOULD_REPLY' }, false), { params })).status).toBe(401)
  })
})
