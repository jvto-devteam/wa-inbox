import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/get-session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/db', () => ({
  prisma: {
    botDecisionRun: { findMany: vi.fn() },
    outboundJob: { findMany: vi.fn() },
    bookingActionEvent: { findMany: vi.fn() },
    conversation: { findMany: vi.fn() },
    dailySummary: { findMany: vi.fn() },
    systemTemplate: { findMany: vi.fn() },
    bookingAction: { findMany: vi.fn() },
  },
}))

import { getSession } from '@/lib/auth/get-session'
import { prisma } from '@/lib/db'
import { GET } from './route'

const req = (q: string) => new Request('http://localhost/api/new/agent-activity' + q)
const Q = '?from=2026-11-24T00:00:00.000Z&to=2026-11-25T00:00:00.000Z'

beforeEach(() => {
  vi.mocked(getSession).mockResolvedValue({ accountId: 'a1', role: 'AGENT' } as never)
  vi.mocked(prisma.botDecisionRun.findMany).mockResolvedValue([{ id: 'r1', conversationId: 'c1', status: 'REPLIED', inboundText: 'hi', replyText: 'hello', error: null, startedAt: new Date('2026-11-24T02:00:00Z') }] as never)
  vi.mocked(prisma.outboundJob.findMany).mockResolvedValue([{ id: 'j1', conversationId: 'c1', templateKey: 'trip_concluded', status: 'SENT', lastError: null, createdAt: new Date('2026-11-24T03:00:00Z') }] as never)
  vi.mocked(prisma.bookingActionEvent.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.dailySummary.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.systemTemplate.findMany).mockResolvedValue([{ key: 'trip_concluded', name: 'Trip selesai' }] as never)
  vi.mocked(prisma.bookingAction.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.conversation.findMany).mockImplementation((async (args: { select: Record<string, unknown> }) =>
    args.select.chatReview ? [] : [{ id: 'c1', contact: { name: 'Sarah' } }]) as never)
})

describe('GET /api/new/agent-activity', () => {
  it('401 tanpa sesi', async () => {
    vi.mocked(getSession).mockResolvedValue(null as never)
    expect((await GET(req(Q))).status).toBe(401)
  })

  it('400 untuk rentang tidak valid atau > 31 hari', async () => {
    expect((await GET(req('?from=x&to=y'))).status).toBe(400)
    expect((await GET(req('?from=2026-10-01T00:00:00Z&to=2026-11-25T00:00:00Z'))).status).toBe(400)
  })

  it('menggabungkan log jadi aktivitas, terbaru dulu, dengan nama kontak dan tanpa nomor', async () => {
    const res = await GET(req(Q))
    expect(res.status).toBe(200)
    const { items } = await res.json()
    expect(items.map((i: { agent: string }) => i.agent)).toEqual(['reminder', 'balas'])
    expect(items[0]).toMatchObject({ title: 'Trip selesai', contact: 'Sarah', status: 'ok' })
    expect(JSON.stringify(items)).not.toMatch(/\d{9,}/)
  })

  it('500 tanpa membocorkan galat', async () => {
    vi.mocked(prisma.botDecisionRun.findMany).mockRejectedValue(new Error('db mati postgres://x'))
    const res = await GET(req(Q))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal memuat riwayat agent' })
  })
})
