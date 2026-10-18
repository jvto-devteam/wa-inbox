/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { GET } from './route'

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const req = () => new Request('http://localhost/api/summary-items/count', { headers: { cookie: 'wa_inbox_session=tok' } })

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
})

describe('GET /api/summary-items/count', () => {
  it('401 tanpa sesi', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null)
    expect((await GET(req())).status).toBe(401)
  })

  it('mengembalikan jumlah item OPEN', async () => {
    mockPrisma.summaryItem.count.mockResolvedValue(4 as never)
    const res = await GET(req())
    expect(await res.json()).toEqual({ open: 4 })
    expect(mockPrisma.summaryItem.count).toHaveBeenCalledWith({ where: { state: 'OPEN' } })
  })

  it('500 { error } bila prisma gagal', async () => {
    mockPrisma.summaryItem.count.mockRejectedValue(new Error('x'))
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: expect.any(String) })
  })
})
