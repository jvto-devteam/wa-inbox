/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function req(id: string, withSession = true) {
  return new Request(`http://localhost/api/bot-control/decisions/${id}`, {
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.botDecisionRun.findUnique.mockResolvedValue({
    id: 'run_1',
    conversationId: 'conv_1',
    messageId: 'msg_1',
    mode: 'faq',
    status: 'REPLIED',
    inboundText: 'berapa harga?',
    replyText: 'Rp 1.500.000',
    flowKey: 'whatsapp-existing-bot-v1',
    flowVersion: 1,
    latencyMs: 2500,
    trace: { mode: 'faq', steps: [{ label: 'Cek booking', detail: 'Tidak ada' }] },
    knowledgeRefs: { sourceTopic: 'price' },
    verification: null,
    error: null,
    startedAt: new Date('2026-09-05T03:00:00.000Z'),
    finishedAt: new Date('2026-09-05T03:00:02.500Z'),
  } as never)
  mockPrisma.conversation.findUnique.mockResolvedValue({
    id: 'conv_1',
    contact: { name: 'Bruno Figarola', phone: '6281234567890' },
  } as never)
})

describe('GET /api/bot-control/decisions/[id]', () => {
  it('returns the full run including the trace and both timestamps', async () => {
    const res = await GET(req('run_1'), params('run_1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      id: 'run_1',
      contactName: 'Bruno Figarola',
      inboundText: 'berapa harga?',
      replyText: 'Rp 1.500.000',
      flowKey: 'whatsapp-existing-bot-v1',
      startedAt: '2026-09-05T03:00:00.000Z',
      finishedAt: '2026-09-05T03:00:02.500Z',
    })
    expect(body.trace.steps).toHaveLength(1)
  })

  it('returns 404 with the mandated { error } shape for an unknown id', async () => {
    mockPrisma.botDecisionRun.findUnique.mockResolvedValue(null as never)
    const res = await GET(req('nope'), params('nope'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Keputusan tidak ditemukan' })
  })

  it('still returns the run when its conversation has been deleted', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(null as never)
    const body = await (await GET(req('run_1'), params('run_1'))).json()
    expect(body.id).toBe('run_1')
    expect(body.contactName).toBeNull()
  })

  it('reports a null finishedAt rather than crashing on an unfinished run', async () => {
    mockPrisma.botDecisionRun.findUnique.mockResolvedValue({
      id: 'run_2',
      conversationId: 'conv_1',
      messageId: null,
      mode: 'failed',
      status: 'FAILED',
      inboundText: 'x',
      replyText: null,
      flowKey: null,
      flowVersion: null,
      latencyMs: null,
      trace: null,
      knowledgeRefs: null,
      verification: null,
      error: 'Ollama timeout',
      startedAt: new Date('2026-09-05T03:00:00.000Z'),
      finishedAt: null,
    } as never)

    const body = await (await GET(req('run_2'), params('run_2'))).json()
    expect(body).toMatchObject({ status: 'FAILED', error: 'Ollama timeout', finishedAt: null })
  })

  it('checks the session before looking anything up', async () => {
    const res = await GET(req('run_1', false), params('run_1'))
    expect(res.status).toBe(401)
    expect(mockPrisma.botDecisionRun.findUnique).not.toHaveBeenCalled()
  })

  it('returns 500 with the mandated { error } shape when the query fails', async () => {
    mockPrisma.botDecisionRun.findUnique.mockRejectedValue(new Error('db down'))
    const res = await GET(req('run_1'), params('run_1'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal memuat detail keputusan' })
  })
})
