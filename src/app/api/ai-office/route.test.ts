import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/get-session', () => ({ getSession: vi.fn() }))

import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { GET } from './route'

const db = prisma as unknown as DeepMockProxy<PrismaClient>
const req = () => new Request('http://localhost/api/ai-office')

beforeEach(() => {
  mockReset(db)
  vi.mocked(getSession).mockResolvedValue({ accountId: 'a1' } as never)
})

describe('GET /api/ai-office', () => {
  it('401 tanpa sesi', async () => {
    vi.mocked(getSession).mockResolvedValueOnce(null)
    expect((await GET(req())).status).toBe(401)
  })

  it('empat kartu asisten: pekerjaan terakhir (label, tanpa isi chat) + jumlah hari ini', async () => {
    db.botDecisionRun.findFirst.mockResolvedValue({ startedAt: new Date('2026-10-23T01:00:00Z'), mode: 'faq', conversationId: 'c1' } as never)
    db.botDecisionRun.count.mockResolvedValue(7)
    db.conversation.findFirst.mockResolvedValue({ id: 'c2', chatReviewAt: new Date('2026-10-23T01:05:00Z') } as never)
    db.conversation.count.mockResolvedValue(3)
    db.bookingActionEvent.findFirst.mockResolvedValue({ createdAt: new Date('2026-10-23T01:10:00Z'), event: 'EXECUTED', conversationId: 'c3' } as never)
    db.bookingActionEvent.count.mockResolvedValue(2)
    db.message.findFirst.mockResolvedValue({ createdAt: new Date('2026-10-23T01:15:00Z'), conversationId: 'c4' } as never)
    db.message.count.mockResolvedValue(9)
    const body = await (await GET(req())).json()
    expect(body.agents.map((a: { agent: string; lastLabel: string; todayCount: number }) => [a.agent, a.lastLabel, a.todayCount])).toEqual([
      ['topik', 'Memberi label topik pesan', 9],
      ['bot', 'Menjawab dari knowledge base', 7],
      ['booking', 'Memperbarui backoffice', 2],
      ['ringkasan', 'Meringkas chat & poin penting', 3],
    ])
  })
})
