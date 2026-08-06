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
  return new Request('http://localhost/api/bot/indonesia-filter', {
    method: 'POST',
    headers: withCookie ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  mockPrisma.conversation.updateMany.mockResolvedValue({ count: 0 } as never)
})

describe('POST /api/bot/indonesia-filter', () => {
  it('flips skipBotForIndonesianNumbers when called by an admin', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ skipBotForIndonesianNumbers: false, botAutoReplyAll: true } as never)
    mockPrisma.settings.update.mockResolvedValue({ skipBotForIndonesianNumbers: true } as never)
    const res = await POST(request())
    expect((await res.json()).skipBotForIndonesianNumbers).toBe(true)
  })

  it('bulk-deactivates every Indonesian-number conversation when turning the filter On, regardless of their current state', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ skipBotForIndonesianNumbers: false, botAutoReplyAll: true } as never)
    mockPrisma.settings.update.mockResolvedValue({ skipBotForIndonesianNumbers: true } as never)

    await POST(request())

    expect(mockPrisma.settings.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { skipBotForIndonesianNumbers: true } })
    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { contact: { phone: { startsWith: '62' } } },
      data: { botEnabled: false },
    })
  })

  it('restores Indonesian-number conversations to the current overall bot mode when turning the filter Off', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ skipBotForIndonesianNumbers: true, botAutoReplyAll: true } as never)
    mockPrisma.settings.update.mockResolvedValue({ skipBotForIndonesianNumbers: false } as never)

    await POST(request())

    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { contact: { phone: { startsWith: '62' } } },
      data: { botEnabled: true }, // matches botAutoReplyAll, which was true
    })
  })

  it('restores Indonesian-number conversations to false (not true) when turning the filter Off while the overall bot mode is also off', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ skipBotForIndonesianNumbers: true, botAutoReplyAll: false } as never)
    mockPrisma.settings.update.mockResolvedValue({ skipBotForIndonesianNumbers: false } as never)

    await POST(request())

    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { contact: { phone: { startsWith: '62' } } },
      data: { botEnabled: false },
    })
  })

  it('rejects when the caller is not an admin', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
    const res = await POST(request())
    expect(res.status).toBe(403)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
    expect(mockPrisma.conversation.updateMany).not.toHaveBeenCalled()
  })

  it('rejects when there is no session cookie at all', async () => {
    const res = await POST(request(false))
    expect(res.status).toBe(403)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })
})
