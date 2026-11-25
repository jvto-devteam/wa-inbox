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
const req = () => new Request('http://localhost/api/new/agent-schedule')

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(getSession).mockResolvedValue({ accountId: 'a1', role: 'AGENT', tokenVersion: 0 } as never)
})

describe('GET /api/new/agent-schedule', () => {
  it('401 tanpa sesi', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    expect((await GET(req())).status).toBe(401)
  })

  it('jadwal mulai kemarin WIB, urut jam kirim, plus waktu salinan terakhir', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-25T03:00:00Z'), toFake: ['Date'] })
    const at = new Date('2026-11-26T13:00:00Z')
    mockPrisma.agentSchedule.findMany.mockResolvedValue([{ key: 'trip_information:1', kind: 'trip_information', bookingId: 1, bookingCode: 'JVTO-1', bookingStatus: 'booked', guestName: 'Emma', phoneTail: '0123', conversationId: 'c1', recipient: 'tamu', sendAt: at, status: 'scheduled', refreshedAt: at }] as never)
    mockPrisma.agentSchedule.aggregate.mockResolvedValue({ _max: { refreshedAt: at } } as never)
    const body = await (await GET(req())).json()
    vi.useRealTimers()
    expect(body).toEqual({ items: [{ key: 'trip_information:1', kind: 'trip_information', bookingCode: 'JVTO-1', bookingStatus: 'booked', guestName: 'Emma', phoneTail: '0123', conversationId: 'c1', recipient: 'tamu', sendAt: at.toISOString(), status: 'scheduled' }], refreshedAt: at.toISOString() })
    expect(mockPrisma.agentSchedule.findMany.mock.calls[0][0]).toMatchObject({ where: { sendAt: { gte: new Date('2026-11-23T17:00:00Z') } } })
  })
})
