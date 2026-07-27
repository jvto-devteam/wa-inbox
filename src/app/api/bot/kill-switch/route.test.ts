import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function request(withCookie = true) {
  return new Request('http://localhost/api/bot/kill-switch', {
    method: 'POST',
    headers: withCookie ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
})

describe('POST /api/bot/kill-switch', () => {
  it('flips botKillSwitch when called by an admin', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ botKillSwitch: false } as never)
    mockPrisma.settings.update.mockResolvedValue({ botKillSwitch: true } as never)
    const res = await POST(request())
    expect((await res.json()).botKillSwitch).toBe(true)
  })

  it('stamps killSwitchEnabledAt when flipping OFF -> ON', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ botKillSwitch: false } as never)
    mockPrisma.settings.update.mockResolvedValue({ botKillSwitch: true } as never)

    await POST(request())

    expect(mockPrisma.settings.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { botKillSwitch: true, killSwitchEnabledAt: expect.any(Date) },
    })
  })

  it('does not touch killSwitchEnabledAt when flipping ON -> OFF', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ botKillSwitch: true } as never)
    mockPrisma.settings.update.mockResolvedValue({ botKillSwitch: false } as never)

    await POST(request())

    expect(mockPrisma.settings.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { botKillSwitch: false },
    })
  })

  it('rejects when the caller is not an admin — an agent must not be able to halt all bot automation', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
    const res = await POST(request())
    expect(res.status).toBe(403)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })

  it('rejects when there is no session cookie at all', async () => {
    const res = await POST(request(false))
    expect(res.status).toBe(403)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })
})
