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
const params = { params: Promise.resolve({ id: 'gap_1' }) }

function req(withSession = true) {
  return new Request('http://localhost/api/inbox/gaps/gap_1/resolve', {
    method: 'POST',
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.knowledgeGapLog.findUnique.mockResolvedValue({ id: 'gap_1', resolvedAt: null } as never)
  mockPrisma.knowledgeGapLog.update.mockResolvedValue({ id: 'gap_1', resolvedAt: new Date('2026-09-12T03:00:00.000Z') } as never)
})

describe('POST /api/inbox/gaps/[id]/resolve', () => {
  it('terbuka untuk AGENT: mengisi resolvedAt', async () => {
    const res = await POST(req(), params)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'gap_1', resolvedAt: '2026-09-12T03:00:00.000Z' })
    expect(mockPrisma.knowledgeGapLog.update.mock.calls[0][0].data.resolvedAt).toBeInstanceOf(Date)
  })

  it('idempoten: gap yang sudah selesai dikembalikan tanpa ditulis ulang', async () => {
    mockPrisma.knowledgeGapLog.findUnique.mockResolvedValue({
      id: 'gap_1',
      resolvedAt: new Date('2026-09-10T01:00:00.000Z'),
    } as never)

    const res = await POST(req(), params)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'gap_1', resolvedAt: '2026-09-10T01:00:00.000Z' })
    expect(mockPrisma.knowledgeGapLog.update).not.toHaveBeenCalled()
  })

  it('404 untuk gap yang tidak ada, tanpa menulis apa pun', async () => {
    mockPrisma.knowledgeGapLog.findUnique.mockResolvedValue(null as never)
    const res = await POST(req(), params)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Gap tidak ditemukan.' })
    expect(mockPrisma.knowledgeGapLog.update).not.toHaveBeenCalled()
  })

  it('401 tanpa sesi, tanpa menyentuh database', async () => {
    const res = await POST(req(false), params)
    expect(res.status).toBe(401)
    expect(mockPrisma.knowledgeGapLog.findUnique).not.toHaveBeenCalled()
  })

  it('500 dengan bentuk { error } bila penulisan gagal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.knowledgeGapLog.update.mockRejectedValue(new Error('db down'))
    const res = await POST(req(), params)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal menandai gap selesai' })
  })
})
