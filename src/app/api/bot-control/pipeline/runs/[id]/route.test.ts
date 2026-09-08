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

function req(withSession = true) {
  return new Request('http://localhost/api/bot-control/pipeline/runs/run_1', {
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

const params = Promise.resolve({ id: 'run_1' })

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run_1',
    conversationId: 'conv_1',
    messageId: 'msg_1',
    mode: 'faq',
    status: 'HANDOFF',
    inboundText: 'saya mau bicara dengan orang',
    latencyMs: 900,
    error: null,
    startedAt: new Date('2026-09-08T04:00:00.000Z'),
    finishedAt: new Date('2026-09-08T04:00:00.900Z'),
    steps: [
      { stepId: 'cek-eskalasi', status: 'mulai', at: '2026-09-08T04:00:00.100Z' },
      { stepId: 'serahkan-agen', status: 'mulai', at: '2026-09-08T04:00:00.500Z', detail: { alasan: 'kata kunci' } },
    ],
    ...overrides,
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.botDecisionRun.findUnique.mockResolvedValue(runRow() as never)
  mockPrisma.conversation.findUnique.mockResolvedValue({
    id: 'conv_1',
    contact: { name: 'Bruno', phone: '6281234567890' },
  } as never)
})

describe('GET /api/bot-control/pipeline/runs/[id]', () => {
  it('menolak permintaan tanpa sesi', async () => {
    expect((await GET(req(false), { params })).status).toBe(401)
  })

  it('mengirim jejak langkah lengkap beserta detailnya', async () => {
    const body = await (await GET(req(), { params })).json()

    expect(body.steps).toEqual([
      { stepId: 'cek-eskalasi', status: 'mulai', at: '2026-09-08T04:00:00.100Z' },
      { stepId: 'serahkan-agen', status: 'mulai', at: '2026-09-08T04:00:00.500Z', detail: { alasan: 'kata kunci' } },
    ])
    expect(body.contactName).toBe('Bruno')
  })

  it('mengembalikan steps null untuk run yang jejaknya memang tidak pernah terekam', async () => {
    mockPrisma.botDecisionRun.findUnique.mockResolvedValue(runRow({ steps: null }) as never)

    const body = await (await GET(req(), { params })).json()

    expect(body.steps).toBeNull()
    // Run-nya sendiri tetap ada dan tetap berstatus normal — "tidak terekam" adalah keterangan
    // tentang jejaknya, bukan tentang run-nya.
    expect(body.status).toBe('HANDOFF')
  })

  it('tidak menarik maupun mengembalikan trace', async () => {
    mockPrisma.botDecisionRun.findUnique.mockResolvedValue(runRow({ trace: { rahasia: 'panjang' } }) as never)

    const body = await (await GET(req(), { params })).json()

    expect(body).not.toHaveProperty('trace')
    const select = mockPrisma.botDecisionRun.findUnique.mock.calls[0][0]?.select as Record<string, unknown>
    expect(select).toBeDefined()
    expect(select).not.toHaveProperty('trace')
  })

  it('menjawab 404 untuk run yang tidak ada', async () => {
    mockPrisma.botDecisionRun.findUnique.mockResolvedValue(null as never)

    const res = await GET(req(), { params })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Run tidak ditemukan' })
  })
})
