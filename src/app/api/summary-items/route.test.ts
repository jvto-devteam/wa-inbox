/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

vi.mock('@/lib/summary-items/sync', () => ({ reconcileSummaryItems: vi.fn().mockResolvedValue(undefined) }))

import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { reconcileSummaryItems } from '@/lib/summary-items/sync'
import { GET } from './route'

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const req = () => new Request('http://localhost/api/summary-items', { headers: { cookie: 'wa_inbox_session=tok' } })

const row = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  conversationId: 'c_' + id,
  kind: 'REPLY',
  state: 'OPEN',
  anchorAt: new Date('2026-10-17T01:00:00Z'),
  anchorMessageId: null,
  snippet: 'halo',
  review: { bukan: 'review' },
  handoff: false,
  newLead: false,
  openedOn: '2026-10-17',
  dueAt: null,
  conversation: { pipelineStage: 'NEW', contact: { name: 'Budi' } },
  ...o,
})

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(reconcileSummaryItems).mockClear()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.knowledgeGapLog.count.mockResolvedValue(3 as never)
})

describe('GET /api/summary-items', () => {
  it('401 tanpa sesi', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null)
    expect((await GET(req())).status).toBe(401)
  })

  it('mengurutkan OPEN (REPLY, FOLLOW_UP, PROMISE, lalu anchorAt naik) dan SCHEDULED (dueAt naik)', async () => {
    mockPrisma.summaryItem.findMany.mockResolvedValue([
      row('p_old', { kind: 'PROMISE', anchorAt: new Date('2026-10-01T00:00:00Z') }),
      row('f_old', { kind: 'FOLLOW_UP', anchorAt: new Date('2026-10-10T00:00:00Z') }),
      row('r_new', { anchorAt: new Date('2026-10-17T05:00:00Z') }),
      row('r_old', { anchorAt: new Date('2026-10-16T05:00:00Z') }),
      row('s_late', { state: 'SCHEDULED', dueAt: new Date('2026-10-25T00:00:00Z') }),
      row('s_soon', { state: 'SCHEDULED', dueAt: new Date('2026-10-20T00:00:00Z') }),
    ] as never)
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(reconcileSummaryItems).toHaveBeenCalledTimes(1)
    expect(body.open.map((i: { id: string }) => i.id)).toEqual(['r_old', 'r_new', 'f_old', 'p_old'])
    expect(body.scheduled.map((i: { id: string }) => i.id)).toEqual(['s_soon', 's_late'])
    expect(body.openGapTotal).toBe(3)
    expect(body.open[0]).toMatchObject({
      id: 'r_old', conversationId: 'c_r_old', contactName: 'Budi', pipelineStage: 'NEW', kind: 'REPLY',
      state: 'OPEN', anchorAt: '2026-10-16T05:00:00.000Z', review: null, dueAt: null,
    })
    expect(body.scheduled[0].dueAt).toBe('2026-10-20T00:00:00.000Z')
    expect(mockPrisma.knowledgeGapLog.count).toHaveBeenCalledWith({
      where: { resolvedAt: null, conversation: { isTest: false } },
    })
  })

  it('500 { error } bila prisma gagal', async () => {
    mockPrisma.summaryItem.findMany.mockRejectedValue(new Error('db down: secret'))
    const res = await GET(req())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(Object.keys(body)).toEqual(['error'])
    expect(body.error).not.toMatch(/secret/)
  })
})
