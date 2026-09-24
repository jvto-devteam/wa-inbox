import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'
import { writeBotAuditLog } from '@/lib/bot-control/audit'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/bot-control/audit', () => ({ writeBotAuditLog: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
import { POST } from './route'

function req(body: unknown) {
  return new Request('http://t/api/bot/channel-toggle', { method: 'POST', body: JSON.stringify(body) })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(requireAdmin).mockResolvedValue({ accountId: 'a1', role: 'ADMIN' } as never)
  vi.mocked(writeBotAuditLog).mockReset()
  mockPrisma.account.findUnique.mockResolvedValue({ name: 'Dave' } as never)
})

describe('POST /api/bot/channel-toggle', () => {
  it('menolak yang bukan admin dengan 403', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null)
    const res = await POST(req({ platform: 'FACEBOOK' }))
    expect(res.status).toBe(403)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })

  it('menolak platform yang tidak dikenal dengan 400', async () => {
    const res = await POST(req({ platform: 'TIKTOK' }))
    expect(res.status).toBe(400)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })

  // Inti desainnya: sakelar adalah PENULIS MASSAL, bukan gerbang kedua. Kalau updateMany
  // ini hilang, sakelar hanya berlaku untuk percakapan baru dan operator akan melihat
  // toggle menyala sementara chat-chat lama tetap diam.
  it('menulis massal botEnabled ke percakapan platform itu saja', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ botEnabledFacebook: false } as never)
    mockPrisma.settings.update.mockResolvedValue({ botEnabledFacebook: true } as never)

    await POST(req({ platform: 'FACEBOOK' }))

    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { channelIdentity: { platform: 'FACEBOOK' } },
      data: { botEnabled: true },
    })
  })

  it('mencatat audit log dengan aksi ENABLE saat dinyalakan', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ botEnabledInstagram: false } as never)
    mockPrisma.settings.update.mockResolvedValue({ botEnabledInstagram: true } as never)

    await POST(req({ platform: 'INSTAGRAM' }))

    expect(writeBotAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ENABLE', entityType: 'BOT_SETTING', entityKey: 'botEnabledInstagram',
    }))
  })
})
