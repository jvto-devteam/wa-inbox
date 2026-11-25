/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/get-session', () => ({ getSession: vi.fn() }))

import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { GET } from './route'

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const req = () => new Request('http://localhost/api/new/reminders')

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(getSession).mockResolvedValue({ accountId: 'a1', role: 'AGENT', tokenVersion: 0 } as never)
})

describe('GET /api/new/reminders', () => {
  it('401 tanpa sesi', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    expect((await GET(req())).status).toBe(401)
  })

  it('reminder belum selesai + percakapan terbaru + item antrean; yang itemnya sudah OPEN tidak dikirim', async () => {
    const at = new Date('2026-11-26T01:00:00Z')
    mockPrisma.reminder.findMany.mockResolvedValue([
      { id: 'r1', note: 'Follow-up: kirim harga', dueAt: at, contactId: 'k1', contact: { name: 'Emma', conversations: [{ id: 'c1' }] } },
      { id: 'r2', note: 'Cek invoice', dueAt: at, contactId: 'k2', contact: { name: null, conversations: [] } },
      { id: 'r3', note: 'Jatuh tempo', dueAt: at, contactId: 'k3', contact: { name: 'Lukas', conversations: [{ id: 'c3' }] } },
    ] as never)
    mockPrisma.summaryItem.findMany.mockResolvedValue([
      { id: 'i1', reminderId: 'r1', state: 'SCHEDULED' },
      { id: 'i3', reminderId: 'r3', state: 'OPEN' },
    ] as never)
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect((await res.json()).reminders).toEqual([
      { id: 'r1', note: 'Follow-up: kirim harga', dueAt: at.toISOString(), contactId: 'k1', contactName: 'Emma', conversationId: 'c1', summaryItemId: 'i1' },
      { id: 'r2', note: 'Cek invoice', dueAt: at.toISOString(), contactId: 'k2', contactName: null, conversationId: null, summaryItemId: null },
    ])
    expect(mockPrisma.reminder.findMany.mock.calls[0][0]).toMatchObject({ where: { done: false }, orderBy: { dueAt: 'asc' }, take: 200 })
  })

  it('500 tanpa membocorkan galat', async () => {
    mockPrisma.reminder.findMany.mockRejectedValue(new Error('db password=x'))
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal memuat reminder' })
  })
})
