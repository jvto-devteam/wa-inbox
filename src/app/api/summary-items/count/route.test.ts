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

  it('total = item OPEN + reminder belum selesai (sama dengan halaman Antrean); reminder item yang sudah OPEN tidak dihitung dua kali', async () => {
    mockPrisma.summaryItem.count.mockResolvedValue(16 as never)
    mockPrisma.summaryItem.findMany.mockResolvedValue([{ reminderId: 'r1' }] as never)
    mockPrisma.reminder.count.mockResolvedValue(1 as never)
    const res = await GET(req())
    expect(await res.json()).toEqual({ open: 16, reminders: 1, total: 17 })
    expect(mockPrisma.summaryItem.count).toHaveBeenCalledWith({ where: { state: 'OPEN' } })
    expect(mockPrisma.reminder.count).toHaveBeenCalledWith({ where: { done: false, id: { notIn: ['r1'] } } })
  })

  it('tanpa reminder yang terkait item OPEN: semua reminder belum selesai dihitung', async () => {
    mockPrisma.summaryItem.count.mockResolvedValue(2 as never)
    mockPrisma.summaryItem.findMany.mockResolvedValue([] as never)
    mockPrisma.reminder.count.mockResolvedValue(3 as never)
    expect(await (await GET(req())).json()).toEqual({ open: 2, reminders: 3, total: 5 })
    expect(mockPrisma.reminder.count).toHaveBeenCalledWith({ where: { done: false } })
  })

  it('500 { error } bila prisma gagal', async () => {
    mockPrisma.summaryItem.count.mockRejectedValue(new Error('x'))
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: expect.any(String) })
  })
})
